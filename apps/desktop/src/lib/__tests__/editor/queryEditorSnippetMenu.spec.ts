// @vitest-environment happy-dom

import { EditorSelection, EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { autocompletion, closeCompletion, completionStatus, currentCompletions, startCompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { describe, expect, it, vi } from "vitest";
import { createSnippetMenuState } from "@/lib/editor/queryEditorSnippetMenu";
import { buildSnippetMenuItems } from "@/lib/sql/sqlCompletion";
import { completionLabelPresentation } from "@/lib/editor/sqlCompletionPresentation";
import type { SqlSnippet } from "@/types/database";

const SNIPPET_OPTIONS = [{ label: "select all — snippet" }, { label: "insert row — snippet" }];
const KEYWORD_OPTIONS = [{ label: "SELECT" }];

function createMenuView(onSource?: (menuRequest: boolean) => void) {
  const menu = createSnippetMenuState({ StateEffect, StateField }, (state) => completionStatus(state));
  const source = (context: CompletionContext): CompletionResult => {
    const menuRequested = menu.isActive(context.state);
    onSource?.(menuRequested);
    return menuRequested ? { from: 0, options: SNIPPET_OPTIONS } : { from: 0, options: KEYWORD_OPTIONS };
  };
  const view = new EditorView({
    parent: document.createElement("div"),
    state: EditorState.create({
      doc: "sel",
      selection: EditorSelection.cursor(3),
      extensions: [menu.extensions, autocompletion({ override: [source] })],
    }),
  });
  return { menu, view };
}

describe("createSnippetMenuState", () => {
  it("is inactive until opened", () => {
    const { menu, view } = createMenuView();

    expect(menu.isActive(view.state)).toBe(false);
  });

  it("swaps the completion list for the snippet menu and reports the request to the source", async () => {
    const menuRequests: boolean[] = [];
    const { menu, view } = createMenuView((menuRequested) => menuRequests.push(menuRequested));

    expect(menu.open(view, startCompletion)).toBe(true);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));

    expect(menuRequests[menuRequests.length - 1]).toBe(true);
    // The typed text ("sel") still filters the menu live: only the snippet
    // whose label starts with it survives CodeMirror's matcher.
    expect(currentCompletions(view.state).map((completion) => completion.label)).toEqual(["select all — snippet"]);
  });

  it("clears the request once the menu closes, so a plain trigger is back to normal", async () => {
    const { menu, view } = createMenuView();

    menu.open(view, startCompletion);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));

    closeCompletion(view);
    expect(menu.isActive(view.state)).toBe(false);

    startCompletion(view);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    expect(currentCompletions(view.state).map((completion) => completion.label)).toEqual(["SELECT"]);
  });

  it("clears the request when the menu query comes up empty", async () => {
    const menu = createSnippetMenuState({ StateEffect, StateField }, (state) => completionStatus(state));
    const view = new EditorView({
      parent: document.createElement("div"),
      state: EditorState.create({
        doc: "sel",
        selection: EditorSelection.cursor(3),
        extensions: [
          menu.extensions,
          autocompletion({
            override: [(context) => (menu.isActive(context.state) ? null : ({ from: 0, options: KEYWORD_OPTIONS } as CompletionResult))],
          }),
        ],
      }),
    });

    menu.open(view, startCompletion);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBeNull());

    expect(menu.isActive(view.state)).toBe(false);
  });

  // Mirrors buildSnippetMenuCompletionResult: word head as `from`, typed prefix
  // for the exact-trigger boost, no `validFor` so the source re-runs per
  // keystroke, and completionLabelPresentation for the option labels.
  it("ranks the exactly typed trigger first, ahead of longer-trigger siblings", async () => {
    const snippets: SqlSnippet[] = [
      { id: "scgb", label: "Select Customer Group By", prefix: "scgb", body: "GROUP BY ${customer};" },
      { id: "sc", label: "Select Customers", prefix: "sc", body: "SELECT *\nFROM customers;" },
    ];
    const menu = createSnippetMenuState({ StateEffect, StateField }, (state) => completionStatus(state));
    const source = (context: CompletionContext): CompletionResult => {
      if (!menu.isActive(context.state)) return { from: 0, options: KEYWORD_OPTIONS };
      const word = context.state.wordAt(context.pos);
      const from = word ? word.from : context.pos;
      const typed = word ? context.state.sliceDoc(from, context.pos) : "";
      const options = buildSnippetMenuItems(snippets, undefined, undefined, typed).map((item) => ({
        ...completionLabelPresentation(item.label, item.filterText),
        type: item.type,
        detail: item.detail,
        boost: item.boost,
      }));
      return { from, options };
    };
    const view = new EditorView({
      parent: document.createElement("div"),
      state: EditorState.create({
        doc: "sc",
        selection: EditorSelection.cursor(2),
        extensions: [menu.extensions, autocompletion({ override: [source], compareCompletions: (a, b) => (a.sortText || a.label).localeCompare(b.sortText || b.label) })],
      }),
    });

    try {
      menu.open(view, startCompletion);
      await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
      // Both labels fuzzy-match the typed "sc" with the same match score; the
      // exact-trigger boost must still pin "sc" above the "scgb" sibling.
      expect(currentCompletions(view.state).map((completion) => completion.displayLabel ?? completion.label)).toEqual(["Select Customers", "Select Customer Group By"]);

      view.dispatch({ changes: { from: 2, insert: "gb" }, selection: { anchor: 4 }, userEvent: "input.type" });
      await vi.waitFor(() => expect(currentCompletions(view.state).map((completion) => completion.displayLabel ?? completion.label)).toEqual(["Select Customer Group By"]));

      // Backspacing revives the "sc" option: the source re-ran, so the boost
      // follows the live word instead of freezing at menu-open time.
      view.dispatch({ changes: { from: 2, to: 4 }, userEvent: "delete.backward" });
      await vi.waitFor(() => expect(currentCompletions(view.state).map((completion) => completion.displayLabel ?? completion.label)).toEqual(["Select Customers", "Select Customer Group By"]));
    } finally {
      view.destroy();
    }
  });

  // Real-world shape from the bug report: uppercase sibling labels, a "sc"
  // entry whose trigger is empty (the label is the only match surface), and an
  // UPPERCASE typed word. CodeMirror scores the uppercase siblings at -100 and
  // the case-folded "sc" at -202, which ranked it fourth without the boost.
  it("ranks a label-only exact match first when typing uppercase past uppercase siblings", async () => {
    const snippets: SqlSnippet[] = [
      { id: "scall", label: "SCALL", prefix: "scall", body: "SELECT * FROM call;" },
      { id: "scallitem", label: "SCALLITEM", prefix: "scallitem", body: "SELECT * FROM call_item;" },
      { id: "scdelivery", label: "SCDELIVERY", prefix: "scdelivery", body: "SELECT * FROM delivery;" },
      { id: "sc", label: "sc", prefix: "", body: "SELECT * FROM customers;" },
      { id: "scgb", label: "scgb", prefix: "scgb", body: "SELECT * FROM customers GROUP BY 1;" },
    ];
    const menu = createSnippetMenuState({ StateEffect, StateField }, (state) => completionStatus(state));
    const source = (context: CompletionContext): CompletionResult => {
      if (!menu.isActive(context.state)) return { from: 0, options: KEYWORD_OPTIONS };
      const word = context.state.wordAt(context.pos);
      const from = word ? word.from : context.pos;
      const typed = word ? context.state.sliceDoc(from, context.pos) : "";
      const options = buildSnippetMenuItems(snippets, undefined, undefined, typed).map((item) => ({
        ...completionLabelPresentation(item.label, item.filterText),
        type: item.type,
        detail: item.detail,
        boost: item.boost,
      }));
      return { from, options };
    };
    const view = new EditorView({
      parent: document.createElement("div"),
      state: EditorState.create({
        doc: "SC",
        selection: EditorSelection.cursor(2),
        extensions: [menu.extensions, autocompletion({ override: [source], compareCompletions: (a, b) => (a.sortText || a.label).localeCompare(b.sortText || b.label) })],
      }),
    });

    try {
      menu.open(view, startCompletion);
      await vi.waitFor(() => expect(currentCompletions(view.state).map((completion) => completion.displayLabel ?? completion.label)).toEqual(["sc", "SCALL", "SCALLITEM", "SCDELIVERY", "scgb"]));
    } finally {
      view.destroy();
    }
  });
});
