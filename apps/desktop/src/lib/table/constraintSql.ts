import type { ConstraintInfo, DatabaseType } from "@/types/database";
import { normalizeReferentialAction } from "@/lib/table/foreignKeySql";
import { qualifiedTableName, quoteTableDataIdentifier } from "@/lib/table/tableSelectSql";

export interface BuildAddConstraintSqlOptions {
  databaseType?: DatabaseType;
  driverProfile?: string | null;
  identifierQuote?: string;
  schema?: string;
  catalog?: string;
  tableName: string;
  constraint: ConstraintInfo;
}

/** Dialect-independent keyword labels `constraint_type` uses for table constraints. */
const COLUMN_LIST_TYPES = new Set(["PRIMARY KEY", "UNIQUE", "EXCLUDE"]);

/**
 * Builds a standalone `ALTER TABLE … ADD CONSTRAINT` statement for one table
 * constraint, for the table-info drawer's "copy SQL" affordance. The metadata's
 * `definition` is authoritative when present: on postgres-family it is
 * `pg_get_constraintdef` output, an already-complete body (`CHECK ((…))`,
 * `UNIQUE (a, b)`, `FOREIGN KEY … REFERENCES …`) that is used verbatim. A bare
 * check expression (no `CHECK` keyword) is wrapped; without a definition the
 * body is reconstructed from the constraint type, columns, and reference
 * metadata. Constraints with neither a definition nor reconstructible parts
 * (e.g. a definitionless CHECK) return an explanatory SQL comment instead of a
 * broken statement.
 */
export function buildAddConstraintSql(options: BuildAddConstraintSqlOptions): string {
  const { databaseType, constraint } = options;
  const label = constraint.constraint_type.trim().toUpperCase();
  const definition = constraint.definition.trim();

  const tableRef = qualifiedTableName({
    databaseType,
    driverProfile: options.driverProfile ?? undefined,
    identifierQuote: options.identifierQuote,
    schema: options.schema,
    catalog: options.catalog,
    tableName: options.tableName,
  });

  let body: string;
  if (definition) {
    if (label && definition.toUpperCase().startsWith(label)) body = definition;
    else if (label.includes("CHECK")) body = `CHECK (${definition})`;
    else body = definition;
  } else if (label === "FOREIGN KEY") {
    body = foreignKeyBody(options, constraint);
  } else if (COLUMN_LIST_TYPES.has(label) && constraint.columns.length > 0) {
    body = `${label} (${constraint.columns.map((column) => quoteTableDataIdentifier(databaseType, column, options.identifierQuote)).join(", ")})`;
  } else {
    return `-- constraint "${constraint.name}"${label ? ` (${label})` : ""} on ${options.tableName} has no definition to reconstruct`;
  }

  return `ALTER TABLE ${tableRef} ADD CONSTRAINT ${quoteTableDataIdentifier(databaseType, constraint.name, options.identifierQuote)} ${body};`;
}

/** Reconstructs a `FOREIGN KEY … REFERENCES …` body when no definition text exists. */
function foreignKeyBody(options: BuildAddConstraintSqlOptions, constraint: ConstraintInfo): string {
  const { databaseType } = options;
  const quoteColumn = (column: string) => quoteTableDataIdentifier(databaseType, column, options.identifierQuote);

  const parts = [
    `FOREIGN KEY (${constraint.columns.map(quoteColumn).join(", ")})`,
    `REFERENCES ${qualifiedTableName({
      databaseType,
      driverProfile: options.driverProfile ?? undefined,
      identifierQuote: options.identifierQuote,
      schema: constraint.ref_schema?.trim() || undefined,
      catalog: options.catalog,
      tableName: constraint.ref_table ?? "",
    })} (${constraint.ref_columns.map(quoteColumn).join(", ")})`,
  ];

  const onDelete = normalizeReferentialAction(constraint.on_delete);
  const onUpdate = normalizeReferentialAction(constraint.on_update);
  if (onDelete) parts.push(`ON DELETE ${onDelete}`);
  if (onUpdate) parts.push(`ON UPDATE ${onUpdate}`);
  if (constraint.deferrable) parts.push(constraint.initially_deferred ? "DEFERRABLE INITIALLY DEFERRED" : "DEFERRABLE");
  return parts.join(" ");
}
