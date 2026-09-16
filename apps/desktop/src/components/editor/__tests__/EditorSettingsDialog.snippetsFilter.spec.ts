import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(new URL("../EditorSettingsDialog.vue", import.meta.url), "utf8");
const enSource = readFileSync(new URL("../../../i18n/locales/en.ts", import.meta.url), "utf8");
const zhCnSource = readFileSync(new URL("../../../i18n/locales/zh-CN.ts", import.meta.url), "utf8");

describe("EditorSettingsDialog snippet filter", () => {
  it("filters snippets by label, prefix, or body case-insensitively", () => {
    const block = dialogSource.slice(dialogSource.indexOf("const snippetFilter = ref"), dialogSource.indexOf("// --- Snippet bulk selection ---"));
    expect(block).toContain("const visibleSnippets = computed");
    expect(block).toContain("snippetFilter.value.trim().toLocaleLowerCase()");
    ["label", "prefix", "body"].forEach((field) => {
      expect(block).toContain(`snippet.${field}.toLocaleLowerCase().includes(query)`);
    });
  });

  it("renders the list from the filtered rows with a match count and clear button", () => {
    expect(dialogSource).toContain('v-model="snippetFilter"');
    expect(dialogSource).toContain('v-for="snippet in visibleSnippets"');
    expect(dialogSource).toContain('t("settings.snippetsFilterCount", { shown: visibleSnippets.length, total: editSnippets.length })');
    expect(dialogSource).toContain("@click=\"snippetFilter = ''\"");
    expect(dialogSource).toContain('v-if="visibleSnippets.length === 0"');
    expect(dialogSource).toContain('colspan="6"');
  });

  it("scopes select-all to the filtered rows while keeping hidden selections", () => {
    const block = dialogSource.slice(dialogSource.indexOf("// --- Snippet bulk selection ---"), dialogSource.indexOf("function deleteSelectedSnippets()"));
    expect(block).toContain("visibleSnippets.value.length > 0 && visibleSnippets.value.every");
    expect(block).toContain("const next = new Set(selectedSnippetIds.value)");
    expect(block).toContain("for (const snippet of visibleSnippets.value)");
    expect(block).toContain("if (checked) next.add(snippet.id)");
    expect(block).toContain("else next.delete(snippet.id)");
  });

  it("ships the filter strings in both locales", () => {
    ["snippetsFilterPlaceholder", "snippetsFilterCount", "snippetsFilterNoMatch", "snippetsFilterClear"].forEach((key) => {
      expect(enSource).toContain(`${key}:`);
      expect(zhCnSource).toContain(`${key}:`);
    });
  });
});
