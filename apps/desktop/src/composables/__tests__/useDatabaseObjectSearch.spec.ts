import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { databaseObjectSearchItems, resolveActiveDatabaseObjectSearchScope, useDatabaseObjectSearch, OBJECT_SEARCH_MAX_RESULTS } from "@/composables/useDatabaseObjectSearch";
import * as api from "@/lib/backend/api";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: vi.fn(),
}));

vi.mock("@/stores/queryStore", () => ({
  useQueryStore: vi.fn(),
}));

vi.mock("@/stores/savedSqlStore", () => ({
  useSavedSqlStore: vi.fn(),
}));

vi.mock("@/lib/backend/api", () => ({
  listObjects: vi.fn(),
  listSchemas: vi.fn(),
}));

const { getConfig } = { getConfig: vi.fn() };

function mockStores(activeConnectionId: string | null, tabs: any[], activeTabId: string | null) {
  vi.mocked(useConnectionStore).mockReturnValue({ activeConnectionId, getConfig, treeNodes: [], connections: [] } as any);
  vi.mocked(useQueryStore).mockReturnValue({ tabs, activeTabId } as any);
}

describe("resolveActiveDatabaseObjectSearchScope", () => {
  beforeEach(() => {
    getConfig.mockReset();
  });

  it("prefers the active tab's connection, database, schema, and catalog", () => {
    mockStores("other-conn", [{ id: "t1", connectionId: "c1", database: "db1", schema: "public", catalog: "cat1" }], "t1");
    expect(resolveActiveDatabaseObjectSearchScope(useConnectionStore() as any, useQueryStore() as any)).toEqual({
      connectionId: "c1",
      database: "db1",
      schema: "public",
      catalog: "cat1",
    });
  });

  it("falls back to the active connection and its configured database", () => {
    getConfig.mockReturnValue({ id: "c1", db_type: "mysql", database: "fallback_db" });
    mockStores("c1", [], null);
    expect(resolveActiveDatabaseObjectSearchScope(useConnectionStore() as any, useQueryStore() as any)).toEqual({
      connectionId: "c1",
      database: "fallback_db",
      schema: undefined,
      catalog: undefined,
    });
  });

  it("returns null without a connection or a database", () => {
    getConfig.mockReturnValue(undefined);
    mockStores(null, [], null);
    expect(resolveActiveDatabaseObjectSearchScope(useConnectionStore() as any, useQueryStore() as any)).toBeNull();

    getConfig.mockReturnValue({ id: "c1", db_type: "mysql", database: "" });
    mockStores("c1", [], null);
    expect(resolveActiveDatabaseObjectSearchScope(useConnectionStore() as any, useQueryStore() as any)).toBeNull();
  });
});

describe("databaseObjectSearchItems", () => {
  const scope = { connectionId: "c1", database: "db1" };

  it("maps supported kinds and skips everything else", () => {
    const items = databaseObjectSearchItems(
      [
        { name: "users", object_type: "TABLE" },
        { name: "active_users", object_type: "VIEW" },
        { name: "sales_mv", object_type: "MATERIALIZED_VIEW" },
        { name: "calc_total", object_type: "PROCEDURE" },
        { name: "format_name", object_type: "FUNCTION" },
        { name: "users_guard", object_type: "TRIGGER", schema: "public" },
        { name: "nightly", object_type: "EVENT" },
        { name: "seq1", object_type: "SEQUENCE" },
      ],
      scope,
    );
    expect(items.map((item) => [item.type, item.label])).toEqual([
      ["table", "users"],
      ["view", "active_users"],
      ["materialized_view", "sales_mv"],
      ["procedure", "calc_total"],
      ["function", "format_name"],
      ["trigger", "users_guard"],
    ]);
    expect(items[5]).toMatchObject({ schema: "public", objectName: "users_guard", searchText: "public users_guard", connectionId: "c1", database: "db1" });
  });

  it("dedupes identical objects but keeps overloads with different signatures", () => {
    const items = databaseObjectSearchItems(
      [
        { name: "calc", object_type: "FUNCTION", schema: "public", signature: "(int)" },
        { name: "calc", object_type: "FUNCTION", schema: "public", signature: "(text)" },
        { name: "calc", object_type: "FUNCTION", schema: "public", signature: "(text)" },
      ],
      scope,
    );
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.signature)).toEqual(["(int)", "(text)"]);
  });
});

