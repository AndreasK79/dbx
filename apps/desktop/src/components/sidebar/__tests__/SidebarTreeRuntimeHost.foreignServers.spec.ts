import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const storeSource = readFileSync(new URL("../../../stores/connectionStore.ts", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("../SidebarTreeRuntimeHost.vue", import.meta.url), "utf8");
const treeSource = readFileSync(new URL("../ConnectionTree.vue", import.meta.url), "utf8");
const clickSource = readFileSync(new URL("../../../lib/sidebar/treeNodeClick.ts", import.meta.url), "utf8");
const iconSource = readFileSync(new URL("../../../lib/sidebar/treeNodeIcon.ts", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../../../lib/sidebar/sidebarTreeItemLayout.ts", import.meta.url), "utf8");

describe("Postgres foreign-server tree group wiring", () => {
  it("builds the group node beside the extensions group for postgres-like connections", () => {
    const block = storeSource.slice(storeSource.indexOf("function buildForeignServersNode"), storeSource.indexOf("function objectGroupCacheKey"));
    expect(block).toContain("id: `${connectionId}:${database}:__foreign_servers`");
    expect(block).toContain('label: "tree.foreignServers"');
    expect(block).toContain('type: "group-foreign-servers"');
    // Both database-children push sites materialize extensions AND foreign servers together.
    const pushCount = storeSource.split("children.push(buildForeignServersNode(connectionId, database));").length - 1;
    expect(pushCount).toBe(2);
  });

  it("loads foreign servers through the listForeignServers api under the reserved node id", () => {
    const block = storeSource.slice(storeSource.indexOf("async function loadForeignServers"), storeSource.indexOf("async function loadTableForLocate"));
    expect(block).toContain("findNode(treeNodes.value, `${connectionId}:${database}:__foreign_servers`)");
    expect(block).toContain("api.listForeignServers(connectionId, database)");
    expect(block).toContain('type: "postgres-foreign-server" as const');
    expect(block).toContain("meta: server,");
    // User mappings / foreign tables ride along on the node meta for the details dialog.
    expect(storeSource).toContain("isPostgresLikeForExtensions");
  });

  it("dispatches group expansion to the loader", () => {
    const block = storeSource.slice(storeSource.indexOf('node.type === "group-foreign-servers" && node.connectionId'), storeSource.indexOf("async function restoreExpandedChildren"));
    expect(block).toContain('await loadForeignServers(node.connectionId, node.database || "")');
  });

  it("maps the node type to the open-foreign-server-details action", () => {
    expect(clickSource).toContain('if (type === "postgres-foreign-server") return "open-foreign-server-details";');
    expect(clickSource).toContain('"open-foreign-server-details"');
  });

  it("renders network/server icons for the group and its children", () => {
    expect(iconSource).toContain('case "group-foreign-servers":');
    expect(iconSource).toContain('case "postgres-foreign-server":');
  });

  it("treats the foreign-server leaf as non-expandable", () => {
    expect(layoutSource).toContain('"postgres-foreign-server",');
  });
});

describe("SidebarTreeRuntimeHost foreign-server wiring", () => {
  it("declares and dispatches the open-foreign-server-details emit for both activation modes", () => {
    expect(hostSource).toContain('"open-foreign-server-details": [node: TreeNode];');
    expect(hostSource).toContain('} else if (action === "open-foreign-server-details") {\n    emit("open-foreign-server-details", node);');
    expect(hostSource).toContain('} else if (action === "open-foreign-server-details") {\n    emit("open-foreign-server-details", activeNode.value);');
  });

  it("registers the group for label, loaded-toggle and expansion handling", () => {
    expect(hostSource).toContain('"group-foreign-servers",');
    expect(hostSource).toContain('node.type === "group-extensions" || node.type === "group-foreign-servers"');
    expect(hostSource).toContain('node.type === "group-foreign-servers" && node.connectionId && hasTreeNodeDatabaseContext(node)');
  });

  it("offers view-details and copy-name in the context menu", () => {
    const block = hostSource.slice(hostSource.indexOf('if (node.type === "postgres-foreign-server")'), hostSource.indexOf("return false;\n}\n\nfunction buildObjectSidebarMenu"));
    expect(block).toContain('t("foreignServer.viewDetails")');
    expect(block).toContain('emit("open-foreign-server-details", node)');
    expect(block).toContain('t("contextMenu.copyName")');
  });
});

describe("ConnectionTree foreign-server details dialog wiring", () => {
  it("mounts the dialog and forwards the runtime host event", () => {
    expect(treeSource).toContain('import ForeignServerDetailsDialog from "@/components/objects/ForeignServerDetailsDialog.vue";');
    expect(treeSource).toContain('@open-foreign-server-details="openSidebarForeignServerDetails"');
    expect(treeSource).toContain('<ForeignServerDetailsDialog v-if="sidebarForeignServerDetailsTarget" ref="sidebarForeignServerDetailsDialogRef" :node="sidebarForeignServerDetailsTarget" />');
  });
});
