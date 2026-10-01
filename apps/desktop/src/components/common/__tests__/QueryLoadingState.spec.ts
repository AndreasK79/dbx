// @vitest-environment happy-dom

import { createApp, h, nextTick, type App } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import QueryLoadingState from "@/components/common/QueryLoadingState.vue";
import i18n from "@/i18n";

const mountedApps: App[] = [];

async function mountLoadingState(props: { noticeLine?: string; noticeCount?: number } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({
    setup: () => () => h(QueryLoadingState, { ...props }),
  });
  mountedApps.push(app);
  app.use(i18n);
  app.mount(host);
  await nextTick();
  return host;
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  document.body.replaceChildren();
});

describe("QueryLoadingState streaming notice ticker", () => {
  it("renders no ticker when nothing has streamed yet", async () => {
    const host = await mountLoadingState();

    expect(host.querySelector("[data-streaming-notice-line]")).toBeNull();
  });

  it("renders the latest notice as a truncated one-line ticker with count and full-line title", async () => {
    const host = await mountLoadingState({ noticeLine: "NOTICE: step 3 of 5", noticeCount: 3 });
    const ticker = host.querySelector<HTMLElement>("[data-streaming-notice-line]");

    expect(ticker).not.toBeNull();
    expect(ticker?.textContent).toContain("Latest message (3)");
    expect(ticker?.textContent).toContain("NOTICE: step 3 of 5");
    // Truncation is visual only: the title carries the untruncated line.
    expect(ticker?.title).toBe("NOTICE: step 3 of 5");
    expect(ticker?.className).toContain("truncate");
    expect(ticker?.className).toContain("font-mono");
  });

  it("defaults the displayed count to 1 when only the line is provided", async () => {
    const host = await mountLoadingState({ noticeLine: "NOTICE: started" });

    expect(host.querySelector("[data-streaming-notice-line]")?.textContent).toContain("Latest message (1)");
  });
});
