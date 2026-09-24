import { findNext, searchPanelOpen } from "@codemirror/search";
import type { EditorView, KeyBinding } from "@codemirror/view";

/**
 * `@codemirror/search` 的 `searchKeymap` 内置硬编码了与 DBX 可配置快捷键体系
 * 冲突的键位：
 *
 * - `Mod-d` = `selectNextOccurrence`（多光标选择下一个匹配词），与 DBX 中用户
 *   可配置动作「累加下一个匹配词」冲突（见 shortcutRegistry.ts，经 QueryEditor
 *   的 binding() 走自家实现 queryEditorOccurrenceSelection）；一旦用户把
 *   `Mod+D` 改配给其他动作（例如改回「复制行」），searchKeymap 的 `Mod-d` 会在
 *   编辑器中抢先匹配并 `preventDefault`，事件冒泡到 window 时
 *   `defaultPrevented=true`，App.vue 的全局 handleKeydown 直接返回，用户配置
 *   的快捷键永不触发。这里移除该绑定（与 #4544 修复 Mod+F / Mod+H 冲突的思路
 *   一致）。
 *
 * - `F3` = `findNext`，与全局动作「打开数据库选择下拉」（focusDatabaseSelect，
 *   默认 F3）冲突。改为条件绑定：搜索面板打开时维持「查找下一个」；面板关闭时
 *   返回 false 放行，让 keydown 冒泡到 App.vue 的全局 handleKeydown 打开当前
 *   查询标签页工具栏的数据库选择下拉。
 */
export function searchKeymapWithoutShortcutConflicts(searchKeymap: readonly KeyBinding[]): KeyBinding[] {
  return searchKeymap
    .filter((binding) => binding.key !== "Mod-d")
    .map((binding) =>
      // The stock binding carries preventDefault: true, which marks the key
      // handled (and default-prevented) even when run returns false — that
      // would swallow the F3 meant for the global database-select shortcut.
      // With it dropped, a true return from findNext still prevents the
      // default (handled keydowns are always prevented); a false return now
      // really lets the event bubble to App.vue.
      binding.key === "F3" ? { ...binding, run: (view: EditorView) => (searchPanelOpen(view.state) ? findNext(view) : false), preventDefault: false } : binding,
    );
}
