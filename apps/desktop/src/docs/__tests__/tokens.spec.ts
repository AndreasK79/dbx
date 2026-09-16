import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const stylesDir = path.resolve(__dirname, "../../styles");

/** Every `--name:` custom property declared in a stylesheet. */
function declaredTokens(file: string): Set<string> {
  const source = readFileSync(path.join(stylesDir, file), "utf8");
  return new Set(Array.from(source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm), (match) => match[1]));
}

describe("design tokens", () => {
  it("defines the tokens the docs viewer resolves against", () => {
    // These are the utilities used in src/docs/**: bg-background,
    // text-foreground, text-muted-foreground, bg-muted, border-border,
    // focus:border-ring. If a token stops being declared here the export
    // renders unstyled while the app, which has globals.css, looks fine —
    // so this must be checked against tokens.css, not globals.css.
    const tokens = declaredTokens("tokens.css");
    for (const token of ["--background", "--foreground", "--muted", "--muted-foreground", "--border", "--ring"]) {
      expect(tokens.has(token), `tokens.css must declare ${token}`).toBe(true);
    }
  });

  it("keeps globals.css importing the extracted tokens", () => {
    const globals = readFileSync(path.join(stylesDir, "globals.css"), "utf8");
    expect(globals.includes('@import "./tokens.css"')).toBe(true);
  });

  it("declares the dark overrides after the light ones", () => {
    // Custom properties resolve at use time, but override order still
    // decides which block wins. A tokens.css with .dark BEFORE :root leaves
    // dark mode rendering light values.
    const source = readFileSync(path.join(stylesDir, "tokens.css"), "utf8");
    const root = source.search(/^:root\s*\{/m);
    const dark = source.search(/^\.dark\s*\{/m);
    expect(root, "tokens.css must declare :root").toBeGreaterThan(-1);
    expect(dark, "tokens.css must declare .dark").toBeGreaterThan(-1);
    expect(dark).toBeGreaterThan(root);
  });

  it("pins color-scheme to the app theme so native controls follow it", () => {
    // Native <select> popups, scrollbars, and date pickers are OS-rendered from
    // color-scheme. Without these, dark mode shows light popups under the app's
    // light text (unreadable option lists in native selects app-wide).
    const source = readFileSync(path.join(stylesDir, "tokens.css"), "utf8");
    const rootBlock = source.slice(source.search(/^:root\s*\{/m), source.search(/^\.dark\s*\{/m));
    const darkBlock = source.slice(source.search(/^\.dark\s*\{/m));
    expect(rootBlock).toContain("color-scheme: light");
    expect(darkBlock).toContain("color-scheme: dark");
  });
});
