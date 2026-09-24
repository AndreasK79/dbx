// @vitest-environment happy-dom

import { createApp, h, nextTick, type App, defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";

vi.mock("@/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const passthrough = defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("div", attrs, slots.default?.());
    },
  });
  return { Dialog: passthrough, DialogContent: passthrough };
});

vi.mock("@/components/ui/input", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    // Options API on purpose: the dialog focuses the Input through a template
    // ref, which on a script-setup component only sees exposed members.
    Input: defineComponent({
      inheritAttrs: false,
      props: ["modelValue", "defaultValue", "type", "placeholder", "class"],
      emits: ["update:modelValue"],
      methods: {
        focus(this: { $el: HTMLInputElement }) {
          this.$el.focus();
        },
      },
      setup(props, { attrs, emit }) {
        return () => h("input", { ...attrs, value: props.modelValue as string, onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value) });
      },
    }),
  };
});

vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: vi.fn(),
}));

vi.mock("@/stores/queryStore", () => ({
  useQueryStore: vi.fn(),
}));

vi.mock("@/stores/savedSqlStore", () => ({
  useSavedSqlStore: vi.fn(),
}));

vi.mock("@/lib/backend/api", () => ({
  listObjects: vi.fn(),
}));

import * as api from "@/lib/backend/api";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";
import DatabaseObjectSearchDialog from "@/components/object-search/DatabaseObjectSearchDialog.vue";

const mountedApps: App[] = [];

function mockActiveDatabase(objects: any[] = []) {
  vi.mocked(useConnectionStore).mockReturnValue({ activeConnectionId: "c1", getConfig: vi.fn().mockReturnValue({ id: "c1", db_type: "mysql", database: "db1" }), treeNodes: [], connections: [] } as any);
  vi.mocked(useQueryStore).mockReturnValue({ tabs: [{ id: "t1", connectionId: "c1", database: "db1" }], activeTabId: "t1" } as any);
  vi.mocked(api.listObjects).mockResolvedValue(objects);
}

function objectRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-object-type]")];
}

async function mountDialog() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp(
    defineComponent({
      setup() {
        return () => h(DatabaseObjectSearchDialog, { open: true });
      },
    }),
  );
  mountedApps.push(app);
  app.use(i18n);
  app.mount(container);
  await nextTick();
}

