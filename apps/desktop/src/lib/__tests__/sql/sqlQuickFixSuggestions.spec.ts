import { describe, expect, it } from "vitest";
import { sqlQuickFixDistanceThreshold, sqlQuickFixSuggestions } from "@/lib/sql/sqlQuickFixSuggestions";

describe("sqlQuickFixSuggestions", () => {
  it("suggests the closest metadata name for a typo", () => {
    expect(sqlQuickFixSuggestions("custumer_id", ["customer_id", "status", "created_at"])).toEqual(["customer_id"]);
  });

  it("prefers the smallest edit distance, then the same first letter", () => {
    const suggestions = sqlQuickFixSuggestions("order_line_numbre", ["other_line_number", "order_line_number", "order_line_numbers"]);
    expect(suggestions[0]).toBe("order_line_number");
    expect(new Set(suggestions)).toEqual(new Set(["order_line_number", "order_line_numbers", "other_line_number"]));
  });

  it("caps the list at three entries", () => {
    const suggestions = sqlQuickFixSuggestions("order_line", ["order_lines", "order_line2", "order_linex", "order_line_no"]);
    expect(suggestions).toHaveLength(3);
    for (const suggestion of suggestions) expect(["order_lines", "order_line2", "order_linex"]).toContain(suggestion);
  });

  it("skips case-only matches and deduplicates case variants", () => {
    // "userid" differs only in case, which the diagnostics pipeline already
    // treats as a match, so it is not offered; the case variants of the real
    // fix collapse into one entry.
    expect(sqlQuickFixSuggestions("UserID", ["userid", "USER_ID", "user_id", "unrelated"])).toEqual(["USER_ID"]);
  });

  it("strips identifier quotes on both sides before comparing", () => {
    expect(sqlQuickFixSuggestions('"custumer_id"', ["customer_id"])).toEqual(["customer_id"]);
  });

  it("counts an adjacent letter swap as a single edit", () => {
    expect(sqlQuickFixSuggestions("urs", ["usr", "abc"])).toEqual(["usr"]);
  });

  it("returns nothing for names shorter than three characters", () => {
    expect(sqlQuickFixSuggestions("id", ["uid", "pid"])).toEqual([]);
  });

  it("returns nothing when no candidate is close enough", () => {
    expect(sqlQuickFixSuggestions("totally_different", ["id", "name", "created_at"])).toEqual([]);
  });

  it("does not offer completions that merely extend the typed word", () => {
    // "customer" is a prefix of "customer_id"; mid-typing prefixes must not
    // be flagged as fixable typos of the longer name.
    expect(sqlQuickFixSuggestions("customer", ["customer_id", "customer_name"])).toEqual([]);
  });

  it("widens the threshold with name length", () => {
    expect(sqlQuickFixDistanceThreshold("abc")).toBe(1);
    expect(sqlQuickFixDistanceThreshold("custumer_id")).toBe(2);
    expect(sqlQuickFixDistanceThreshold("order_line_number_v2")).toBe(5);
    // A five-character name tolerates one edit; two is already too far.
    const suggestions = sqlQuickFixSuggestions("sales", ["sale", "sales2", "saless", "sellsy"]);
    expect(suggestions[0]).toBe("sale");
    expect(new Set(suggestions)).toEqual(new Set(["sale", "sales2", "saless"]));
  });
});

describe("sqlQuickFixSuggestions matchCandidatePrefix (completion mode, mod 62)", () => {
  it("matches a short mid-typing word against the candidate's same-length prefix", () => {
    // "usre" vs the full "user_id" is 4 edits; vs its prefix "user" it is a
    // single adjacent swap — exactly the shape typed live in the editor.
    expect(sqlQuickFixSuggestions("usre", ["id", "user_id", "name"], 3, { matchCandidatePrefix: true })).toEqual(["user_id"]);
  });

  it("still suggests when only a longer candidate's prefix matches", () => {
    // "customre" is 4 edits from the full "customer_id" but a single swap inside
    // its "customer" prefix.
    expect(sqlQuickFixSuggestions("customre", ["customer_id", "orders"], 3, { matchCandidatePrefix: true })).toEqual(["customer_id"]);
  });

  it("does not offer an exact prefix of a longer name (normal completions own that)", () => {
    expect(sqlQuickFixSuggestions("user", ["user_id", "user_name"], 3, { matchCandidatePrefix: true })).toEqual([]);
  });

  it("keeps whole-word matching when the option is absent", () => {
    expect(sqlQuickFixSuggestions("usre", ["id", "user_id", "name"])).toEqual([]);
    expect(sqlQuickFixSuggestions("customer", ["customer_id", "customer_name"])).toEqual([]);
  });
});
