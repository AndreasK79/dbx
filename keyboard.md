# DBX default keyboard shortcuts

Every action below is rebindable in **Settings → Shortcuts** (`apps/desktop/src/lib/editor/shortcutRegistry.ts` is the source of truth; this file is a snapshot). Keys are shown in their Windows/Linux form — `Mod` means `Ctrl` there and `Cmd` on macOS; the [macOS differences](#macos-differences) table lists every default that changes.

## SQL execution

| Default | Action | What it does |
| --- | --- | --- |
| `Ctrl+Enter` | Execute SQL | Runs the statement under the cursor (or the selection) |
| `Alt+X` | Execute all SQL | Runs every statement in the editor as a batch |
| `Ctrl+\` | Execute SQL in new result tab | Runs the current statement and opens its result in a separate result tab |
| `Ctrl+E` | Explain plan | Runs `EXPLAIN`/execution plan for the current statement |
| `Ctrl+Shift+Enter` | SQL intention actions | Quick fixes for the statement under the cursor: expand `*` to columns, qualify an identifier with its table |
| `Ctrl+Shift+A` | Send selection to AI | Sends the selected SQL to the AI assistant |
| `Ctrl+S` | Save SQL | Saves the current SQL (saved SQL library or external file) |
| `Ctrl+Shift+E` | Select current statement | Selects the whole statement under the cursor |
| `Ctrl+Shift+↑` | Go to previous statement | Moves the cursor to the previous statement |
| `Ctrl+Shift+↓` | Go to next statement | Moves the cursor to the next statement |
| `Alt+Home` | Go to statement start | Places the cursor at the start of the current statement |
| `F5` | Refresh data | Re-runs the active tab's data query |
| `Ctrl+Shift+C` | Commit transaction | Commits the tab's open manual transaction (only consumed while a transaction is open) |

## Find, replace & navigation

| Default | Action | What it does |
| --- | --- | --- |
| `Ctrl+F` | Find | Opens the editor's find panel |
| `Ctrl+R` | Replace | Opens the find/replace panel |
| `Ctrl+G` | Go to line | Jumps to a line number |
| `Ctrl+F` | Focus current view search | Global-scope twin of find: focuses the search of whatever surface is active |
| `F3` | Open database selector dropdown | Hands focus to the database selector; while the find panel is open, F3 is find-next instead |
| `Ctrl+P` | Quick open | Search every database object (tables, views, routines…) and open it |
| `Ctrl+Alt+F` | Global file content search | Full-text search across saved SQL files |
| `Ctrl+Alt+C` | Open connection picker | Opens the connection picker |
| `Ctrl+Alt+D` | Open database picker | Opens the database picker |
| `Ctrl+Alt+S` | Open schema picker | Opens the schema picker |
| `Escape` | Cancel search | Closes/cancels the active search field (search scope) |

## Editing & line operations

| Default | Action | What it does |
| --- | --- | --- |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo | Editor history |
| `Ctrl+A` | Select all | Selects the whole document |
| `Ctrl+Shift+F` | Format SQL | Formats the statement or whole document |
| `Ctrl+Shift+X` | Expand * to columns | Replaces `SELECT *` with the explicit column list of the tables involved |
| `Shift+Enter` | Insert line below | Adds a new line under the cursor (keeping indentation) |
| `Ctrl+J` | Join lines | Joins the selected lines (or the current and next line) with single spaces |
| `Ctrl+Shift+K` | Delete current line | Deletes the line(s) the cursor is on |
| `Alt+↑` / `Alt+↓` | Move line up / down | Moves the current line(s) |
| `Shift+Alt+↑` / `Shift+Alt+↓` | Copy line up / down | Duplicates the current line(s) above/below |
| `Shift+Tab` | Indent less | Decreases indentation |
| `Ctrl+↑` / `Ctrl+↓` | Scroll editor one line (keep cursor) | Scrolls the viewport without moving the cursor |
| `Alt+W` | Extend selection | Smart-grows the selection (word → identifier → statement → …) |

## Multi-cursor & selection transforms

| Default | Action | What it does |
| --- | --- | --- |
| `Ctrl+D` | Add next occurrence | Selects the word under the cursor; each further press adds the next match as another cursor |
| `Ctrl+Alt+Shift+J` | Select all occurrences | Selects every occurrence of the current word with one cursor each |
| `Alt+Shift+I` | Select line ends | Puts a cursor at the end of every selected line |
| `Shift+Alt+U` / `Shift+Alt+L` | Convert selection to uppercase / lowercase | Case conversion |
| `Ctrl+Shift+U` | Toggle selection case | Swaps the case of the selection |
| `Shift+Alt+C` | Toggle naming style | Switches the selection between snake_case and camelCase |
| `Ctrl+Alt+,` | Convert selection to delimited list | Turns selected values into a quoted, comma-separated list |

## Comments, folding, autocomplete & snippets

| Default | Action | What it does |
| --- | --- | --- |
| `Ctrl+/` | Toggle line comment | Comments/uncomments the line(s) with `--` |
| `Shift+Alt+A` | Toggle block comment | Comments/uncomments with `/* … */` |
| `Ctrl+.` | Toggle fold | Folds/unfolds the block under the cursor |
| `Shift+Alt+[` / `Shift+Alt+]` | Fold all / Unfold all | Folds or unfolds every foldable block |
| `Tab` | Accept completion | Accepts the highlighted autocomplete suggestion |
| `Alt+/` | Trigger completion | Opens the autocomplete menu at the cursor |
| `Ctrl+Alt+Space` | Open snippet menu | Swaps normal autocomplete for the snippet list, filtered live as you type (DBeaver-style; ignores the "Show snippets in autocomplete" toggle) |

## Tabs & windows

| Default | Action | What it does |
| --- | --- | --- |
| `Ctrl+T` | New query | Opens a new query tab |
| `Ctrl+W` | Close tab | Closes the active tab |
| `Ctrl+Shift+T` | Reopen closed tab | Restores the most recently closed tab |
| `Shift+Alt+W` | Close other tabs | Closes every tab except the active one |
| `Ctrl+Shift+W` | Close window | Closes the window |
| `Ctrl+Tab` | Tab switcher | Hold to show the switcher, release to switch |
| `Ctrl+Shift+[` / `Ctrl+Shift+]` | Switch to previous / next tab | Neighbor tab switching |
| `Ctrl+1` … `Ctrl+9` | Switch to tab 1–9 | Jumps straight to that tab |
| `Ctrl+Alt+←` / `Ctrl+Alt+→` | Navigate back / forward | Walks the tab navigation history |

## Panels, zoom & UI

| Default | Action | What it does |
| --- | --- | --- |
| `Ctrl+,` | Open settings | Opens the settings dialog |
| `Ctrl+B` | Toggle sidebar | Shows/hides the left sidebar |
| `Ctrl+Alt+I` | Toggle AI panel | Shows/hides the AI assistant panel |
| `Ctrl+Shift+F12` | Toggle Zen mode | Hides all chrome for a distraction-free editor |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset UI | Scales the whole interface |

## Data grid (results)

| Default | Action | What it does |
| --- | --- | --- |
| `F2` | Edit cell | Starts editing the focused cell |
| `Ctrl+Shift+D` | Edit table structure | Opens the structure editor for the table |
| `Ctrl+D` | Copy current data row | Copies the row under the cursor |
| `Delete` | Delete current data row | Marks the row for deletion in an editable result |
| `Tab` | Toggle transpose view | Switches the grid between normal and transposed (rows ↔ columns) |

## Sidebar (connection tree)

| Default | Action | What it does |
| --- | --- | --- |
| `Ctrl+C` / `Ctrl+V` | Copy / paste sidebar selection | Copies object names (or connection details) and pastes them back |
| `Ctrl+E` | Edit sidebar connection | Opens the connection dialog for the selected connection |
| `Ctrl+Shift+E` | Disconnect sidebar connection | Disconnects the selected connection |
| Hold `Alt` + click | Open data in new tab | Clicking a table with Alt held opens its data in a new tab |
| `Ctrl+Shift+D` | View table DDL | Shows the selected table's DDL |
| `F4` | Edit table structure | Opens the structure editor for the selected table |

## Results helpers

| Default | Action | What it does |
| --- | --- | --- |
| `Alt+1` … `Alt+5` | Copy column 1–5 of first result row | Copies the first row's Nth column value from the active tab's result (only consumed when such a result exists) |

## Unbound by default

All configurable in Settings → Shortcuts, but shipped without a key:

| Action | What it does |
| --- | --- |
| Indent more | Increases indentation |
| Duplicate current line | Same command as copy line down (`Shift+Alt+↓`); `Ctrl+D` belongs to add-next-occurrence |
| ExPaste: paste as IN condition | Pastes clipboard values as an `IN (…)` list (supported databases only) |
| Focus WHERE condition | Focuses the grid's WHERE filter |
| Go to column | Jumps to a column by name |
| First / Previous / Next / Last page | Grid paging |
| Toggle results pane | Shows/hides the results pane |
| Close all tabs | Closes every open tab |
| Save all tabs | Saves every tab at once |
| Disconnect all active connections | Self-explanatory |

## macOS differences

| Action | Windows/Linux | macOS |
| --- | --- | --- |
| Scroll editor one line | `Ctrl+↑` / `Ctrl+↓` | `Ctrl+Alt+↑` / `Ctrl+Alt+↓` |
| Select all occurrences | `Ctrl+Alt+Shift+J` | `Ctrl+Cmd+G` |
| Close other tabs | `Shift+Alt+W` | `Alt+Cmd+W` |
| Go to line | `Ctrl+G` | `Cmd+Alt+G` |
| Fold all / Unfold all | `Shift+Alt+[` / `Shift+Alt+]` | `Ctrl+Alt+[` / `Ctrl+Alt+]` |
| Toggle AI panel | `Ctrl+Alt+I` | `Ctrl+Cmd+I` |
| Everything `Ctrl+…` | `Ctrl` | `Cmd` (`Mod`), e.g. `Cmd+Enter` executes, `Cmd+D` adds an occurrence |

## Built-in (not in the shortcut registry)

| Default | What it does |
| --- | --- |
| `Shift+Delete` / `Ctrl+X` with no selection | Cuts the whole line to the clipboard (CodeMirror line-wise cut; works on the last line too) |
| `Ctrl+Alt+Enter` in the find/replace panel | Replace all |
| `Shift`, `Shift` (double-tap) | Opens the database object search dialog |
| `Escape` | Closes open dialogs, menus, and popovers |
