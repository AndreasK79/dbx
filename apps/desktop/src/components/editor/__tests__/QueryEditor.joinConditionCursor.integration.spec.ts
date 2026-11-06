// @vitest-environment happy-dom

import { createApp, h, nextTick, reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { EditorView } from "@codemirror/view";
import { acceptCompletion, currentCompletions, setSelectedCompletion, startCompletion } from "@codemirror/autocomplete";
import { afterEach, describe, expect, it, vi } from "vitest";
import QueryEditor from "../QueryEditor.vue";
import type { QueryEditorProps } from "../queryEditorTypes";
import { useSettingsStore } from "@/stores/settingsStore";
import { useConnectionStore } from "@/stores/connectionStore";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

// Spies go up before mount: the editor starts loading completion metadata for
// the referenced tables as soon as a document is set, and unstubbed loads hit
// the real HTTP backend from the test process.
async function mountEditor(overrides: Partial<QueryEditorProps> = {}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const settings = useSettingsStore();
  settings.editorSettings.showExecutionTargetPicker = false;
  settings.editorSettings.completionTriggerMode = "manual";
  const connectionStore = useConnectionStore();
  vi.spyOn(connectionStore, "getConfig").mockResolvedValue(undefined as never);
  vi.spyOn(connectionStore, "listCompletionTables").mockResolvedValue([{ name: "orders" }, { name: "customers" }] as never);
  vi.spyOn(connectionStore, "listCompletionColumns").mockImplementation(async (_connectionId: string, _database: string, table: string) =>
    table === "orders"
      ? ([
          { name: "id", table: "orders" },
          { name: "customer_id", table: "orders" },
        ] as never)
      : ([{ name: "id", table: "customers" }] as never),
  );
  vi.spyOn(connectionStore, "listCompletionForeignKeys").mockResolvedValue([{ name: "fk_orders_customer", column: "customer_id", ref_table: "customers", ref_column: "id" }] as never);
  const props = reactive<QueryEditorProps>({ modelValue: "", connectionId: "join-cursor", databaseType: "mysql", dialect: "mysql", database: "demo", autoFocus: false, ...overrides });
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp({
    render: () =>
      h(QueryEditor, {
        ...props,
        "onUpdate:modelValue": (value: string) => {
          props.modelValue = value;
        },
      }),
  });
  app.use(pinia);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} }, missingWarn: false, fallbackWarn: false }));
  app.mount(host);
  cleanups.push(() => {
    app.unmount();
    host.remove();
  });
  await vi.waitFor(() => expect(host.querySelector(".cm-editor")).not.toBeNull(), { timeout: 5000 });
  return { view: EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement)!, settings, props };
}

async function acceptForeignKeyJoinCondition(view: EditorView) {
  startCompletion(view);
  await vi.waitFor(() => expect(currentCompletions(view.state).some((item) => item.detail === "JOIN condition from foreign key")).toBe(true), { timeout: 5000 });
  const joinIndex = currentCompletions(view.state).findIndex((item) => item.detail === "JOIN condition from foreign key");
  view.dispatch({ effects: setSelectedCompletion(joinIndex) });
  await vi.waitFor(() => expect(acceptCompletion(view)).toBe(true));
}

describe("QueryEditor foreign-key JOIN condition cursor", () => {
  it.each([
    // With nothing typed after ON the insertion happens at the cursor itself,
    // which is where an unmarked snippet apply strands the selection in front
    // of the inserted condition.
    "SELECT * FROM orders o JOIN customers c ON ",
    // A typed prefix is replaced, so the cursor already mapped past the insert.
    "SELECT * FROM orders o JOIN customers c ON o",
  ])("places the cursor after the condition (%s)", async (sql) => {
    const { view } = await mountEditor({ modelValue: sql });
    view.dispatch({ selection: { anchor: sql.length } });
    await nextTick();

    await acceptForeignKeyJoinCondition(view);

    const doc = view.state.doc.toString();
    expect(doc).toBe("SELECT * FROM orders o JOIN customers c ON o.customer_id = c.id");
    // The cursor must sit after the inserted condition, not in front of it.
    expect(view.state.selection.main.head).toBe(doc.length);
  });
});
