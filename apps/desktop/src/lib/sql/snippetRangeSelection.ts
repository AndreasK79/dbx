// Settings → Snippets 列表复选框的 Shift 范围选择：以最近一次普通点击的行为
// 锚点，Shift+点击另一行时把两者之间（含端点，按可见行顺序）统一设为指定状
// 态——调用方传入被点击行翻转后的勾选态（点成什么，整段跟成什么），缺省沿用
// 锚点当前状态。锚点不存在、不在当前可见行里（被筛选隐藏、已删除）或就是被
// 点击的行本身时返回 null，调用方回落为普通单行切换。
export function applySnippetRangeSelection(selected: ReadonlySet<string>, rows: ReadonlyArray<{ id: string }>, anchorId: string | undefined, clickedId: string, checked?: boolean): Set<string> | null {
  if (!anchorId || anchorId === clickedId) return null;
  const anchorIndex = rows.findIndex((row) => row.id === anchorId);
  const clickedIndex = rows.findIndex((row) => row.id === clickedId);
  if (anchorIndex < 0 || clickedIndex < 0) return null;
  const on = checked ?? selected.has(anchorId);
  const next = new Set(selected);
  const from = Math.min(anchorIndex, clickedIndex);
  const to = Math.max(anchorIndex, clickedIndex);
  for (let index = from; index <= to; index += 1) {
    const id = rows[index]!.id;
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}
