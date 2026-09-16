Here's everything added to the source tree, in order — all of it verified (tests + typecheck + lint), built, and hotfixed:

1. Configurable keybinding for "Convert to delimited text"
The command's shortcut became user-configurable under Settings → Shortcuts, instead of a hardcoded binding.
shortcutRegistry.ts, EditorSettingsDialog.vue

2. VS Code snippets importer
Settings → Snippets → Import: reads VS Code snippets JSON (.json / .code-snippets), parses prefix/body pairs, auto-renames on prefix collisions, size-caps the file, and merges into the snippet draft without touching saved settings until Apply. (The Toad XML → JSON conversion for your templates_10092026.json was a one-off data artifact for this importer, not source code.)
vscodeSnippetsImport.ts, EditorSettingsDialog.vue

3. Bulk snippet delete
Checkbox column + "select all" in the snippets list, with a confirm dialog for deleting multiple selected snippets at once.
EditorSettingsDialog.vue

4. DBeaver-style FK drill-through
In any result grid, FK cells get a clickable arrow icon (hover, in both canvas and DOM render modes) plus a context-menu entry that jumps to the referenced parent row — e.g. orders.useruid → the matching users row. Opens in the same pane (reuses the tab on table tabs; runs the lookup in-place on query tabs without clobbering the editor SQL), forward FKs only, works on JOIN results via strict per-source FK resolution. Postgres initially showed no icons on query results: unqualified sources (FROM orders) are deliberately kept schema-less for search_path resolution, and the postgres FK query matches the schema name exactly — n.nspname = '' returns nothing, so every query-tab result silently resolved zero FKs (MySQL never showed this because it folds the schema into the database). The backend now defaults an empty schema to public, matching how the same file's column/index/constraint queries already treat unqualified names. Also fixed ghost columns after following a link on postgres: the in-pane drill-through SELECT had large-value preview marker columns (__DBX_LARGE_VALUE_BYTES_*) injected into it, and the backend strips those only for table-data executions — on a query tab they showed up as extra columns. The drill lookup no longer injects them (a single parent row doesn't need the multi-row preview budget), so the drilled view — and its sort/refresh re-runs — show only real columns.
dataGridForeignKeyNavigation.ts, useDataGridSourceForeignKeys.ts, useNavigationTargets.ts, DataGrid.vue, ContentArea.vue, postgres.rs (list_foreign_keys)

5. Snippets export
Settings → Snippets → Export: saves snippets back to VS Code JSON format (duplicate labels get -2/-3 suffixes; cancel-aware — no success toast when you dismiss the save dialog).
vscodeSnippetsImport.ts (serializeVscodeSnippetsFile), EditorSettingsDialog.vue

6. Index copy-SQL
Table-info drawer → Indexes tab → per-index Copy SQL button: generates a dialect-correct CREATE INDEX (UNIQUE/PK handling, raw key expressions, postgres operator classes and USING method, SQL Server CLUSTERED/NONCLUSTERED + INCLUDE, partial-index WHERE, per-dialect quoting incl. the JDBC quote-only-when-required mode). Hidden for MongoDB.
indexCreateSql.ts, DataGridTableInfoPanels.vue, DataGrid.vue

