import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(new URL("../EditorSettingsDialog.vue", import.meta.url), "utf8");

describe("EditorSettingsDialog VS Code snippets export wiring", () => {
  it("offers an Export button next to Import, disabled without snippets", () => {
    expect(dialogSource).toContain('t("settings.snippetsExport")');
    expect(dialogSource).toContain(':disabled="snippetsExporting || editSnippets.length === 0"');
    expect(dialogSource).toContain('@click="onExportSnippetsClick"');
  });

  it("exports the draft through the serializer and the platform save path", () => {
    const block = dialogSource.slice(dialogSource.indexOf("function onExportSnippetsClick"), dialogSource.indexOf("function openAddSqlShortcutDialog"));
    expect(block).toContain("serializeVscodeSnippetsFile(editSnippets.value)");
    expect(block).toContain('await import("@tauri-apps/plugin-dialog")');
    expect(block).toContain('await import("@tauri-apps/plugin-fs")');
    expect(block).toContain("await writeTextFile(target,");
    // A cancelled save dialog must not report success.
    expect(block).toContain('if (typeof target !== "string") return;');
    // Same Apply-based rule as the import: the export handlers never write to
    // the settings store.
    expect(block).not.toContain("updateEditorSettings");
    expect(block).not.toContain("persistEditorSettings");
    expect(block).not.toContain("settingsStore");
  });
});
