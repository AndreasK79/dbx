// @vitest-environment happy-dom

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { quoteQueryEditorWordAtCursor } from "@/lib/editor/queryEditorQuoteWord";

function createView(doc: string, selection: EditorSelection) {
  return new EditorView({
    parent: document.createElement("div"),
    state: EditorState.create({
      doc,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
  });
}

function selection(view: EditorView) {
  return view.state.selection.ranges.map(({ from, to }) => ({ from, to }));
}

describe("quoteQueryEditorWordAtCursor", () => {
  it("quotes the word at the cursor and selects the quoted identifier", () => {
    const view = createView("select * from orderhead", EditorSelection.cursor(18));

    expect(quoteQueryEditorWordAtCursor(view, '"')).toBe(true);

    expect(view.state.doc.toString()).toBe('select * from "orderhead"');
    expect(selection(view)).toEqual([{ from: 14, to: 25 }]);
  });

  it("unquotes when the cursor sits inside a quoted word", () => {
    const view = createView('select * from "orderhead"', EditorSelection.cursor(18));

    expect(quoteQueryEditorWordAtCursor(view, '"')).toBe(true);

    expect(view.state.doc.toString()).toBe("select * from orderhead");
  });

  it("toggles a selection that already carries the quotes", () => {
    const view = createView('select "order head"', EditorSelection.single(7, 19));

    expect(quoteQueryEditorWordAtCursor(view, '"')).toBe(true);

    expect(view.state.doc.toString()).toBe("select order head");
  });

  it("doubles embedded quote characters while quoting a selection", () => {
    const view = createView('select my"word', EditorSelection.single(7, 14));

    expect(quoteQueryEditorWordAtCursor(view, '"')).toBe(true);

    expect(view.state.doc.toString()).toBe('select "my""word"');
  });

  it("uses the bracket close character for SQL Server style quotes", () => {
    const view = createView("select my]word", EditorSelection.single(7, 14));

    expect(quoteQueryEditorWordAtCursor(view, "[")).toBe(true);

    expect(view.state.doc.toString()).toBe("select [my]]word]");
  });

  it("quotes every cursor and keeps later offsets stable", () => {
    const doc = "select one, two";
    const view = createView(doc, EditorSelection.create([EditorSelection.cursor(8), EditorSelection.cursor(13)]));

    expect(quoteQueryEditorWordAtCursor(view, '"')).toBe(true);

    expect(view.state.doc.toString()).toBe('select "one", "two"');
    expect(selection(view)).toEqual([
      { from: 7, to: 12 },
      { from: 14, to: 19 },
    ]);
  });

  it("quotes only once when several cursors share a word", () => {
    const view = createView("select orderhead", EditorSelection.create([EditorSelection.cursor(9), EditorSelection.cursor(12)]));

    expect(quoteQueryEditorWordAtCursor(view, '"')).toBe(true);

    expect(view.state.doc.toString()).toBe('select "orderhead"');
  });

  it("leaves the editor untouched without a word or a quote character", () => {
    const view = createView("select   one", EditorSelection.cursor(7));

    expect(quoteQueryEditorWordAtCursor(view, '"')).toBe(false);
    expect(quoteQueryEditorWordAtCursor(view, undefined)).toBe(false);

    expect(view.state.doc.toString()).toBe("select   one");
  });

  it("does not strip a quote pair that continues past the word (escaped quote)", () => {
    const doc = 'select "a""b"';
    const view = createView(doc, EditorSelection.cursor(9));

    expect(quoteQueryEditorWordAtCursor(view, '"')).toBe(true);

    // The quote right after `a` is doubled, so it is not this word's closer:
    // wrapping keeps the escaped identifier intact.
    expect(view.state.doc.toString()).toBe('select ""a"""b"');
  });
});