7. Foreign-key copy-SQL
Table-info drawer → Foreign Keys tab → per-constraint Copy SQL button: generates ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY … REFERENCES …, merging the per-column metadata rows of composite FKs into one statement (grouped from the unfiltered list so drawer search filters can't truncate it), with ON DELETE/ON UPDATE actions (NO ACTION omitted) and cross-schema reference qualification. Hidden for MongoDB.
foreignKeySql.ts, DataGridTableInfoPanels.vue, DataGrid.vue

8. Enter-to-confirm in the delimited-list dialog
The "Convert to delimited list" dialog now confirms on Enter. The dialog body is wrapped in a form whose submit handler runs Confirm, and Confirm is the only submit button (Cancel and Copy are type="button"), so pressing Enter in any field — including immediately after opening, since focus lands in the first input — applies the conversion. Enter remains inert while the preview is empty (Confirm disabled), and Escape still closes.
DelimitedListDialog.vue

9. Constraints copy-SQL
Table-info drawer → Constraints tab → per-constraint Copy SQL button: generates ALTER TABLE … ADD CONSTRAINT. Uses the server-reported definition verbatim when it is a complete body (postgres pg_get_constraintdef), wraps a bare check expression in CHECK (…), and otherwise reconstructs the body from the constraint type, columns, and reference metadata (UNIQUE/PK/EXCLUDE column lists; full FOREIGN KEY … REFERENCES with ON DELETE/ON UPDATE and deferrability). Constraints with nothing to reconstruct copy as an explanatory SQL comment instead of a broken statement. Hidden for MongoDB.
constraintSql.ts, DataGridTableInfoPanels.vue, DataGrid.vue

10. Alphabetical column sort in transposed row view
The transpose view header has an A–Z toggle button: sorting the rows (column names) alphabetically to find a column in a wide table, with numeric collation (col2 before col10) and case-insensitive order. Toggling again restores the table's column order; the sort resets when the transpose view closes. The button sits left in the toolbar (next to the mode badge, before the flexible spacer) — in the narrower SQL result pane the right-side action cluster gets pushed out of view, which hid it when it lived there.
dataGridTranspose.ts (sortTransposeRowsByColumn), DataGrid.vue

11. Dark-mode native dropdown fix (two passes)
Native <select> popups (e.g. the CSV import column-mapping target dropdown) rendered with a light surface under the app's light text in dark mode, making options unreadable. First pass declared color-scheme (light on :root, dark on .dark) in the base tokens — correct defense-in-depth for native control chrome, but it turned out the app already sets color-scheme inline on <html> at runtime (useTheme), and the WebView2 runtime still paints the option list itself with light colors. Second pass forces the popup contents: in dark mode every <option> of a native select gets the popover background/foreground tokens, which Chromium honors inside browser-rendered select popups — app-wide, so all 30+ native selects get readable dark option lists. Light mode is untouched (OS-native popup).
tokens.css, globals.css, useTheme.ts (verified, not changed)

12. Snippet filter in Settings
Settings → Snippets has a filter box above the list: type to narrow the snippets by label, prefix, or SQL body (case-insensitive), with a live "Showing X of Y" count, an X button to clear, and a "no match" row when nothing fits — no more scrolling through hundreds of imported templates to find one for editing. The header select-all checkbox follows the filter (it selects/deselects exactly the visible rows), while rows hidden by the filter keep their selection, so the Delete Selected count always reflects what you actually checked.
EditorSettingsDialog.vue

13. VS Code-style Ctrl+D word/occurrence selection in the SQL editor
Ctrl+D in the query editor now works like VS Code: the first press selects the word at the caret, each further press adds the next occurrence of that word as another cursor+selection, and the multi-selections copy/paste normally with Ctrl+C/Ctrl+V (each instance lands on its own line). The occurrence-selection commands already existed in the app but were defaulted to IntelliJ-style keys (Alt+J / Ctrl+G); the default is now VS Code's Ctrl+D. "Duplicate line" previously owned Ctrl+D and runs the exact same command as "Copy line down" (Shift+Alt+↓, unchanged), so it is now unbound by default and still assignable in Settings → Shortcuts. Settings saved with the old defaults migrate automatically to the new pairing; anything you had customized yourself is untouched. "Select all occurrences" remains at Ctrl+Alt+Shift+J, also rebindable. (An interim caret-word background tint that shipped earlier was removed — not what was wanted.)
shortcutRegistry.ts, codemirrorSearchKeymap.ts, queryEditorOccurrenceSelection.ts (pre-existing), QueryEditor.vue

14. Enter-to-execute in the SQL parameter dialog
Pressing Enter in the SQL parameter dialog now executes the query instead of wiping the entered values. The dialog previously auto-focused its first focusable element — the "Clear values" header button — so an Enter right after the dialog popped activated it and cleared every parameter. The dialog body is now wrapped in a form whose submit runs Execute (Execute is the only submit button; Cancel, Copy, Ignore, and the header actions are all type="button"), and initial focus goes to the first parameter value input instead (with its contents selected, ready to type over a remembered value).
SqlParameterDialog.vue

15. Postgres foreign-server (remote links) browser
Postgres connections get a "Foreign Servers" group in the sidebar tree (next to Extensions, same databases: postgres family incl. HighGo/Vastbase via the agent fallback). Expanding it lists every cataloged remote link (pg_foreign_server — the postgres equivalent of Oracle's DB Links, since the dblink extension itself has no persistent link catalog); clicking one opens a details dialog with its FDW wrapper, owner, server type/version, connection options (host, port, dbname, ...), the server comment, its user mappings (pg_user_mappings, PUBLIC shown for the public mapping), and the foreign tables mounted through it. A "Copy CREATE SERVER SQL" button reconstructs the CREATE SERVER statement (TYPE/VERSION as string literals, options as quoted literals, identifiers properly escaped) plus ALTER SERVER … OWNER TO; user mappings are deliberately excluded from the generated SQL because pg_user_mappings hides passwords from non-privileged viewers, so the DDL would silently drop credentials.
types.rs (ForeignServerInfo), postgres.rs (list_foreign_servers + catalog SQL pin test), schema.rs/_core, commands/schema.rs, lib.rs, dbx-web routes, postgresForeignServers.ts (DDL builder), ForeignServerDetailsDialog.vue, connectionStore.ts, SidebarTreeRuntimeHost.vue, treeNodeClick/Icon/Group.ts, sidebarTreeItemLayout.ts, ConnectionTree.vue