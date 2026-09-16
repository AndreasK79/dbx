import { describe, expect, it } from "vitest";
import { createForeignServerSql, foreignServerOptionEntries, foreignServerOptionsClause } from "@/lib/database/postgresForeignServers";
import type { ForeignServerInfo } from "@/types/database";

function foreignServer(overrides: Partial<ForeignServerInfo> = {}): ForeignServerInfo {
  return {
    name: "legacy_erp",
    wrapper: "postgres_fdw",
    owner: "admin",
    server_type: null,
    server_version: null,
    options: [],
    comment: null,
    user_mappings: [],
    foreign_tables: [],
    ...overrides,
  };
}

describe("foreignServerOptionEntries", () => {
  it("splits srvoptions key=value strings on the first equals sign", () => {
    expect(foreignServerOptionEntries(["host=erp-db.internal", "dbname=erp", "connstr=a=b"])).toEqual([
      { key: "host", value: "erp-db.internal" },
      { key: "dbname", value: "erp" },
      { key: "connstr", value: "a=b" },
    ]);
  });

  it("rejects options without a key", () => {
    expect(() => foreignServerOptionEntries(["port=5432", "=value"])).toThrow(/Invalid foreign server option/);
    expect(() => foreignServerOptionEntries(["novalue"])).toThrow(/Invalid foreign server option/);
  });
});

describe("foreignServerOptionsClause", () => {
  it("renders each option as a quoted literal list", () => {
    expect(foreignServerOptionsClause(["host=erp-db", "port=5432"])).toBe("OPTIONS (host 'erp-db', port '5432')");
  });

  it("omits the clause when there are no options", () => {
    expect(foreignServerOptionsClause([])).toBe("");
  });

  it("escapes single quotes inside option values", () => {
    expect(foreignServerOptionsClause(["pass=it's"])).toBe(`OPTIONS (pass 'it''s')`);
  });
});

describe("createForeignServerSql", () => {
  it("renders CREATE SERVER with wrapper, options and the owner ALTER", () => {
    expect(createForeignServerSql(foreignServer({ options: ["host=erp-db.internal", "port=5432", "dbname=erp"] }))).toBe(
      [`CREATE SERVER "legacy_erp" FOREIGN DATA WRAPPER "postgres_fdw" OPTIONS (host 'erp-db.internal', port '5432', dbname 'erp');`, `ALTER SERVER "legacy_erp" OWNER TO "admin";`].join("\n"),
    );
  });

  it("quotes server type and version as string literals, not identifiers", () => {
    expect(createForeignServerSql(foreignServer({ server_type: "oracle", server_version: "11g" }))).toBe(`CREATE SERVER "legacy_erp" TYPE 'oracle' VERSION '11g' FOREIGN DATA WRAPPER "postgres_fdw";\nALTER SERVER "legacy_erp" OWNER TO "admin";`);
  });

  it("skips the OPTIONS clause and the OWNER ALTER when metadata is empty", () => {
    expect(createForeignServerSql(foreignServer({ owner: "" }))).toBe(`CREATE SERVER "legacy_erp" FOREIGN DATA WRAPPER "postgres_fdw";`);
  });

  it("escapes embedded double quotes in identifiers", () => {
    expect(createForeignServerSql(foreignServer({ name: 'od"d', owner: "" }))).toBe(`CREATE SERVER "od""d" FOREIGN DATA WRAPPER "postgres_fdw";`);
  });
});
