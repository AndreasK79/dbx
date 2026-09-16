import { describe, expect, it } from "vitest";
import { buildAddForeignKeySql } from "@/lib/table/foreignKeySql";
import type { ForeignKeyInfo } from "@/types/database";

function fk(overrides: Partial<ForeignKeyInfo> = {}): ForeignKeyInfo {
  return {
    name: "fk_orders_user",
    column: "useruid",
    ref_schema: "public",
    ref_table: "users",
    ref_column: "uid",
    ...overrides,
  };
}

describe("buildAddForeignKeySql", () => {
  it("builds a single-column ALTER TABLE with postgres quoting and ON DELETE", () => {
    expect(
      buildAddForeignKeySql({
        databaseType: "postgres",
        schema: "public",
        tableName: "orders",
        foreignKey: fk({ on_delete: "CASCADE" }),
        foreignKeys: [fk({ on_delete: "CASCADE" })],
      }),
    ).toBe('ALTER TABLE "public"."orders" ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("useruid") REFERENCES "public"."users" ("uid") ON DELETE CASCADE;');
  });

  it("merges the rows of a composite foreign key in list order", () => {
    const rows = [
      fk({ name: "fk_lines_order", ref_table: "orders", column: "order_id", ref_column: "id" }),
      fk({ name: "fk_lines_order", ref_table: "orders", column: "order_tenant", ref_column: "tenant" }),
      // A different constraint interleaved: must not leak into the statement.
      fk({ name: "fk_lines_sku", column: "sku", ref_table: "skus", ref_column: "code" }),
    ];
    expect(
      buildAddForeignKeySql({
        databaseType: "postgres",
        schema: "public",
        tableName: "order_lines",
        foreignKey: rows[0],
        foreignKeys: rows,
      }),
    ).toBe('ALTER TABLE "public"."order_lines" ADD CONSTRAINT "fk_lines_order" FOREIGN KEY ("order_id", "order_tenant") REFERENCES "public"."orders" ("id", "tenant");');
  });

  it("appends ON UPDATE after ON DELETE and omits NO ACTION", () => {
    expect(
      buildAddForeignKeySql({
        databaseType: "postgres",
        schema: "public",
        tableName: "orders",
        foreignKey: fk({ on_delete: "SET NULL", on_update: "CASCADE" }),
        foreignKeys: [fk({ on_delete: "SET NULL", on_update: "CASCADE" })],
      }),
    ).toBe('ALTER TABLE "public"."orders" ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("useruid") REFERENCES "public"."users" ("uid") ON DELETE SET NULL ON UPDATE CASCADE;');

    expect(
      buildAddForeignKeySql({
        databaseType: "postgres",
        schema: "public",
        tableName: "orders",
        foreignKey: fk({ on_delete: "No Action", on_update: "No Action" }),
        foreignKeys: [fk({ on_delete: "No Action", on_update: "No Action" })],
      }),
    ).toBe('ALTER TABLE "public"."orders" ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("useruid") REFERENCES "public"."users" ("uid");');
  });

  it("qualifies a referenced table in another schema and drops an empty ref schema", () => {
    expect(
      buildAddForeignKeySql({
        databaseType: "postgres",
        schema: "public",
        tableName: "orders",
        foreignKey: fk({ ref_schema: "lookup", ref_table: "codes", ref_column: "id" }),
        foreignKeys: [fk({ ref_schema: "lookup", ref_table: "codes", ref_column: "id" })],
      }),
    ).toBe('ALTER TABLE "public"."orders" ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("useruid") REFERENCES "lookup"."codes" ("id");');

    expect(
      buildAddForeignKeySql({
        databaseType: "mysql",
        tableName: "orders",
        foreignKey: fk({ ref_schema: null }),
        foreignKeys: [fk({ ref_schema: null })],
      }),
    ).toBe("ALTER TABLE `orders` ADD CONSTRAINT `fk_orders_user` FOREIGN KEY (`useruid`) REFERENCES `users` (`uid`);");
  });

  it("renders ADD FOREIGN KEY without a name for unnamed constraints", () => {
    expect(
      buildAddForeignKeySql({
        databaseType: "postgres",
        schema: "public",
        tableName: "orders",
        foreignKey: fk({ name: "" }),
        foreignKeys: [fk({ name: "" })],
      }),
    ).toBe('ALTER TABLE "public"."orders" ADD FOREIGN KEY ("useruid") REFERENCES "public"."users" ("uid");');
  });

  it("bracket-quotes sqlserver identifiers with schemas", () => {
    expect(
      buildAddForeignKeySql({
        databaseType: "sqlserver",
        schema: "dbo",
        tableName: "orders",
        foreignKey: fk({ ref_schema: "dbo", on_delete: "NO ACTION", on_update: "CASCADE" }),
        foreignKeys: [fk({ ref_schema: "dbo", on_delete: "NO ACTION", on_update: "CASCADE" })],
      }),
    ).toBe("ALTER TABLE [dbo].[orders] ADD CONSTRAINT [fk_orders_user] FOREIGN KEY ([useruid]) REFERENCES [dbo].[users] ([uid]) ON UPDATE CASCADE;");
  });

  it("with a driver-reported quote, quotes identifiers only when required (jdbc path)", () => {
    expect(
      buildAddForeignKeySql({
        databaseType: "postgres",
        identifierQuote: '"',
        schema: "public",
        tableName: "order items",
        foreignKey: fk({ column: "select" }),
        foreignKeys: [fk({ column: "select" })],
      }),
    ).toBe('ALTER TABLE public."order items" ADD CONSTRAINT fk_orders_user FOREIGN KEY ("select") REFERENCES public.users (uid);');
  });

  it("escapes embedded quote characters in identifiers", () => {
    expect(
      buildAddForeignKeySql({
        databaseType: "postgres",
        schema: "public",
        tableName: 'weird"table',
        foreignKey: fk({ name: 'weird"fk', column: 'col"x', ref_column: 'ref"x' }),
        foreignKeys: [fk({ name: 'weird"fk', column: 'col"x', ref_column: 'ref"x' })],
      }),
    ).toBe('ALTER TABLE "public"."weird""table" ADD CONSTRAINT "weird""fk" FOREIGN KEY ("col""x") REFERENCES "public"."users" ("ref""x");');
  });
});