describe("DatabaseObjectSearchDialog", () => {
  beforeEach(() => {
    vi.mocked(api.listObjects).mockReset();
  });

  afterEach(() => {
    for (const app of mountedApps.splice(0)) app.unmount();
    document.body.innerHTML = "";
    i18n.global.locale.value = "en";
  });

  it("shows the loading state, then the objects of the active database", async () => {
    mockActiveDatabase([
      { name: "users", object_type: "TABLE" },
      { name: "users_guard", object_type: "TRIGGER", schema: "public" },
    ]);
    let resolveObjects!: (value: any[]) => void;
    vi.mocked(api.listObjects).mockImplementation(() => new Promise((resolve) => (resolveObjects = resolve)));
    await mountDialog();
    expect(document.querySelector("[data-object-search-loading]")).not.toBeNull();

    resolveObjects([
      { name: "users", object_type: "TABLE" },
      { name: "users_guard", object_type: "TRIGGER", schema: "public" },
    ]);
    await vi.waitFor(() => expect(objectRows()).toHaveLength(2));
    const rows = objectRows();
    expect(rows.map((row) => row.dataset.objectType)).toEqual(["table", "trigger"]);
    expect(rows[0]!.textContent).toContain("users");
    expect(rows[1]!.textContent).toContain("public");
  });

  it("shows the no-active-database state when no connection is active", async () => {
    vi.mocked(useConnectionStore).mockReturnValue({ activeConnectionId: null, getConfig: vi.fn().mockReturnValue(undefined), treeNodes: [], connections: [] } as any);
    vi.mocked(useQueryStore).mockReturnValue({ tabs: [], activeTabId: null } as any);
    await mountDialog();
    await nextTick();

    expect(document.querySelector("[data-object-search-empty]")?.textContent).toContain("No active database");
    expect(api.listObjects).not.toHaveBeenCalled();
  });

  it("shows the error state when loading fails", async () => {
    mockActiveDatabase([]);
    vi.mocked(api.listObjects).mockRejectedValue(new Error("connection refused"));
    await mountDialog();

    await vi.waitFor(() => expect(document.querySelector("[data-object-search-error]")).not.toBeNull());
    expect(document.querySelector("[data-object-search-error]")?.textContent).toContain("connection refused");
  });

  it("filters the list as you type", async () => {
    mockActiveDatabase([
      { name: "users", object_type: "TABLE" },
      { name: "user_events", object_type: "TABLE" },
      { name: "orders", object_type: "TABLE" },
    ]);
    await mountDialog();
    await vi.waitFor(() => expect(objectRows()).toHaveLength(3));

    const input = document.querySelector<HTMLInputElement>("[data-object-search-input]")!;
    input.value = "user";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();

    expect(objectRows().map((row) => row.dataset.objectType)).toEqual(["table", "table"]);
    expect(objectRows().map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("users"), expect.stringContaining("user_events")]));
    expect(objectRows()).toHaveLength(2);
  });

  it("emits select with the highlighted item on Enter and closes", async () => {
    mockActiveDatabase([
      { name: "users", object_type: "TABLE" },
      { name: "orders", object_type: "TABLE" },
    ]);
    const onSelect = vi.fn();
    const onUpdateOpen = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp(defineComponent({ setup: () => () => h(DatabaseObjectSearchDialog, { open: true, onSelect, "onUpdate:open": onUpdateOpen }) }));
    mountedApps.push(app);
    app.use(i18n);
    app.mount(container);
    await vi.waitFor(() => expect(objectRows()).toHaveLength(2));

    const input = document.querySelector<HTMLInputElement>("[data-object-search-input]")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await nextTick();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ type: "table", label: "orders", objectName: "orders", connectionId: "c1", database: "db1" });
    expect(onUpdateOpen).toHaveBeenLastCalledWith(false);
  });

  it("emits select on click and closes", async () => {
    mockActiveDatabase([{ name: "users", object_type: "FUNCTION", schema: "public", signature: "(int)" }]);
    const onSelect = vi.fn();
    const onUpdateOpen = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp(defineComponent({ setup: () => () => h(DatabaseObjectSearchDialog, { open: true, onSelect, "onUpdate:open": onUpdateOpen }) }));
    mountedApps.push(app);
    app.use(i18n);
    app.mount(container);
    await vi.waitFor(() => expect(objectRows()).toHaveLength(1));

    objectRows()[0]!.click();
    await nextTick();

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ type: "function", label: "users", signature: "(int)", schema: "public" });
    expect(onUpdateOpen).toHaveBeenLastCalledWith(false);
  });

  it("closes on Escape without selecting", async () => {
    mockActiveDatabase([{ name: "users", object_type: "TABLE" }]);
    const onSelect = vi.fn();
    const onUpdateOpen = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp(defineComponent({ setup: () => () => h(DatabaseObjectSearchDialog, { open: true, onSelect, "onUpdate:open": onUpdateOpen }) }));
    mountedApps.push(app);
    app.use(i18n);
    app.mount(container);
    await vi.waitFor(() => expect(objectRows()).toHaveLength(1));

    const input = document.querySelector<HTMLInputElement>("[data-object-search-input]")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();

    expect(onSelect).not.toHaveBeenCalled();
    expect(onUpdateOpen).toHaveBeenLastCalledWith(false);
  });

  it("shows Source and View on table-like rows but only Source on routines", async () => {
    mockActiveDatabase([
      { name: "users", object_type: "TABLE" },
      { name: "active_users", object_type: "VIEW" },
      { name: "audit_fn", object_type: "FUNCTION", schema: "public" },
    ]);
    await mountDialog();
    await vi.waitFor(() => expect(objectRows()).toHaveLength(3));

    const [tableRow, viewRow, functionRow] = objectRows();
    expect(tableRow!.querySelector("[data-object-search-source]")).not.toBeNull();
    expect(tableRow!.querySelector("[data-object-search-view-data]")).not.toBeNull();
    expect(viewRow!.querySelector("[data-object-search-source]")).not.toBeNull();
    expect(viewRow!.querySelector("[data-object-search-view-data]")).not.toBeNull();
    expect(functionRow!.querySelector("[data-object-search-source]")).not.toBeNull();
    expect(functionRow!.querySelector("[data-object-search-view-data]")).toBeNull();
  });

  it("emits source as the default target and data for the View button, without double-firing", async () => {
    mockActiveDatabase([{ name: "users", object_type: "TABLE" }]);
    const onSelect = vi.fn();
    const onUpdateOpen = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp(defineComponent({ setup: () => () => h(DatabaseObjectSearchDialog, { open: true, onSelect, "onUpdate:open": onUpdateOpen }) }));
    mountedApps.push(app);
    app.use(i18n);
    app.mount(container);
    await vi.waitFor(() => expect(objectRows()).toHaveLength(1));

    const row = objectRows()[0]!;
    row.click();
    await nextTick();
    row.querySelector<HTMLButtonElement>("[data-object-search-source]")!.click();
    await nextTick();
    row.querySelector<HTMLButtonElement>("[data-object-search-view-data]")!.click();
    await nextTick();

    // Row click and the Source button both select with the source target; the
    // View button selects with the data target. Clicks on the buttons stop
    // propagation, so each fires exactly once.
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect.mock.calls[0]!.slice(0, 2)).toEqual([expect.objectContaining({ objectName: "users" }), "source"]);
    expect(onSelect.mock.calls[1]!.slice(0, 2)).toEqual([expect.objectContaining({ objectName: "users" }), "source"]);
    expect(onSelect.mock.calls[2]!.slice(0, 2)).toEqual([expect.objectContaining({ objectName: "users" }), "data"]);
    expect(onUpdateOpen).toHaveBeenLastCalledWith(false);
  });
});
