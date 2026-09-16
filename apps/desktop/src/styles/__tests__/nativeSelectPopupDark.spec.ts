import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(new URL("../globals.css", import.meta.url), "utf8");
const tableImportDialogSource = readFileSync(new URL("../../components/import/TableImportDialog.vue", import.meta.url), "utf8");
const useThemeSource = readFileSync(new URL("../../composables/useTheme.ts", import.meta.url), "utf8");

describe("native select popup dark mode", () => {
  it("forces dark-mode option colors onto the popover tokens", () => {
    // color-scheme alone does not fix this: useTheme already writes
    // `doc.style.colorScheme = "dark"` inline on <html>, and the WebView2
    // runtime still paints the native option list with its own light surface
    // under the app's light option text (the CSV import mapping dropdown was
    // light-on-light and unreadable). Chromium honors background-color/color
    // on <option> inside the popup, so this rule is the part that colors it.
    const rule = globalsCss.slice(globalsCss.indexOf(".dark select option"));
    expect(globalsCss).toContain(".dark select option");
    expect(rule).toContain("background-color: var(--popover);");
    expect(rule).toContain("color: var(--popover-foreground);");
  });

  it("scopes the fix to dark mode so light popups stay OS-native", () => {
    expect(globalsCss).not.toContain("\n  select option {");
  });

  it("keeps the importer mapping dropdown a native select the rule can reach", () => {
    // The mapping dropdown is deliberately native (200+ columns make Vue
    // Select components a render bottleneck). If it ever becomes a custom
    // component, this rule stops applying to it and the popup reverts to
    // browser styling.
    expect(tableImportDialogSource).toContain("columnMapping[sourceColumn] || SKIP_VALUE");
  });

  it("keeps the runtime color-scheme write that styles native control chrome", () => {
    expect(useThemeSource).toContain('doc.style.colorScheme = dark ? "dark" : "light";');
  });
});
