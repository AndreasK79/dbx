// @vitest-environment happy-dom
import { createApp, h, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createI18n } from "vue-i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/button", () => ({
  Button: {
    name: "ButtonStub",
    template: `<button><slot /></button>`,
  },
}));

// Functional SearchableSelect stand-in: exposes openDropdown like the real
// component and renders buttons that replay the events a selection / close
// produce. Buttons are tagged with the selector's modelValue so tests can aim
// at the database selector specifically.
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: {
    name: "SearchableSelectStub",
    props: ["modelValue", "options"],
    setup(props: { modelValue?: string; options?: string[] }, { emit, expose }: { emit: (event: string, ...args: unknown[]) => void; expose: (exposed: Record<string, unknown>) => void }) {
      expose({
        openDropdown: () => {
          emit("update:open", true);
          return true;
        },
      });
      const tag = String(props.modelValue ?? "");
      return () =>
        h("div", { "data-stub-value": tag }, [
          h("button", {
            type: "button",
            "data-stub-select": tag,
            onClick: () => {
              emit("update:modelValue", "db-2");
              emit("update:open", false);
            },
          }),
          h("button", { type: "button", "data-stub-close": tag, onClick: () => emit("update:open", false) }),
        ]);
    },
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: { name: "TooltipStub", template: `<span><slot /></span>` },
  TooltipTrigger: { name: "TooltipTriggerStub", template: `<span><slot /></span>` },
  TooltipContent: { name: "TooltipContentStub", template: `<span><slot /></span>` },
}));

vi.mock("@/components/ui/TruncatedTextTooltip.vue", () => ({
  default: { name: "TruncatedTextTooltipStub", template: `<span />` },
}));

vi.mock("@/components/connection/ConnectionTreeSelect.vue", () => ({
  default: { name: "ConnectionTreeSelectStub", template: `<div />` },
}));

vi.mock("@/components/common/ProductionContextBadge.vue", () => ({
  default: { name: "ProductionContextBadgeStub", template: `<span />` },
}));

import EditorToolbar from "../EditorToolbar.vue";
import { useConnectionStore } from "@/stores/connectionStore";

type ToolbarExposed = { openDatabaseSelect: () => boolean };

function flushAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function mountToolbar() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const connectionStore = useConnectionStore();
  connectionStore.connections = [
    {
      id: "conn-1",
      name: "conn",
      db_type: "postgres",
      color: "",
    } as never,
  ];

  const onChangeDatabase = vi.fn();
  const onFocusQueryEditor = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(EditorToolbar, {
    activeTab: {
      id: "tab-1",
      title: "SQL",
      connectionId: "conn-1",
      database: "db-1",
      sql: "SELECT 1",
      mode: "query",
      isExecuting: false,
      isCancelling: false,
      isExplaining: false,
    },
    activeConnection: connectionStore.getConfig("conn-1"),
    executableSql: "SELECT 1",
    explainMode: "explain",
    blockDangerousRedisCommands: false,
    sqlKeywordCase: "preserve",
    databaseRequiredSignal: 0,
    autoCommit: true,
    txnSessionId: undefined,
    txnAutoRolledBack: false,
    txnPossiblyDirty: false,
    stickyProvenReadOnlyState: false,
    onChangeDatabase,
    onFocusQueryEditor,
  });
  app.use(pinia);
  app.use(createI18n({ legacy: false, locale: "en", messages: { en: {} } }));
  app.mount(host);
  await nextTick();

  const selectButton = () => host.querySelector<HTMLButtonElement>('[data-stub-select="db-1"]');
  const closeButton = () => host.querySelector<HTMLButtonElement>('[data-stub-close="db-1"]');
  const toolbar = () => (app._instance?.exposed ?? {}) as ToolbarExposed;

  return {
    selectButton,
    closeButton,
    toolbar,
    onChangeDatabase,
    onFocusQueryEditor,
    cleanup: () => {
      app.unmount();
      host.remove();
    },
  };
}

describe("EditorToolbar database select focus hand-off", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    setActivePinia(createPinia());
  });

  it("renders the database selector stub so the flow below is exercised", async () => {
    const toolbar = await mountToolbar();
    try {
      expect(toolbar.selectButton()).toBeTruthy();
    } finally {
      toolbar.cleanup();
    }
  });

  it("focuses the query editor after picking a database from the F3-opened dropdown", async () => {
    const toolbar = await mountToolbar();
    try {
      expect(toolbar.toolbar().openDatabaseSelect()).toBe(true);

      toolbar.selectButton()!.click();
      await nextTick();

      expect(toolbar.onChangeDatabase).toHaveBeenCalledWith("db-2");
      // The emit is deferred one frame so it lands after the popover's
      // focus restore to the trigger button.
      expect(toolbar.onFocusQueryEditor).not.toHaveBeenCalled();
      await flushAnimationFrame();
      expect(toolbar.onFocusQueryEditor).toHaveBeenCalledTimes(1);
    } finally {
      toolbar.cleanup();
    }
  });

  it("keeps focus on the trigger when the dropdown was opened by pointer", async () => {
    const toolbar = await mountToolbar();
    try {
      toolbar.selectButton()!.click();
      await nextTick();
      await flushAnimationFrame();

      expect(toolbar.onChangeDatabase).toHaveBeenCalledWith("db-2");
      expect(toolbar.onFocusQueryEditor).not.toHaveBeenCalled();
    } finally {
      toolbar.cleanup();
    }
  });

  it("does not focus the editor after closing the F3-opened dropdown without a selection", async () => {
    const toolbar = await mountToolbar();
    try {
      expect(toolbar.toolbar().openDatabaseSelect()).toBe(true);

      toolbar.closeButton()!.click();
      await nextTick();

      // The cancelled open must not arm a later, unrelated selection.
      toolbar.selectButton()!.click();
      await nextTick();
      await flushAnimationFrame();

      expect(toolbar.onChangeDatabase).toHaveBeenCalledWith("db-2");
      expect(toolbar.onFocusQueryEditor).not.toHaveBeenCalled();
    } finally {
      toolbar.cleanup();
    }
  });
});
