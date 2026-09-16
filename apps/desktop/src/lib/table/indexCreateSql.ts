import type { DatabaseType, IndexInfo } from "@/types/database";
import { qualifiedTableName, quoteTableDataIdentifier } from "@/lib/table/tableSelectSql";

export interface BuildCreateIndexSqlOptions {
  databaseType?: DatabaseType;
  driverProfile?: string | null;
  identifierQuote?: string;
  schema?: string;
  catalog?: string;
  tableName: string;
  index: IndexInfo;
}

/** Dialects that accept `USING <method>` in CREATE INDEX. */
const USING_METHOD_TYPES = new Set<DatabaseType>(["postgres", "gaussdb", "opengauss", "kingbase"]);

/** Dialects where SQL Server-style index types are keyword flags, not methods. */
function sqlServerIndexFlag(indexType: string | null | undefined): string {
  const normalized = (indexType ?? "").trim().toLowerCase();
  if (normalized === "clustered") return "CLUSTERED ";
  if (normalized === "nonclustered") return "NONCLUSTERED ";
  return "";
}

/**
 * Builds a standalone `CREATE INDEX` statement for one index of a table, for
 * the table-info drawer's "copy SQL" affordance. Best-effort reconstruction
 * from the metadata `listIndexes` returns: uniqueness, key columns (raw
 * expressions stay unquoted), PostgreSQL operator classes, partial-index
 * filters, SQL Server `INCLUDE` columns and CLUSTERED/NONCLUSTERED flags, and
 * `USING <method>` where the dialect accepts it. Primary-key and other
 * constraint-backed indexes are rendered as their equivalent standalone index;
 * anything the metadata cannot express (ASC/DESC, NULLS ordering, tablespace)
 * is omitted.
 */
export function buildCreateIndexSql(options: BuildCreateIndexSqlOptions): string {
  const { databaseType, index } = options;
  const tableRef = qualifiedTableName({
    databaseType,
    driverProfile: options.driverProfile ?? undefined,
    identifierQuote: options.identifierQuote,
    schema: options.schema,
    catalog: options.catalog,
    tableName: options.tableName,
  });

  const keys = index.columns.map((column, i) => {
    // Raw key expressions (e.g. lower(email)) must pass through verbatim.
    if (index.key_is_expression?.[i]) return column;
    const opclass = databaseType && USING_METHOD_TYPES.has(databaseType) ? index.column_opclasses?.[i] : undefined;
    const quoted = quoteTableDataIdentifier(databaseType, column, options.identifierQuote);
    return opclass ? `${quoted} ${opclass}` : quoted;
  });

  const parts: string[] = [];
  parts.push(`CREATE ${index.is_unique || index.is_primary ? "UNIQUE " : ""}${databaseType === "sqlserver" ? sqlServerIndexFlag(index.index_type) : ""}INDEX ${quoteTableDataIdentifier(databaseType, index.name, options.identifierQuote)}`);
  parts.push(`ON ${tableRef} (${keys.join(", ")})`);

  const indexType = (index.index_type ?? "").trim();
  if (indexType) {
    if (databaseType && USING_METHOD_TYPES.has(databaseType)) parts.push(`USING ${indexType}`);
    else if (databaseType === "mysql" && ["BTREE", "HASH"].includes(indexType.toUpperCase())) parts.push(`USING ${indexType}`);
  }
  if (index.included_columns?.length && databaseType === "sqlserver") {
    parts.push(`INCLUDE (${index.included_columns.map((column) => quoteTableDataIdentifier(databaseType, column, options.identifierQuote)).join(", ")})`);
  }
  if (index.filter?.trim()) parts.push(`WHERE ${index.filter.trim()}`);

  return `${parts.join(" ")};`;
}
