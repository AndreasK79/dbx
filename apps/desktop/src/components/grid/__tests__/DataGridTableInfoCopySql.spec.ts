import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(new URL("../DataGridTableInfoPanels.vue", import.meta.url), "utf8");
const dataGridSource = readFileSync(new URL("../DataGrid.vue", import.meta.url), "utf8");

describe("Table-info drawer index copy-SQL wiring", () => {
  it("offers a per-index Copy SQL button in the indexes panel", () => {
    expect(panelSource).toContain("canCopyIndexSql: boolean;");
    expect(panelSource).toContain("requestCopyIndexSql: [index: IndexInfo];");
    expect(panelSource).toContain('v-if="props.canCopyIndexSql"');
    expect(panelSource).toContain(`emit('requestCopyIndexSql', index)`);
  });

  it("DataGrid builds the CREATE INDEX statement and copies it", () => {
    const block = dataGridSource.slice(dataGridSource.indexOf("function onCopyIndexSql"), dataGridSource.indexOf("const canCopyForeignKeySql"));
    expect(block).toContain("buildCreateIndexSql({");
    expect(block).toContain("databaseType: resolvedDatabaseType.value");
    expect(block).toContain("identifierQuote: connectionStore.connectionIdentifierQuote?.(props.connectionId)");
    expect(block).toContain("schema: props.tableMeta.schema");
    expect(block).toContain("index,");
    expect(block).toContain("copyText(");
    // No table context (e.g. a grid without table metadata) must not copy nonsense.
    expect(block).toContain("if (!props.tableMeta?.tableName) return;");
  });

  it("hides the button for MongoDB, whose indexes have no SQL form", () => {
    expect(dataGridSource).toContain('const canCopyIndexSql = computed(() => resolvedDatabaseType.value !== "mongodb")');
    expect(dataGridSource).toContain(':can-copy-index-sql="canCopyIndexSql"');
    expect(dataGridSource).toContain('@request-copy-index-sql="onCopyIndexSql"');
  });
});

describe("Table-info drawer foreign-key copy-SQL wiring", () => {
  it("offers a per-constraint Copy SQL button in the foreign-keys panel", () => {
    expect(panelSource).toContain("canCopyForeignKeySql: boolean;");
    expect(panelSource).toContain("requestCopyForeignKeySql: [foreignKey: ForeignKeyInfo];");
    expect(panelSource).toContain('v-if="props.canCopyForeignKeySql"');
    expect(panelSource).toContain(`emit('requestCopyForeignKeySql', foreignKey)`);
  });

  it("DataGrid builds the ADD CONSTRAINT statement from the unfiltered FK list and copies it", () => {
    const block = dataGridSource.slice(dataGridSource.indexOf("function onCopyForeignKeySql"), dataGridSource.indexOf("const canCopyConstraintSql"));
    expect(block).toContain("buildAddForeignKeySql({");
    expect(block).toContain("databaseType: resolvedDatabaseType.value");
    expect(block).toContain("identifierQuote: connectionStore.connectionIdentifierQuote?.(props.connectionId)");
    expect(block).toContain("schema: props.tableMeta.schema");
    expect(block).toContain("foreignKey,");
    // Grouping must see every row of a composite constraint, not the search-filtered subset.
    expect(block).toContain("foreignKeys: foreignKeys.value");
    expect(block).toContain("copyText(");
    expect(block).toContain("if (!props.tableMeta?.tableName) return;");
  });

  it("hides the button for MongoDB, which has no foreign keys", () => {
    expect(dataGridSource).toContain('const canCopyForeignKeySql = computed(() => resolvedDatabaseType.value !== "mongodb")');
    expect(dataGridSource).toContain(':can-copy-foreign-key-sql="canCopyForeignKeySql"');
    expect(dataGridSource).toContain('@request-copy-foreign-key-sql="onCopyForeignKeySql"');
  });
});

describe("Table-info drawer constraint copy-SQL wiring", () => {
  it("offers a per-constraint Copy SQL button in the constraints panel", () => {
    expect(panelSource).toContain("canCopyConstraintSql: boolean;");
    expect(panelSource).toContain("requestCopyConstraintSql: [constraint: ConstraintInfo];");
    expect(panelSource).toContain('v-if="props.canCopyConstraintSql"');
    expect(panelSource).toContain(`emit('requestCopyConstraintSql', constraint)`);
  });

  it("DataGrid builds the ALTER TABLE … ADD CONSTRAINT statement and copies it", () => {
    const block = dataGridSource.slice(dataGridSource.indexOf("function onCopyConstraintSql"), dataGridSource.indexOf("const dropMongoIndexConfirmMessage"));
    expect(block).toContain("buildAddConstraintSql({");
    expect(block).toContain("databaseType: resolvedDatabaseType.value");
    expect(block).toContain("identifierQuote: connectionStore.connectionIdentifierQuote?.(props.connectionId)");
    expect(block).toContain("schema: props.tableMeta.schema");
    expect(block).toContain("constraint,");
    expect(block).toContain("copyText(");
    expect(block).toContain("if (!props.tableMeta?.tableName) return;");
  });

  it("hides the button for MongoDB, which has no table constraints", () => {
    expect(dataGridSource).toContain('const canCopyConstraintSql = computed(() => resolvedDatabaseType.value !== "mongodb")');
    expect(dataGridSource).toContain(':can-copy-constraint-sql="canCopyConstraintSql"');
    expect(dataGridSource).toContain('@request-copy-constraint-sql="onCopyConstraintSql"');
  });
});
