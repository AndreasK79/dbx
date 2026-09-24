import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../../../App.vue", import.meta.url), "utf8");
const dialogSource = readFileSync(new URL("../DatabaseObjectSearchDialog.vue", import.meta.url), "utf8");
const enSource = readFileSync(new URL("../../../i18n/locales/en.ts", import.meta.url), "utf8");
const zhCnSource = readFileSync(new URL("../../../i18n/locales/zh-CN.ts", import.meta.url), "utf8");

function searchHandlerSource(): string {
  const fnStart = appSource.indexOf("async function handleDatabaseObjectSearchSelect");
  expect(fnStart).toBeGreaterThan(-1);
  const fnEnd = appSource.indexOf("\n}", fnStart);
  return appSource.slice(fnStart, fnEnd);
}

describe("double-Shift search source navigation", () => {
  it("routes the database search dialog through its own select handler", () => {
    expect(appSource).toContain('@select="handleDatabaseObjectSearchSelect"');
    // Quick-open (Ctrl+P) keeps the shared data-opening handler.
    expect(appSource).toContain('<QuickOpenDialog :open="showQuickOpen" :initial-content-mode="quickOpenForceContent" @update:open="showQuickOpen = $event" @select="handleQuickOpenSelect" />');
  });

  it("defaults to source: tables in the structure editor on the DDL tab", () => {
    const fnSource = searchHandlerSource();

    expect(fnSource).toContain('async function handleDatabaseObjectSearchSelect(item: any, target: "source" | "data" = "source")');
    expect(fnSource).toContain('item.type === "table" || item.type === "view" || item.type === "materialized_view"');
    expect(fnSource).toContain("await connectionStore.ensureConnected(item.connectionId);");
    expect(fnSource).toContain('queryStore.openTableStructure(item.connectionId, item.database, item.schema, objectName, "ddl")');
  });

  it("opens views and materialized views in the DDL view dialog, out of the table editor", () => {
    const fnSource = searchHandlerSource();

    expect(fnSource).toContain('const objectType = item.type === "view" ? "VIEW" : item.type === "materialized_view" ? "MATERIALIZED_VIEW" : undefined;');
    expect(fnSource).toContain("queryEditorDdlTarget.value = { connectionId: item.connectionId, database: item.database, schema: item.schema, tableName: objectName, objectType };");
    expect(fnSource).toContain("showQueryEditorDdlDialog.value = true;");
  });

  it("keeps the data-tab path for the rows' View button only", () => {
    const fnSource = searchHandlerSource();

    expect(fnSource).toContain('if (target === "data") {');
    expect(fnSource.indexOf('if (target === "data") {')).toBeLessThan(fnSource.indexOf("const objectType"));
    expect(fnSource).toContain('tableType: item.type === "view" ? "VIEW" : item.type === "materialized_view" ? "MATERIALIZED_VIEW" : "TABLE"');
  });

  it("delegates routines and any other kind to the unchanged quick-open handler", () => {
    expect(searchHandlerSource()).toContain("await handleQuickOpenSelect(item);");
  });

  it("offers Source and View buttons, with View limited to table-like rows", () => {
    expect(dialogSource).toContain("data-object-search-source");
    expect(dialogSource).toContain(`@click.stop="handleSelect(item, 'source')"`);
    expect(dialogSource).toContain("data-object-search-view-data");
    expect(dialogSource).toContain(`@click.stop="handleSelect(item, 'data')"`);
    expect(dialogSource).toContain('v-if="hasDataView(item)"');
    // Row click and Enter keep the source default.
    expect(dialogSource).toContain('@click="handleSelect(item)"');
    expect(dialogSource).toContain('function handleSelect(item: DatabaseObjectSearchItem, target: "source" | "data" = "source")');
  });

  it("ships the button strings in both locales", () => {
    expect(enSource).toContain('openSource: "Source"');
    expect(enSource).toContain('openData: "View"');
    expect(zhCnSource).toContain('openSource: "源码"');
    expect(zhCnSource).toContain('openData: "数据"');
  });
});
