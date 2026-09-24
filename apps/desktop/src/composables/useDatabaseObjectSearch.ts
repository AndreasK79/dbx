import { computed, ref, watch } from "vue";
import type { ObjectInfo } from "@/types/database";
import { connectionObjectTreeQuerySchema, connectionUsesDatabaseObjectTreeMode, effectiveDatabaseTypeForConnection } from "@/lib/database/jdbcDialect";
import { filterSchemaNamesForConnection } from "@/lib/database/visibleDatabases";
import { normalizeSidebarObjectKind, sidebarObjectKindsForDatabase, type SidebarObjectKind } from "@/lib/database/databaseObjectCapabilities";
import { matchQuickOpenText } from "@/composables/useQuickOpen";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";
import * as api from "@/lib/backend/api";

/** Object kinds the double-Shift database search lists (subset of the sidebar's kinds). */
const SEARCH_OBJECT_KINDS: SidebarObjectKind[] = ["TABLE", "VIEW", "MATERIALIZED_VIEW", "PROCEDURE", "FUNCTION", "TRIGGER"];
/** Rendered result cap, matching quick-open's QUICK_OPEN_MAX_RESULTS. */
export const OBJECT_SEARCH_MAX_RESULTS = 200;
/** Bound on objects kept in memory for one database (rendering is capped above regardless). */
const MAX_LOADED_OBJECTS = 5000;
/** Bound on schemas queried when a schema-less search must cover the whole database. */
const MAX_SEARCH_SCHEMAS = 50;

export type DatabaseObjectSearchItemType = "table" | "view" | "materialized_view" | "procedure" | "function" | "trigger";

const KIND_TO_ITEM_TYPE: Partial<Record<SidebarObjectKind, DatabaseObjectSearchItemType>> = {
  TABLE: "table",
  VIEW: "view",
  MATERIALIZED_VIEW: "materialized_view",
  PROCEDURE: "procedure",
  FUNCTION: "function",
  TRIGGER: "trigger",
};

const TYPE_ORDER: Record<DatabaseObjectSearchItemType, number> = {
  table: 0,
  view: 1,
  materialized_view: 2,
  procedure: 3,
  function: 4,
  trigger: 5,
};

export interface DatabaseObjectSearchItem {
  id: string;
  type: DatabaseObjectSearchItemType;
  label: string;
  connectionId: string;
  database: string;
  schema?: string;
  objectName: string;
  signature?: string | null;
  /** Lowercase schema + name, searched when the label does not match. */
  searchText: string;
}

export interface DatabaseObjectSearchScope {
  connectionId: string;
  database: string;
  schema?: string;
  catalog?: string;
}

interface MatchedItem extends DatabaseObjectSearchItem {
  matchScore: number;
  matchIndices: number[];
}

export function databaseObjectSearchItems(objects: ObjectInfo[], scope: DatabaseObjectSearchScope): DatabaseObjectSearchItem[] {
  const items: DatabaseObjectSearchItem[] = [];
  const seen = new Set<string>();
  for (const object of objects) {
    const itemType = KIND_TO_ITEM_TYPE[normalizeSidebarObjectKind(object.object_type)];
    if (!itemType) continue;
    const schema = object.schema || undefined;
    const id = `${itemType}:${schema ?? ""}:${object.name}${object.signature ? `:${object.signature}` : ""}`.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      type: itemType,
      label: object.name,
      connectionId: scope.connectionId,
      database: scope.database,
      schema,
      objectName: object.name,
      signature: object.signature ?? null,
      searchText: `${schema ?? ""} ${object.name}`.trim(),
    });
    if (items.length >= MAX_LOADED_OBJECTS) break;
  }
  return items;
}

/**
 * The database the search dialog targets: the active tab's connection +
 * database, falling back to the active connection's configured database.
 */
export function resolveActiveDatabaseObjectSearchScope(connectionStore: Pick<ReturnType<typeof useConnectionStore>, "activeConnectionId" | "getConfig">, queryStore: Pick<ReturnType<typeof useQueryStore>, "tabs" | "activeTabId">): DatabaseObjectSearchScope | null {
  const activeTab = queryStore.tabs.find((tab) => tab.id === queryStore.activeTabId);
  const connectionId = activeTab?.connectionId || connectionStore.activeConnectionId;
  if (!connectionId) return null;
  const database = activeTab?.database || connectionStore.getConfig(connectionId)?.database || "";
  if (!database) return null;
  return {
    connectionId,
    database,
    schema: activeTab?.schema || undefined,
    catalog: activeTab?.catalog || undefined,
  };
}

