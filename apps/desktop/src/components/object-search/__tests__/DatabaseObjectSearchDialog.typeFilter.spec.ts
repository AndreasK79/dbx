// @vitest-environment happy-dom

import { createApp, nextTick, type App } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";
import * as api from "@/lib/backend/api";

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
  listSchemas: vi.fn(),
}));

vi.mock("@/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const passthrough = defineComponent({
    setup(_props, { slots }) {
      return () => h("div", slots.default?.());
    },
  });
  return { Dialog: passthrough, DialogContent: passthrough };
});

vi.mock("@/components/ui/input", async () => {
  const { defineComponent, h, ref } = await import("vue");
  return {
    Input: defineComponent({
      props: { modelValue: { type: String, default: "" } },
      emits: ["update:modelValue"],
      inheritAttrs: false,
      setup(props, { attrs, emit, expose }) {
        const el = ref<HTMLInputElement | null>(null);
        expose({ focus: () => el.value?.focus() });
        return () =>
          h("input", {
            ...attrs,
            ref: el,
            value: props.modelValue,
            onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value),
          });
      },
    }),
  };
});

import DatabaseObjectSearchDialog from "../DatabaseObjectSearchDialog.vue";

const { getConfig } = { getConfig: vi.fn() };
const mountedApps: Array<{ app: App; host: HTMLElement }> = [];

function mockStores() {
  vi.mocked(useConnectionStore).mockReturnValue({ activeConnectionId: "c1", getConfig, treeNodes: [], connections: [] } as any);
  vi.mocked(useQueryStore).mockReturnValue({ tabs: [{ id: "t1", connectionId: "c1", database: "db1" }], activeTabId: "t1" } as any);
}

async function mountDialog(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(DatabaseObjectSearchDialog, { open: true });
  app.use(i18n);
  app.mount(host);
  mountedApps.push({ app, host });
  await vi.waitFor(() => {
    if (!host.querySelector("[data-object-search-filters]")) throw new Error("filter row not rendered yet");
  });
  return host;
}

describe("DatabaseObjectSearchDialog type filter and kind icons", () => {
  beforeEach(() => {
    getConfig.mockReset();
    vi.mocked(api.listObjects).mockReset();
    vi.mocked(api.listSchemas).mockReset();
    getConfig.mockReturnValue({ id: "c1", db_type: "mysql", database: "db1" });
    mockStores();
    vi.mocked(api.listObjects).mockResolvedValue([
      { name: "users", object_type: "TABLE" },
      { name: "active_users", object_type: "VIEW" },
      { name: "format_name", object_type: "FUNCTION" },
    ]);
  });

  afterEach(() => {
    for (const { app, host } of mountedApps.splice(0)) {
      app.unmount();
      host.remove();
    }
  });

  it("renders one toggleable chip per supported kind, colored like the sidebar", async () => {
    const host = await mountDialog();

    const chips = Array.from(host.querySelectorAll<HTMLElement>("[data-object-search-filter]"));
    expect(chips.map((chip) => chip.dataset.objectSearchFilter)).toEqual(["table", "view", "procedure", "function", "trigger"]);
    for (const chip of chips) {
      expect(chip.getAttribute("aria-pressed")).toBe("true");
    }
    // Sidebar color coding: tables are green, functions amber.
    expect(chips.find((chip) => chip.dataset.objectSearchFilter === "table")?.className).toContain("text-green-500");
    expect(chips.find((chip) => chip.dataset.objectSearchFilter === "function")?.className).toContain("text-amber-500");
  });

  it("clicking a chip removes that kind's rows and toggling it back restores them", async () => {
    const host = await mountDialog();

    host.querySelector<HTMLElement>('[data-object-search-filter="table"]')!.click();
    await nextTick();

    expect(Array.from(host.querySelectorAll<HTMLElement>("[data-object-search-list] [data-object-type]")).map((row) => row.dataset.objectType)).toEqual(["view", "function"]);
    expect(host.querySelector<HTMLElement>('[data-object-search-filter="table"]')?.getAttribute("aria-pressed")).toBe("false");

    host.querySelector<HTMLElement>('[data-object-search-filter="table"]')!.click();
    await nextTick();

    expect(Array.from(host.querySelectorAll<HTMLElement>("[data-object-search-list] [data-object-type]")).map((row) => row.dataset.objectType)).toEqual(["table", "view", "function"]);
  });

  it("marks every result row with the sidebar's kind icon and colored type badge", async () => {
    const host = await mountDialog();

    const tableIcon = host.querySelector<HTMLElement>('[data-object-search-kind-icon="table"]');
    expect(tableIcon?.tagName.toLowerCase()).toBe("svg");
    expect(tableIcon?.getAttribute("class")).toContain("text-green-500");

    const functionIcon = host.querySelector<HTMLElement>('[data-object-search-kind-icon="function"]');
    expect(functionIcon?.tagName.toLowerCase()).toBe("svg");
    expect(functionIcon?.getAttribute("class")).toContain("text-amber-500");

    expect(host.querySelector<HTMLElement>('[data-object-search-type-badge="view"]')?.className).toContain("text-purple-500");
  });
});