describe("useDatabaseObjectSearch", () => {
  beforeEach(() => {
    getConfig.mockReset();
    vi.mocked(api.listObjects).mockReset();
    vi.mocked(api.listSchemas).mockReset();
  });

  it("loads the active database objects with the connection's supported kinds", async () => {
    getConfig.mockReturnValue({ id: "c1", db_type: "mysql", database: "db1" });
    mockStores("c1", [{ id: "t1", connectionId: "c1", database: "db1" }], "t1");
    vi.mocked(api.listObjects).mockResolvedValue([
      { name: "users", object_type: "TABLE" },
      { name: "users_guard", object_type: "TRIGGER" },
    ]);

    const search = useDatabaseObjectSearch();
    await search.loadActiveDatabase();

    // MySQL sidebar kinds minus EVENT (TABLE VIEW PROCEDURE FUNCTION TRIGGER).
    expect(api.listObjects).toHaveBeenCalledWith("c1", "db1", "db1", ["TABLE", "VIEW", "PROCEDURE", "FUNCTION", "TRIGGER"], undefined, undefined, undefined, undefined);
    expect(search.scope.value).toEqual({ connectionId: "c1", database: "db1", schema: undefined, catalog: undefined });
    expect(search.loading.value).toBe(false);
    expect(search.filteredItems.value.map((item) => item.label)).toEqual(["users", "users_guard"]);
  });

  it("fans out over the database's schemas for postgres when the tab has no schema", async () => {
    getConfig.mockReturnValue({ id: "c2", db_type: "postgres", database: "pgdb" });
    mockStores("c2", [{ id: "t2", connectionId: "c2", database: "pgdb" }], "t2");
    // Numbered pg_toast_N system schemas sort ahead of every user schema and
    // must be filtered out before the fan-out cap, or only empty system
    // schemas would be queried.
    vi.mocked(api.listSchemas).mockResolvedValue(["pg_catalog", "pg_toast_16416", "pg_toast_16421", "public", "analytics"]);
    vi.mocked(api.listObjects).mockImplementation(async (_connectionId: string, _database: string, schema: string) => (schema === "public" ? [{ name: "users", object_type: "TABLE", schema: "public" }] : [{ name: "orders", object_type: "TABLE", schema: "analytics" }]));

    const search = useDatabaseObjectSearch();
    await search.loadActiveDatabase();

    expect(api.listSchemas).toHaveBeenCalledWith("c2", "pgdb");
    const kinds = ["TABLE", "VIEW", "MATERIALIZED_VIEW", "PROCEDURE", "FUNCTION"];
    expect(api.listObjects).toHaveBeenCalledTimes(2);
    expect(api.listObjects).toHaveBeenCalledWith("c2", "pgdb", "public", kinds, undefined, undefined, undefined, undefined);
    expect(api.listObjects).toHaveBeenCalledWith("c2", "pgdb", "analytics", kinds, undefined, undefined, undefined, undefined);
    expect(search.filteredItems.value.map((item) => item.label)).toEqual(["users", "orders"]);
  });

  it("keeps the objects of schemas that load when a sibling schema fails", async () => {
    getConfig.mockReturnValue({ id: "c2", db_type: "postgres", database: "pgdb" });
    mockStores("c2", [{ id: "t2", connectionId: "c2", database: "pgdb" }], "t2");
    vi.mocked(api.listSchemas).mockResolvedValue(["public", "broken"]);
    vi.mocked(api.listObjects).mockImplementation(async (_connectionId: string, _database: string, schema: string) => {
      if (schema === "broken") throw new Error("schema exploded");
      return [{ name: "users", object_type: "TABLE", schema: "public" }];
    });

    const search = useDatabaseObjectSearch();
    await search.loadActiveDatabase();

    expect(search.errorMessage.value).toBe("");
    expect(search.filteredItems.value.map((item) => item.label)).toEqual(["users"]);
  });

  it("surfaces the error when every schema listing fails", async () => {
    getConfig.mockReturnValue({ id: "c2", db_type: "postgres", database: "pgdb" });
    mockStores("c2", [{ id: "t2", connectionId: "c2", database: "pgdb" }], "t2");
    vi.mocked(api.listSchemas).mockResolvedValue(["public"]);
    vi.mocked(api.listObjects).mockRejectedValue(new Error("catalog down"));

    const search = useDatabaseObjectSearch();
    await search.loadActiveDatabase();

    expect(search.errorMessage.value).toBe("catalog down");
    expect(search.filteredItems.value).toEqual([]);
  });

  it("keeps the single blank-schema call for database-object-tree engines", async () => {
    // A dialect-less jdbc connection lists the whole database under the blank
    // schema, so it must not fan out (and mongodb never produces a blank
    // schema at all — its database is the namespace).
    getConfig.mockReturnValue({ id: "c3", db_type: "jdbc", database: "jdb" });
    mockStores("c3", [{ id: "t3", connectionId: "c3", database: "jdb" }], "t3");
    vi.mocked(api.listObjects).mockResolvedValue([{ name: "users", object_type: "TABLE" }]);

    const search = useDatabaseObjectSearch();
    await search.loadActiveDatabase();

    expect(api.listSchemas).not.toHaveBeenCalled();
    expect(api.listObjects).toHaveBeenCalledTimes(1);
    expect(api.listObjects).toHaveBeenCalledWith("c3", "jdb", "", ["TABLE", "VIEW", "PROCEDURE", "FUNCTION"], undefined, undefined, undefined, undefined);
  });

  it("keeps the tab schema as the query schema for schema-aware databases", async () => {
    getConfig.mockReturnValue({ id: "c2", db_type: "postgres", database: "pgdb" });
    mockStores("c2", [{ id: "t2", connectionId: "c2", database: "pgdb", schema: "analytics" }], "t2");
    vi.mocked(api.listObjects).mockResolvedValue([]);

    const search = useDatabaseObjectSearch();
    await search.loadActiveDatabase();

    expect(api.listObjects).toHaveBeenCalledWith("c2", "pgdb", "analytics", expect.any(Array), undefined, undefined, undefined, undefined);
  });

  it("surfaces load errors and survives a null scope", async () => {
    getConfig.mockReturnValue(undefined);
    // One mutable store object: the composable captures it at creation, so the
    // second half of the test activates the connection on the same instance.
    const connectionStore = { activeConnectionId: null as string | null, getConfig, treeNodes: [], connections: [] };
    vi.mocked(useConnectionStore).mockReturnValue(connectionStore as any);
    vi.mocked(useQueryStore).mockReturnValue({ tabs: [], activeTabId: null } as any);

    const search = useDatabaseObjectSearch();
    await search.loadActiveDatabase();
    expect(api.listObjects).not.toHaveBeenCalled();
    expect(search.scope.value).toBeNull();

    getConfig.mockReturnValue({ id: "c1", db_type: "mysql", database: "db1" });
    connectionStore.activeConnectionId = "c1";
    vi.mocked(api.listObjects).mockRejectedValue(new Error("boom"));
    await search.loadActiveDatabase();
    expect(search.errorMessage.value).toBe("boom");
    expect(search.filteredItems.value).toEqual([]);
  });

  it("ignores stale loads when the dialog reopens before the first resolves", async () => {
    getConfig.mockReturnValue({ id: "c1", db_type: "mysql", database: "db1" });
    mockStores("c1", [], null);
    let resolveFirst!: (value: any[]) => void;
    vi.mocked(api.listObjects).mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    vi.mocked(api.listObjects).mockResolvedValueOnce([{ name: "second", object_type: "TABLE" }]);

    const search = useDatabaseObjectSearch();
    const first = search.loadActiveDatabase();
    const second = search.loadActiveDatabase();
    resolveFirst([{ name: "first", object_type: "TABLE" }]);
    await Promise.all([first, second]);

    expect(search.filteredItems.value.map((item) => item.label)).toEqual(["second"]);
  });

  it("filters and ranks by label first, schema text second, with type tiebreak", async () => {
    getConfig.mockReturnValue({ id: "c1", db_type: "mysql", database: "db1" });
    mockStores("c1", [], null);
    vi.mocked(api.listObjects).mockResolvedValue([
      { name: "audit_log", object_type: "TABLE", schema: "archive" },
      { name: "log", object_type: "TABLE" },
      { name: "log", object_type: "FUNCTION" },
    ]);

    const search = useDatabaseObjectSearch();
    await search.loadActiveDatabase();

    search.setQuery("log");
    expect(search.filteredItems.value.map((item) => [item.type, item.label])).toEqual([
      ["table", "log"],
      ["function", "log"],
      ["table", "audit_log"],
    ]);
    expect(search.selectedIndex.value).toBe(0);

    search.selectNext();
    expect(search.selectedItem.value).toMatchObject({ type: "function" });
    search.selectPrevious();
    expect(search.selectedItem.value).toMatchObject({ type: "table", label: "log" });

    search.setQuery("archive");
    // Only the schema (searchText) matches "archive", not the label.
    expect(search.filteredItems.value.map((item) => item.label)).toEqual(["audit_log"]);

    search.setQuery("zzz-no-match");
    expect(search.filteredItems.value).toEqual([]);
  });

  it("caps the rendered list while keeping the full set for filtering", async () => {
    getConfig.mockReturnValue({ id: "c1", db_type: "mysql", database: "db1" });
    mockStores("c1", [], null);
    const objects = Array.from({ length: OBJECT_SEARCH_MAX_RESULTS + 50 }, (_, index) => ({ name: `table_${index}`, object_type: "TABLE" }));
    vi.mocked(api.listObjects).mockResolvedValue(objects);

    const search = useDatabaseObjectSearch();
    await search.loadActiveDatabase();
    await nextTick();

    expect(search.filteredItems.value).toHaveLength(OBJECT_SEARCH_MAX_RESULTS);
    search.setQuery("table_" + (OBJECT_SEARCH_MAX_RESULTS + 40));
    expect(search.filteredItems.value.map((item) => item.label)).toEqual([`table_${OBJECT_SEARCH_MAX_RESULTS + 40}`]);
  });
});
