import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(new URL("../EditorSettingsDialog.vue", import.meta.url), "utf8");

describe("EditorSettingsDialog VS Code snippets import wiring", () => {
  it("offers an Import button and a browser-mode file input in the snippets tab", () => {
    expect(dialogSource).toContain('t("settings.snippetsImport")');
    expect(dialogSource).toContain("onImportSnippetsClick");
    expect(dialogSource).toContain('ref="snippetsFileInputRef"');
    expect(dialogSource).toContain('accept=".json,.code-snippets,application/json"');
  });

  it("applies imports through the parse/merge helpers into the draft only", () => {
    const block = dialogSource.slice(dialogSource.indexOf("function applyImportedSnippetsText"), dialogSource.indexOf("function translateSnippetsImportError"));
    expect(block).toContain("parseVscodeSnippetsFile(text)");
    expect(block).toContain("mergeImportedVscodeSnippets(editSnippets.value, result.value)");
    expect(block).toContain("editSnippets.value = merged.snippets;");
    // The snippets tab is Apply-based: the import handlers must not write to
    // the settings store directly.
    expect(block).not.toContain("updateEditorSettings");
    expect(block).not.toContain("persistEditorSettings");
    expect(block).not.toContain("settingsStore");
  });
});
