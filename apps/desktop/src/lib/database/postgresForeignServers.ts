import type { ForeignServerInfo } from "@/types/database";
import { quotePostgresIdentifier } from "@/lib/database/databaseUserAdmin";

function quotePostgresLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * pg_foreign_server.srvoptions / pg_user_mappings.umoptions come back as
 * `key=value` strings. Option names are plain SQL names in OPTIONS (...) so
 * anything unexpected is rejected rather than mangled into broken DDL.
 */
export function foreignServerOptionEntries(options: readonly string[]): Array<{ key: string; value: string }> {
  return options
    .map((option) => {
      const separator = option.indexOf("=");
      if (separator <= 0) throw new Error(`Invalid foreign server option: ${option}`);
      return { key: option.slice(0, separator), value: option.slice(separator + 1) };
    })
    .filter((entry) => entry.key !== "" && entry.value !== "");
}

export function foreignServerOptionsClause(options: readonly string[]): string {
  const entries = foreignServerOptionEntries(options);
  if (entries.length === 0) return "";
  return `OPTIONS (${entries.map((entry) => `${entry.key} ${quotePostgresLiteral(entry.value)}`).join(", ")})`;
}

/**
 * Reconstruct the server's CREATE statement from catalog metadata. User
 * mappings are deliberately omitted: pg_user_mappings hides passwords from
 * non-privileged viewers, so the generated DDL would silently lose secrets.
 */
export function createForeignServerSql(server: ForeignServerInfo): string {
  const statements: string[] = [];
  const parts = [`CREATE SERVER ${quotePostgresIdentifier(server.name)}`];
  if (server.server_type) parts.push(`TYPE ${quotePostgresLiteral(server.server_type)}`);
  if (server.server_version) parts.push(`VERSION ${quotePostgresLiteral(server.server_version)}`);
  parts.push(`FOREIGN DATA WRAPPER ${quotePostgresIdentifier(server.wrapper)}`);
  parts.push(foreignServerOptionsClause(server.options));
  statements.push(parts.filter(Boolean).join(" ") + ";");
  if (server.owner) statements.push(`ALTER SERVER ${quotePostgresIdentifier(server.name)} OWNER TO ${quotePostgresIdentifier(server.owner)};`);
  return statements.join("\n");
}
