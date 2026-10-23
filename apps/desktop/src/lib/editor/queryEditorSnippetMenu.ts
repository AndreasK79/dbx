import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * CodeMirror pieces the snippet-menu state is built from. Passed in (from the
 * lazy editor runtime) instead of imported so this module stays out of the
 * eager bundle; specs pass the real modules directly.
 */
export interface SnippetMenuModules {
  StateEffect: typeof import("@codemirror/state").StateEffect;
  StateField: typeof import("@codemirror/state").StateField;
}

/** Reads CodeMirror's completion state lazily ("active" | "pending" | null). */
export type SnippetMenuCompletionStatus = (state: EditorState) => string | null;

export interface SnippetMenuController {
  /** True while the open completion query should show the snippet menu. */
  isActive: (state: EditorState) => boolean;
  /** Request the snippet menu for the next completion query and open it. */
  open: (view: EditorView, startCompletion: ((view: EditorView) => boolean) | null | undefined) => boolean;
  /** Install next to autocompletion(). */
  extensions: Extension;
}

/**
 * Per-editor state for the explicit snippet menu (DBeaver's Ctrl+Alt+Space):
 * a flag the completion source reads to swap mixed suggestions for the
 * snippet list. The flag only outlives its own completion query — the field
 * clears itself on the first transaction that leaves no query open anymore
 * (accepted, escaped, empty, or focus moved), so a later plain trigger never
 * inherits snippet-only mode. No dispatching from listeners: the close is
 * read off `transaction.state`, which already reflects it.
 */
export function createSnippetMenuState(modules: SnippetMenuModules, completionStatus: SnippetMenuCompletionStatus): SnippetMenuController {
  const { StateEffect, StateField } = modules;
  const openEffect = StateEffect.define<boolean>();
  const field = StateField.define<boolean>({
    create: () => false,
    update: (value, transaction) => {
      if (transaction.effects.some((effect) => effect.is(openEffect))) return true;
      if (!value) return false;
      return completionStatus(transaction.state) !== null;
    },
  });
  return {
    isActive: (state) => state.field(field, false) === true,
    open: (view, startCompletion) => {
      view.dispatch({ effects: openEffect.of(true) });
      return startCompletion?.(view) !== false;
    },
    extensions: field,
  };
}
