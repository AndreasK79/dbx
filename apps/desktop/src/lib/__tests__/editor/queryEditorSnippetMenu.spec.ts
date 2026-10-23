// @vitest-environment happy-dom

import { EditorSelection, EditorState, StateEffect, StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { autocompletion, closeCompletion, completionStatus, currentCompletions, startCompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { describe, expect, it, vi } from "vitest";
import { createSnippetMenuState } from "@/lib/editor/queryEditorSnippetMenu";

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
});
