import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Closing quote for an identifier quote: `[` closes with `]`, every other quote with itself. */
export function identifierCloseQuote(quote: string): string {
  return quote === "[" ? "]" : quote;
}

/**
 * Quote — or, when already quoted, unquote — the word at each cursor, or each
 * selection range when the selection is non-empty.
 *
 * Toggling works from inside: the word under the caret plus its adjacent quote
 * pair counts as the quoted form, so a second press restores the bare word.
 * Quoting doubles embedded quote characters the way SQL requires
 * (`my"word` → `"my""word"`, `my]word` → `[my]]word]`, `O'Brien` → `'O''Brien'`).
 */
export function quoteQueryEditorWordAtCursor(view: EditorView, quote: string | undefined): boolean {
  if (!quote) return false;
  const close = identifierCloseQuote(quote);
  const state = view.state;

  const targets: { from: number; to: number }[] = [];
  for (const range of state.selection.ranges) {
    if (range.empty) {
      const word = state.wordAt(range.head);
      if (!word || word.from === word.to) continue;
      targets.push({ from: word.from, to: word.to });
    } else {
      targets.push({ from: range.from, to: range.to });
    }
  }
  if (targets.length === 0) return false;
  targets.sort((left, right) => left.from - right.from || left.to - right.to);
  // Several cursors can share one word, and a cursor's word may reach into a
  // neighbouring selection; one edit per span keeps the change set valid.
  const spans: { from: number; to: number }[] = [];
  for (const target of targets) {
    const previous = spans.length > 0 ? spans[spans.length - 1] : undefined;
    if (previous && target.from < previous.to) continue;
    spans.push(target);
  }

  const changes: { from: number; to: number; insert: string }[] = [];
  const ranges: { from: number; to: number }[] = [];
  let delta = 0;
  for (const target of spans) {
    const text = state.sliceDoc(target.from, target.to);
    // A selection may already carry the quotes itself; a bare word looks at the
    // characters around it. Both require the pair to sit at the span boundary —
    // a doubled quote next to it means the identifier continues (an escaped
    // embedded quote), which is not this word's pair to strip.
    const quotedSpan =
      text.length >= quote.length + close.length && text.startsWith(quote) && text.endsWith(close)
        ? { from: target.from, to: target.to, inner: text.slice(quote.length, text.length - close.length) }
        : target.from >= quote.length &&
            state.sliceDoc(target.from - quote.length, target.from) === quote &&
            state.sliceDoc(target.to, target.to + close.length) === close &&
            state.sliceDoc(target.from - quote.length * 2, target.from - quote.length) !== quote &&
            state.sliceDoc(target.to + close.length, target.to + close.length * 2) !== close
          ? { from: target.from - quote.length, to: target.to + close.length, inner: state.sliceDoc(target.from, target.to) }
          : undefined;
    const replacement = quotedSpan ? unescapeIdentifierQuotes(quotedSpan.inner, quote, close) : quote + escapeIdentifierQuotes(text, quote, close) + close;
    const from = quotedSpan?.from ?? target.from;
    const to = quotedSpan?.to ?? target.to;
    changes.push({ from, to, insert: replacement });
    ranges.push({ from: from + delta, to: from + delta + replacement.length });
    delta += replacement.length - (to - from);
  }

  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges.map((range) => EditorSelection.range(range.from, range.to))),
    userEvent: "input.quote",
  });
  return true;
}

function escapeIdentifierQuotes(text: string, quote: string, close: string): string {
  if (quote !== close) return text.split(close).join(close + close);
  return text.split(quote).join(quote + quote);
}

function unescapeIdentifierQuotes(text: string, quote: string, close: string): string {
  if (quote !== close) return text.split(close + close).join(close);
  return text.split(quote + quote).join(quote);
}
