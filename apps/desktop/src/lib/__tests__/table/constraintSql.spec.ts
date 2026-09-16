import { describe, expect, it } from "vitest";
import { buildAddConstraintSql } from "@/lib/table/constraintSql";
import type { ConstraintInfo } from "@/types/database";

function constraint(overrides: Partial<ConstraintInfo> = {}): ConstraintInfo {
  return {
    name: "chk_products_price",
    constraint_type: "CHECK",
    definition: "CHECK ((price > 0))",
    columns: [],
    ref_columns: [],
    deferrable: false,
    initially_deferred: false,
    enabled: true,
    valid: true,
    ...overrides,
  };
}

describe("buildAddConstraintSql", () => {
  it("uses a complete pg_get_constraintdef body verbatim", () => {
    expect(
      buildAddConstraintSql({
        databaseType: "postgres",
        schema: "public",
        tableName: "products",
        constraint: constraint(),
      }),
    ).toBe('ALTER TABLE "public"."products" ADD CONSTRAINT "chk_products_price" CHECK ((price > 0));');

    expect(
      buildAddConstraintSql({
        databaseType: "postgres",
        schema: "public",
        tableName: "products",
        constraint: constraint({ name: "uniq_products_sku", constraint_type: "UNIQUE", definition: "UNIQUE (sku)" }),
      }),
    ).toBe('ALTER TABLE "public"."products" ADD CONSTRAINT "uniq_products_sku" UNIQUE (sku);');
  });

  it("wraps a bare check expression in CHECK (…)", () => {
    expect(
      buildAddConstraintSql({
        databaseType: "sqlserver",
        schema: "dbo",
        tableName: "products",
        constraint: constraint({ definition: "([price]>(0))" }),
      }),
    ).toBe("ALTER TABLE [dbo].[products] ADD CONSTRAINT [chk_products_price] CHECK (([price]>(0)));");
  });

  it("synthesizes a column-list body when the definition is empty", () => {
    expect(
      buildAddConstraintSql({
        databaseType: "postgres",
        schema: "public",
        tableName: "products",
        constraint: constraint({ name: "pk_products", constraint_type: "PRIMARY KEY", definition: "", columns: ["tenant", "id"] }),
      }),
    ).toBe('ALTER TABLE "public"."products" ADD CONSTRAINT "pk_products" PRIMARY KEY ("tenant", "id");');

    expect(
      buildAddConstraintSql({
        databaseType: "mysql",
        tableName: "products",
        constraint: constraint({ name: "uniq_sku", constraint_type: "UNIQUE", definition: "", columns: ["sku"] }),
      }),
    ).toBe("ALTER TABLE `products` ADD CONSTRAINT `uniq_sku` UNIQUE (`sku`);");
  });

  it("reconstructs a foreign-key constraint body with actions and deferrability", () => {
    expect(
      buildAddConstraintSql({
        databaseType: "postgres",
        schema: "public",
        tableName: "orders",
        constraint: constraint({
          name: "fk_orders_user",
          constraint_type: "FOREIGN KEY",
          definition: "",
          columns: ["useruid"],
          ref_schema: "public",
          ref_table: "users",
          ref_columns: ["uid"],
          on_delete: "CASCADE",
          on_update: "No Action",
          deferrable: true,
          initially_deferred: true,
        }),
      }),
    ).toBe('ALTER TABLE "public"."orders" ADD CONSTRAINT "fk_orders_user" FOREIGN KEY ("useruid") REFERENCES "public"."users" ("uid") ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED;');
  });

  it("with a driver-reported quote, quotes identifiers only when required (jdbc path)", () => {
    expect(
      buildAddConstraintSql({
        databaseType: "postgres",
        identifierQuote: '"',
        schema: "public",
        tableName: "order items",
        constraint: constraint({ name: "chk_plain", definition: "CHECK ((total >= 0))" }),
      }),
    ).toBe('ALTER TABLE public."order items" ADD CONSTRAINT chk_plain CHECK ((total >= 0));');
  });

  it("escapes embedded quote characters in identifiers", () => {
    expect(
      buildAddConstraintSql({
        databaseType: "postgres",
        schema: "public",
        tableName: 'weird"table',
        constraint: constraint({ name: 'weird"chk' }),
      }),
    ).toBe('ALTER TABLE "public"."weird""table" ADD CONSTRAINT "weird""chk" CHECK ((price > 0));');
  });

  it("returns an explanatory comment for constraints with nothing to reconstruct", () => {
    expect(
      buildAddConstraintSql({
        databaseType: "postgres",
        schema: "public",
        tableName: "products",
        constraint: constraint({ definition: "" }),
      }),
    ).toBe('-- constraint "chk_products_price" (CHECK) on products has no definition to reconstruct');
  });
});
