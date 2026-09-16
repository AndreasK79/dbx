import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(new URL("../EditorSettingsDialog.vue", import.meta.url), "utf8");

describe("EditorSettingsDialog snippet bulk selection and delete", () => {
  it("renders a checkbox column with a select-all header toggle", () => {
    expect(dialogSource).toContain(':checked="selectedSnippetIds.has(snippet.id)"');
    expect(dialogSource).toContain("toggleSnippetSelected(snippet.id, ($event.target as HTMLInputElement).checked)");
    expect(dialogSource).toContain(':checked="allSnippetsSelected"');
    expect(dialogSource).toContain("aria-label=\"t('settings.snippetsSelectAll')\"");
  });

  it("offers a bulk delete button that confirms before removing the selected rows", () => {
    expect(dialogSource).toContain('t("settings.snippetsDeleteSelected"');
    const block = dialogSource.slice(dialogSource.indexOf("function deleteSelectedSnippets()"), dialogSource.indexOf("function openAddSqlShortcutDialog()"));
    expect(block).toContain("window.confirm(");
    expect(block).toContain("editSnippets.value.filter((snippet) => !selectedSnippetIds.value.has(snippet.id))");
    expect(block).toContain("selectedSnippetIds.value = new Set();");
  });

  it("drops rows removed individually from the selection", () => {
    const block = dialogSource.slice(dialogSource.indexOf("function deleteSnippet(id: string)"), dialogSource.indexOf("function confirmDeleteSnippet"));
    expect(block).toContain("selectedSnippetIds.value.delete(id);");
  });
});
