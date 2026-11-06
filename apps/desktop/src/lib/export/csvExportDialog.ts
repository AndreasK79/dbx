import { createApp } from "vue";
import CsvExportDialog from "@/components/export/CsvExportDialog.vue";
import i18n from "@/i18n";
import { DEFAULT_CSV_DELIMITER, DEFAULT_CSV_QUOTE_CHAR, DEFAULT_CSV_QUOTE_MODE, type CsvTextFormatOptions } from "@/lib/export/csvQuoteMode";

/**
 * 打开 CSV 导出选项对话框；确认返回所选格式，取消返回 null（调用方放弃导出）。
 * defaults 传入设置里保存的上次选择（editorSettings.csvQuoteMode / csvExport*），
 * 对话框据此预填；确认后的回写由调用方完成（组件本身不挂 pinia）。
 */
export function showCsvExportDialog(defaults: Partial<CsvTextFormatOptions> = {}): Promise<CsvTextFormatOptions | null> {
  if (typeof document === "undefined") {
    return Promise.resolve({
      quoteMode: defaults.quoteMode ?? DEFAULT_CSV_QUOTE_MODE,
      delimiter: defaults.delimiter ?? DEFAULT_CSV_DELIMITER,
      quoteChar: defaults.quoteChar ?? DEFAULT_CSV_QUOTE_CHAR,
      includeHeader: defaults.includeHeader ?? true,
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
      defaultDelimiter: defaults.delimiter,
      defaultQuoteChar: defaults.quoteChar,
      defaultIncludeHeader: defaults.includeHeader,
      onConfirm: (options: CsvTextFormatOptions) => finish(options),
      onCancel: () => finish(null),
    });
    app.use(i18n);
    app.mount(container);
  });
}
