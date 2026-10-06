// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp, h, nextTick, type App } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import ErrorBanner from "@/components/ui/ErrorBanner.vue";
import i18n from "@/i18n";

// Source-pin: the centered variant's readability contract (headline/detail
// split, single scroll surface, full-message copy) is easy to regress with a
// well-meaning class tweak, so pin it alongside the mount tests.
const source = readFileSync(resolve(process.cwd(), "apps/desktop/src/components/ui/ErrorBanner.vue"), "utf8");

const mountedApps: App[] = [];

async function mountBanner(message: string) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({
    setup: () => () => h(ErrorBanner, { message, variant: "centered" }),
  });
  mountedApps.push(app);
  app.use(i18n);
  app.mount(host);
  await nextTick();
  return host;
}

async function mountCard(props: { message: string; tone?: "error" | "warning"; title?: string }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = createApp({
    setup: () => () => h(ErrorBanner, { message: props.message, variant: "card", tone: props.tone ?? "error", title: props.title, dismissible: true }),
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

describe("ErrorBanner centered variant (source contract)", () => {
  it("pins the headline/report split styling", () => {
    expect(source).toContain("max-w-3xl");
    expect(source).toContain("overflow-y-auto rounded-md border border-border bg-muted/30");
    expect(source).toContain("font-mono text-xs leading-relaxed text-muted-foreground");
    expect(source).toContain("whitespace-pre-wrap break-words select-text cursor-text");
    // The detail panel is the only scroll surface and must keep min-w-0 so long
    // unspaced backend tokens wrap instead of widening the centered child.
    expect(source).toContain("#7960");
    expect(source).toContain("min-h-0 min-w-0 flex-1 overflow-y-auto");
  });

  it("keeps a single copy handler over the full message", () => {
    expect(source).toContain("copyToClipboard(props.message)");
    expect(source.match(/copyToClipboard\(/g)?.length ?? 0).toBe(1);
  });
});

describe("ErrorBanner centered variant (render)", () => {
  it("splits a multi-line error into a red headline and a monospace report panel", async () => {
    const host = await mountBanner("ERROR: division by zero\nDETAIL: 1/0 was evaluated\nHINT: avoid dividing by zero");
    const headline = host.querySelector<HTMLElement>("div.text-sm");
    const panel = host.querySelector<HTMLElement>(".overflow-y-auto");

    expect(headline?.textContent?.trim()).toBe("ERROR: division by zero");
    expect(headline?.className).toContain("text-destructive");
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain("font-mono");
    expect(panel?.textContent).toContain("DETAIL: 1/0 was evaluated");
    expect(panel?.textContent).toContain("HINT: avoid dividing by zero");
    expect(panel?.textContent).not.toContain("ERROR: division by zero");
  });

  it("renders a single-line error as the headline without a report panel", async () => {
    const host = await mountBanner("ERROR: relation does not exist");

    expect(host.querySelector(".overflow-y-auto")).toBeNull();
    expect(host.querySelector<HTMLElement>("div.text-sm")?.textContent?.trim()).toBe("ERROR: relation does not exist");
  });

  it("still offers the copy action alongside the split rendering", async () => {
    const host = await mountBanner("ERROR: division by zero\nDETAIL: 1/0 was evaluated");
    const labels = Array.from(host.querySelectorAll("button"), (button) => button.textContent?.trim());

    expect(labels).toContain("Copy");
  });
});

describe("ErrorBanner card variant warning tone", () => {
  it("swaps the destructive palette for the house amber warning palette", async () => {
    const host = await mountCard({ message: "0 affected rows", tone: "warning", title: "Nothing Was Written" });
    const card = host.querySelector<HTMLElement>(".border-t")!;
    const titleRow = host.querySelector<HTMLElement>("div.font-medium")!;

    expect(card.className).toContain("bg-amber-500/10");
    expect(card.className).toContain("border-amber-500/30");
    expect(titleRow.className).toContain("text-amber-700");
    expect(titleRow.className).not.toContain("text-destructive");
    expect(titleRow.textContent).toContain("Nothing Was Written");
    expect(host.querySelector<HTMLElement>("div.font-mono")?.className).toContain("text-amber-800");
  });

  it("keeps the destructive palette by default and still exposes copy/dismiss in warning tone", async () => {
    const destructiveHost = await mountCard({ message: "constraint violation" });
    expect(destructiveHost.querySelector<HTMLElement>(".border-t")?.className).toContain("bg-destructive/10");

    const warningHost = await mountCard({ message: "0 affected rows", tone: "warning" });
    const labels = Array.from(warningHost.querySelectorAll("button"), (button) => button.getAttribute("aria-label"));
    expect(labels).toContain("Copy");
    expect(labels).toContain("Dismiss");
  });
});
