// @vitest-environment happy-dom

import { createApp, h, nextTick, type App, defineComponent } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";

vi.mock("@/components/ui/dialog", async () => {
  const { defineComponent, h } = await import("vue");
  const passthrough = defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("div", attrs, slots.default?.());
    },
  });
  return { Dialog: passthrough, DialogContent: passthrough, DialogHeader: passthrough, DialogTitle: passthrough, DialogFooter: passthrough };
});

vi.mock("@/components/ui/button", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    // 真实 Button 默认 type="button"（提交需显式 type="submit"），mock 保持同一契约。
    Button: defineComponent({
      inheritAttrs: false,
      setup(_props, { attrs, slots }) {
        return () => h("button", { type: "button", ...attrs }, slots.default?.());
      },
    }),
  };
});

import CsvExportDialog from "@/components/export/CsvExportDialog.vue";

const mountedApps: App[] = [];

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  document.body.innerHTML = "";
  i18n.global.locale.value = "en";
});

async function mountDialog(onConfirm = () => {}, onCancel = () => {}, defaultQuoteMode?: "all" | "necessary" | "never") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp(
    defineComponent({
      setup() {
        return () => h(CsvExportDialog, { open: true, defaultQuoteMode, onConfirm, onCancel });
      },
    }),
  );
  mountedApps.push(app);
  app.use(i18n);
  app.mount(container);
  await nextTick();
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CsvExportDialog", () => {
  it("defaults to all-quoting, comma, double quotes, and header included", async () => {
    const onConfirm = vi.fn();
    await mountDialog(onConfirm);

    expect(document.querySelector<HTMLInputElement>('input[data-csv-quote-mode="all"]')?.checked).toBe(true);
    expect(document.querySelector<HTMLSelectElement>("[data-csv-delimiter]")?.value).toBe("comma");
    expect(document.querySelector<HTMLSelectElement>("[data-csv-quote-char]")?.value).toBe("double");
    expect(document.querySelector<HTMLInputElement>("[data-csv-include-header]")?.checked).toBe(true);

    document.querySelector<HTMLButtonElement>("[data-csv-export-confirm]")?.click();
    expect(onConfirm).toHaveBeenCalledWith({ quoteMode: "all", delimiter: ",", quoteChar: '"', includeHeader: true });
  });

  it("starts from the settings-provided default quote mode", async () => {
    const onConfirm = vi.fn();
    await mountDialog(onConfirm, () => {}, "necessary");
    expect(document.querySelector<HTMLInputElement>('input[data-csv-quote-mode="necessary"]')?.checked).toBe(true);

    document.querySelector<HTMLButtonElement>("[data-csv-export-confirm]")?.click();
    expect(onConfirm).toHaveBeenCalledWith({ quoteMode: "necessary", delimiter: ",", quoteChar: '"', includeHeader: true });
  });

  it("emits the chosen delimiter, quote character, quote mode, and header switch", async () => {
    const onConfirm = vi.fn();
    await mountDialog(onConfirm);

    document.querySelector<HTMLInputElement>('input[data-csv-quote-mode="never"]')?.click();
    await nextTick();
    setSelectValue(document.querySelector<HTMLSelectElement>("[data-csv-delimiter]")!, "tab");
    setSelectValue(document.querySelector<HTMLSelectElement>("[data-csv-quote-char]")!, "single");
    const header = document.querySelector<HTMLInputElement>("[data-csv-include-header]")!;
    header.click();
    await nextTick();

    document.querySelector<HTMLButtonElement>("[data-csv-export-confirm]")?.click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith({ quoteMode: "never", delimiter: "\t", quoteChar: "'", includeHeader: false });
  });

  it("requires a character for custom delimiter and quote character before confirming", async () => {
    const onConfirm = vi.fn();
    await mountDialog(onConfirm);

    setSelectValue(document.querySelector<HTMLSelectElement>("[data-csv-delimiter]")!, "custom");
    await nextTick();
    const confirm = document.querySelector<HTMLButtonElement>("[data-csv-export-confirm]")!;
    expect(confirm.disabled).toBe(true);

    setInputValue(document.querySelector<HTMLInputElement>("[data-csv-custom-delimiter]")!, "|");
    await nextTick();
    expect(confirm.disabled).toBe(false);

    setSelectValue(document.querySelector<HTMLSelectElement>("[data-csv-quote-char]")!, "custom");
    await nextTick();
    expect(confirm.disabled).toBe(true);
    setInputValue(document.querySelector<HTMLInputElement>("[data-csv-custom-quote-char]")!, "`");
    await nextTick();
    expect(confirm.disabled).toBe(false);

    confirm.click();
    expect(onConfirm).toHaveBeenCalledWith({ quoteMode: "all", delimiter: "|", quoteChar: "`", includeHeader: true });
  });

  it("confirms on Enter via the form wrapper", async () => {
    const onConfirm = vi.fn();
    await mountDialog(onConfirm);

    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith({ quoteMode: "all", delimiter: ",", quoteChar: '"', includeHeader: true });
  });

  it("emits cancel without confirming", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    await mountDialog(onConfirm, onCancel);

    const cancel = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Cancel"));
    cancel?.click();

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
