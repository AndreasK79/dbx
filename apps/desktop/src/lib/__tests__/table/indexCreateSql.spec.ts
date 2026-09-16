import { describe, expect, it } from "vitest";
import { buildCreateIndexSql } from "@/lib/table/indexCreateSql";
import type { IndexInfo } from "@/types/database";

function index(overrides: Partial<IndexInfo> = {}): IndexInfo {
  return {
    name: "idx_users_email",
    columns: ["email"],
    is_unique: false,
    is_primary: false,
    ...overrides,
  };
}

describe("buildCreateIndexSql", () => {
  it("builds a plain CREATE INDEX with postgres quoting and schema", () => {
    expect(
      buildCreateIndexSql({
        databaseType: "postgres",
        schema: "public",
        tableName: "users",
        index: index(),
      }),
    ).toBe('CREATE INDEX "idx_users_email" ON "public"."users" ("email");');
  });

  it("marks unique and primary-key indexes UNIQUE and appends the partial-index predicate", () => {
    expect(
      buildCreateIndexSql({
        databaseType: "postgres",
        schema: "public",
        tableName: "users",
        index: index({ name: "uniq_users_email", is_unique: true, filter: "status = 'active'" }),
      }),
    ).toBe(`CREATE UNIQUE INDEX "uniq_users_email" ON "public"."users" ("email") WHERE status = 'active';`);

    expect(
      buildCreateIndexSql({
        databaseType: "postgres",
        schema: "public",
        tableName: "users",
        index: index({ name: "users_pkey", columns: ["uid"], is_primary: true }),
      }),
    ).toBe('CREATE UNIQUE INDEX "users_pkey" ON "public"."users" ("uid");');
  });

  it("keeps raw key expressions unquoted and appends postgres operator classes to plain keys", () => {
    expect(
      buildCreateIndexSql({
        databaseType: "postgres",
        schema: "public",
        tableName: "users",
        index: index({
          name: "ix_users_lookup",
          columns: ["lower(email)", "status"],
          key_is_expression: [true, false],
          column_opclasses: [null, "text_pattern_ops"],
        }),
      }),
    ).toBe('CREATE INDEX "ix_users_lookup" ON "public"."users" (lower(email), "status" text_pattern_ops);');
  });

  it("emits USING for postgres access methods", () => {
    expect(
      buildCreateIndexSql({
        databaseType: "postgres",
        schema: "public",
        tableName: "events",
        index: index({ name: "ix_events_payload", columns: ["payload"], index_type: "gin" }),
      }),
    ).toBe('CREATE INDEX "ix_events_payload" ON "public"."events" ("payload") USING gin;');
  });

  it("with a driver-reported quote, quotes identifiers only when required (jdbc path)", () => {
    expect(
      buildCreateIndexSql({
        databaseType: "postgres",
        identifierQuote: '"',
        schema: "public",
        tableName: "order items",
        index: index({ columns: ["select"] }),
      }),
    ).toBe('CREATE INDEX idx_users_email ON public."order items" ("select");');
  });

  it("backtick-quotes mysql keys and emits USING BTREE", () => {
    expect(
      buildCreateIndexSql({
        databaseType: "mysql",
        tableName: "users",
        index: index({ is_unique: true, index_type: "BTREE" }),
      }),
    ).toBe("CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`) USING BTREE;");
  });

  it("omits USING when the dialect has no such clause", () => {
    expect(
      buildCreateIndexSql({
        databaseType: "mysql",
        tableName: "users",
        index: index({ index_type: "FULLTEXT" }),
      }),
    ).toBe("CREATE INDEX `idx_users_email` ON `users` (`email`);");
  });

  it("maps sqlserver index types to the CLUSTERED flag with INCLUDE columns and filter", () => {
    expect(
      buildCreateIndexSql({
        databaseType: "sqlserver",
        schema: "dbo",
        tableName: "orders",
        index: index({
          name: "ix_orders_customer",
          columns: ["customer_id", "created_at"],
          is_unique: true,
          index_type: "CLUSTERED",
          included_columns: ["status"],
          filter: "[created_at] > '2024-01-01'",
        }),
      }),
    ).toBe("CREATE UNIQUE CLUSTERED INDEX [ix_orders_customer] ON [dbo].[orders] ([customer_id], [created_at]) INCLUDE ([status]) WHERE [created_at] > '2024-01-01';");
  });

  it("escapes embedded quote characters in identifiers", () => {
    expect(
      buildCreateIndexSql({
        databaseType: "postgres",
        schema: "public",
        tableName: 'weird"table',
        index: index({ name: 'weird"idx' }),
      }),
    ).toBe('CREATE INDEX "weird""idx" ON "public"."weird""table" ("email");');
  });
});
