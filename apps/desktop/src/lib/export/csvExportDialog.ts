import { createApp } from "vue";
import CsvExportDialog from "@/components/export/CsvExportDialog.vue";
import i18n from "@/i18n";
import { DEFAULT_CSV_DELIMITER, DEFAULT_CSV_QUOTE_CHAR, type CsvQuoteMode, type CsvTextFormatOptions } from "@/lib/export/csvQuoteMode";

/**
 * 打开 CSV 导出选项对话框；确认返回所选格式，取消返回 null（调用方放弃导出）。
 * 引号模式默认取设置里的 editorSettings.csvQuoteMode，本次选择不回写设置。
 */
export function showCsvExportDialog(defaults: { quoteMode?: CsvQuoteMode } = {}): Promise<CsvTextFormatOptions | null> {
  if (typeof document === "undefined") {
    return Promise.resolve({
      quoteMode: defaults.quoteMode ?? "all",
      delimiter: DEFAULT_CSV_DELIMITER,
      quoteChar: DEFAULT_CSV_QUOTE_CHAR,
      includeHeader: true,
    });
  }

  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.append(container);
    let settled = false;
    let app: ReturnType<typeof createApp> | null = null;
    const finish = (value: CsvTextFormatOptions | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
      app?.unmount();
      container.remove();
    };
    app = createApp(CsvExportDialog, {
      open: true,
      defaultQuoteMode: defaults.quoteMode,
      onConfirm: (options: CsvTextFormatOptions) => finish(options),
      onCancel: () => finish(null),
    });
    app.use(i18n);
    app.mount(container);
  });
}
