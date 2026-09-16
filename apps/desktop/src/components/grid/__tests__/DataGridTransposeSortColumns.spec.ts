import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../DataGrid.vue", import.meta.url), "utf8");

describe("Transpose view alphabetical column sort", () => {
  it("applies the sort to transposeRows only when the toggle is on", () => {
    const block = source.slice(source.indexOf("const transposeRows = computed"), source.indexOf("const transposeReserveTypeLine"));
    expect(block).toContain("buildVisibleTransposeRows({");
    expect(block).toContain("return transposeSortAlpha.value ? sortTransposeRowsByColumn(rows) : rows;");
  });

  it("offers a sort toggle in the transpose header", () => {
    expect(source).toContain("ArrowDownAZ");
    expect(source).toContain("transposeSortAlpha = !transposeSortAlpha");
    expect(source).toContain("t('grid.transposeSortColumnsOriginal')");
    expect(source).toContain("t('grid.transposeSortColumns')");
    expect(source).toContain(":class=\"{ 'text-primary': transposeSortAlpha }\"");
  });

  it("keeps the sort toggle left of the spacer so narrow panes cannot clip it", () => {
    // The toggle originally sat in the right-side action cluster after the
    // flex-1 spacer; in the narrower SQL result pane that cluster was pushed
    // out of view and the button looked missing.
    const header = source.slice(source.indexOf('v-else-if="isTransposeMode"'), source.indexOf('ref="transposeScrollRef"'));
    expect(header).toContain("ArrowDownAZ");
    expect(header.indexOf("ArrowDownAZ")).toBeGreaterThan(-1);
    expect(header.indexOf("ArrowDownAZ")).toBeLessThan(header.indexOf('<span class="flex-1" />'));
    expect(header.indexOf("ArrowDownAZ")).toBeLessThan(header.indexOf("transposeNav(-1)"));
  });

  it("resets the ordering when the transpose view closes", () => {
    const block = source.slice(source.indexOf("watch(isTransposeMode, (active)"), source.indexOf("watch(isTransposeMode, (active)") + 900);
    expect(block).toContain("disconnectTransposeViewportObserver();");
    expect(block).toContain("transposeSortAlpha.value = false;");
  });
});
