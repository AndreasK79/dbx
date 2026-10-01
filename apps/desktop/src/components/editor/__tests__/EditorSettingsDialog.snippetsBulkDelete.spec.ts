import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(new URL("../EditorSettingsDialog.vue", import.meta.url), "utf8");

describe("EditorSettingsDialog snippet bulk selection and delete", () => {
  it("renders a checkbox column with a select-all header toggle", () => {
    expect(dialogSource).toContain(':checked="selectedSnippetIds.has(snippet.id)"');
    expect(dialogSource).toContain('@click="handleSnippetCheckboxClick($event, snippet)"');
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

  it("supports shift-click range selection anchored at the last plain click", () => {
    expect(dialogSource).toContain('@click="handleSnippetCheckboxClick($event, snippet)"');
    expect(dialogSource).toContain('@change="handleSnippetCheckboxChange(snippet, ($event.target as HTMLInputElement).checked)"');
    const block = dialogSource.slice(dialogSource.indexOf("function handleSnippetCheckboxClick"), dialogSource.indexOf("function toggleAllSnippetsSelected"));
    // click 只判定可否成范围并管理锚点；change 拿被点击行翻转后的勾选态推广整段
    expect(block).toContain("applySnippetRangeSelection(selectedSnippetIds.value, visibleSnippets.value, snippetSelectionAnchorId, snippet.id, checked)");
    expect(block).toContain("snippetRangeClickPending");
    expect(block).toContain("snippetSelectionAnchorId = snippet.id");
    expect(dialogSource).toContain('from "@/lib/sql/snippetRangeSelection"');
  });

  it("rides the native checkbox toggle instead of canceling it", () => {
    // WebView2 对被取消的复选框 click 的回弹晚于渲染落回：被点击行刚勾上又被弹
    // 回未选中。方案改为不 preventDefault——被点击行翻转成什么，Shift 范围就推
    // 广成什么，视觉与集合不可能分叉。
    const block = dialogSource.slice(dialogSource.indexOf("function handleSnippetCheckboxClick"), dialogSource.indexOf("function toggleAllSnippetsSelected"));
    expect(block).not.toContain("preventDefault");
    expect(block).toContain("if (checked) update.add(snippet.id)");
    expect(block).toContain("else update.delete(snippet.id)");
  });
});