export function useDatabaseObjectSearch() {
  const connectionStore = useConnectionStore();
  const queryStore = useQueryStore();
  const searchQuery = ref("");
  const selectedIndex = ref(0);
  const loading = ref(false);
  const errorMessage = ref("");
  const scope = ref<DatabaseObjectSearchScope | null>(null);
  const items = ref<DatabaseObjectSearchItem[]>([]);
  let loadGeneration = 0;

  async function load(nextScope: DatabaseObjectSearchScope | null): Promise<void> {
    const generation = ++loadGeneration;
    scope.value = nextScope;
    searchQuery.value = "";
    selectedIndex.value = 0;
    errorMessage.value = "";
    items.value = [];

    if (!nextScope) return;

    const config = connectionStore.getConfig(nextScope.connectionId);
    // Compatibility mode only toggles PACKAGE kinds, which the search never
    // lists, so the unscoped sidebar kinds already cover every search type.
    const supportedKinds = sidebarObjectKindsForDatabase(effectiveDatabaseTypeForConnection(config)).filter((kind) => SEARCH_OBJECT_KINDS.includes(kind));
    const objectTypes = supportedKinds.length > 0 ? supportedKinds : (["TABLE", "VIEW"] as SidebarObjectKind[]);
    const querySchema = connectionObjectTreeQuerySchema(config, nextScope.database, nextScope.schema);
    // Schema-scoped engines (postgres family, SQL Server, …) match list objects
    // against a single schema, so the blank "backend resolves it" schema returns
    // nothing there. Database-object-tree engines (mongodb, databend, …) treat
    // the blank schema as the whole database and keep the single call.
    const schemaLessScope = querySchema === "" && !connectionUsesDatabaseObjectTreeMode(config);

    loading.value = true;
    try {
      let objects: ObjectInfo[];
      if (!schemaLessScope) {
        objects = await api.listObjects(nextScope.connectionId, nextScope.database, querySchema, objectTypes, undefined, undefined, undefined, nextScope.catalog);
      } else {
        // System schemas are dropped unconditionally (same filter the sidebar
        // applies): a postgres database has one numbered pg_toast_N system
        // schema per table, and they sort ahead of every user schema — without
        // the filter the fan-out would query only empty system schemas.
        const schemas = filterSchemaNamesForConnection(await api.listSchemas(nextScope.connectionId, nextScope.database), config, nextScope.database, { showSystemSchemas: false }).slice(0, MAX_SEARCH_SCHEMAS);
        const results = await Promise.allSettled(schemas.map((schemaName) => api.listObjects(nextScope.connectionId, nextScope.database, schemaName, objectTypes, undefined, undefined, undefined, nextScope.catalog)));
        const fulfilled = results.filter((result): result is PromiseFulfilledResult<ObjectInfo[]> => result.status === "fulfilled");
        if (fulfilled.length === 0) {
          const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
          throw rejection?.reason ?? new Error("No schemas found");
        }
        objects = fulfilled.flatMap((result) => result.value);
      }
      if (generation !== loadGeneration) return;
      items.value = databaseObjectSearchItems(objects, nextScope);
    } catch (error: any) {
      if (generation !== loadGeneration) return;
      errorMessage.value = error?.message || String(error);
    } finally {
      if (generation === loadGeneration) loading.value = false;
    }
  }

  function loadActiveDatabase(): Promise<void> {
    return load(resolveActiveDatabaseObjectSearchScope(connectionStore, queryStore));
  }

  const filteredItems = computed((): MatchedItem[] => {
    if (!searchQuery.value.trim()) {
      return items.value.slice(0, OBJECT_SEARCH_MAX_RESULTS).map((item) => ({ ...item, matchScore: Infinity, matchIndices: [] }));
    }

    const matched: MatchedItem[] = [];
    for (const item of items.value) {
      const labelMatch = matchQuickOpenText(searchQuery.value, item.label);
      const metadataMatch = labelMatch ? null : matchQuickOpenText(searchQuery.value, item.searchText);
      const result = labelMatch ?? metadataMatch;
      if (result) {
        matched.push({
          ...item,
          matchScore: result.score + (labelMatch ? 0 : 1000),
          matchIndices: labelMatch ? result.indices : [],
        });
      }
    }

    matched.sort((a, b) => {
      if (a.matchScore !== b.matchScore) return a.matchScore - b.matchScore;
      const typeDifference = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
      if (typeDifference !== 0) return typeDifference;
      const lengthDifference = a.label.length - b.label.length;
      if (lengthDifference !== 0) return lengthDifference;
      return a.label.localeCompare(b.label);
    });

    return matched.slice(0, OBJECT_SEARCH_MAX_RESULTS);
  });

  // Typing must restart keyboard navigation from the top row (quick-open's
  // searchQuery watch does the same).
  watch(searchQuery, () => {
    selectedIndex.value = 0;
  });

  const selectedItem = computed((): MatchedItem | null => {
    if (selectedIndex.value < 0 || selectedIndex.value >= filteredItems.value.length) return null;
    return filteredItems.value[selectedIndex.value];
  });

  function selectNext(): void {
    if (selectedIndex.value < filteredItems.value.length - 1) selectedIndex.value++;
  }

  function selectPrevious(): void {
    if (selectedIndex.value > 0) selectedIndex.value--;
  }

  function resetSelection(): void {
    selectedIndex.value = 0;
  }

  function setQuery(query: string): void {
    searchQuery.value = query;
    resetSelection();
  }

  return {
    searchQuery,
    filteredItems,
    selectedIndex,
    selectedItem,
    loading,
    errorMessage,
    scope,
    load,
    loadActiveDatabase,
    selectNext,
    selectPrevious,
    resetSelection,
    setQuery,
  };
}
