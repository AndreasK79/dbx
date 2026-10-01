// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, reactive } from "vue";
import { createI18n } from "vue-i18n";
import { afterEach, describe, expect, it } from "vitest";
import QueryResultViewSwitcher from "@/components/layout/QueryResultViewSwitcher.vue";
import type { RedisResultViewMode, TabOutputView } from "@/types/database";

const mounted: Array<{ unmount: () => void; host: HTMLElement }> = [];

afterEach(() => {
  for (const { unmount, host } of mounted.splice(0)) {
    unmount();
    host.remove();
  }
});

async function mountSwitcher(canShowRedisConsole: boolean, options: { canShowSummary?: boolean; errorCount?: number } = {}) {
  const state = reactive<{ view: TabOutputView; mode?: RedisResultViewMode }>({ view: "result" });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp(
    defineComponent({
      setup: () => () =>
        h(QueryResultViewSwitcher, {
          activeView: state.view,
          canShowResult: true,
          canShowSummary: options.canShowSummary ?? false,
          canShowChart: false,
          canShowMessages: false,
          canShowRedisConsole,
          resultMode: state.mode,
          errorCount: options.errorCount ?? 0,
          onSelectView: (view: TabOutputView) => {
            state.view = view;
          },
          onSelectResultMode: (mode: RedisResultViewMode) => {
            state.mode = mode;
          },
        }),
    }),
  );
  app.use(
    createI18n({
      legacy: false,
      locale: "en",
      messages: { en: { tabs: { tableData: "Table Data", executionSummary: "Summary", messages: "Messages" }, chart: { title: "Chart" }, redis: { commandLine: "Command line" } } },
    }),
  );
  app.mount(host);
  mounted.push({ unmount: () => app.unmount(), host });
  await nextTick();
  return { host, state };
}

describe("QueryResultViewSwitcher Redis mode", () => {
  it("defaults Redis results to the grid and switches through the existing toolbar contract", async () => {
    const { host, state } = await mountSwitcher(true);
    const grid = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Table Data"));
    const console = host.querySelector<HTMLButtonElement>('button[aria-label="Command line"]');

    expect(state.mode).toBeUndefined();
    expect(grid?.getAttribute("aria-pressed")).toBe("true");
    expect(console?.getAttribute("aria-pressed")).toBe("false");

    console?.click();
    await nextTick();

    expect(state.mode).toBe("console");
    expect(state.view).toBe("result");
    expect(console?.getAttribute("aria-pressed")).toBe("true");

    grid?.click();
    await nextTick();
    expect(state.mode).toBe("grid");
    expect(grid?.getAttribute("aria-pressed")).toBe("true");
  });

  it("does not expose the Redis-only mode on generic result toolbars", async () => {
    const { host } = await mountSwitcher(false);
    expect(host.querySelector('button[aria-label="Command line"]')).toBeNull();
  });
});

describe("QueryResultViewSwitcher error badge", () => {
  function summaryButton(host: HTMLElement) {
    return [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.getAttribute("aria-label")?.startsWith("Summary"));
  }

  it("badges the summary button with the error count", async () => {
    const { host } = await mountSwitcher(false, { canShowSummary: true, errorCount: 2 });
    const summary = summaryButton(host)!;
    expect(summary.getAttribute("aria-label")).toBe("Summary (2)");
    const badge = summary.querySelector("span.rounded-full.bg-destructive");
    expect(badge?.textContent?.trim()).toBe("2");
  });

  it("renders no badge on clean runs", async () => {
    const { host } = await mountSwitcher(false, { canShowSummary: true });
    const summary = summaryButton(host)!;
    expect(summary.getAttribute("aria-label")).toBe("Summary");
    expect(summary.querySelector("span.rounded-full.bg-destructive")).toBeNull();
  });
});
