import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  initialListWidth,
  RECORDS_DETAIL_MIN_WIDTH,
  RECORDS_FILTERS_HEIGHT,
  RECORDS_GAP,
  RECORDS_LIST_MIN_HEIGHT,
  RECORDS_LIST_SIBLING_MIN,
  RECORDS_LIST_WIDTH,
  RECORDS_PADDING,
  RECORDS_WINDOW_MIN_HEIGHT,
  RECORDS_WINDOW_MIN_WIDTH,
} from "../../src/records/recordsLayout";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule for ${selector}`);
  return match[1];
}

describe("Records window layout", () => {
  it("derives the window minimum from the panes' minimums and the chrome", () => {
    expect(RECORDS_WINDOW_MIN_WIDTH).toBe(
      RECORDS_PADDING * 2 + RECORDS_LIST_WIDTH.min + RECORDS_GAP + RECORDS_DETAIL_MIN_WIDTH + 4,
    );
    expect(RECORDS_WINDOW_MIN_HEIGHT).toBe(RECORDS_PADDING * 2 + 2 + RECORDS_FILTERS_HEIGHT + RECORDS_LIST_MIN_HEIGHT);
    expect(RECORDS_LIST_SIBLING_MIN).toBe(RECORDS_PADDING * 2 + RECORDS_GAP + RECORDS_DETAIL_MIN_WIDTH);
  });

  it("keeps the list bounds about 320 to 640 pixels, opening at 380", () => {
    expect(RECORDS_LIST_WIDTH).toEqual({ min: 320, default: 380, max: 640 });
  });

  it("mirrors the stylesheet's padding, gap and detail minimum", () => {
    const shell = rule(".recordsShell");
    expect(shell).toContain(`padding: ${RECORDS_PADDING}px`);
    expect(shell).toContain(`gap: ${RECORDS_GAP}px`);
    expect(shell).toContain(`minmax(${RECORDS_DETAIL_MIN_WIDTH}px, 1fr)`);
    expect(shell).toContain(`var(--records-list-width, ${RECORDS_LIST_WIDTH.default}px)`);
    expect(rule(".recordsFilters")).toContain("padding: 12px");
    expect(rule(".recordsFilters")).toContain("gap: 8px");
  });

  it("opens at the saved width, held to the bounds, or at the default", () => {
    expect(initialListWidth(null)).toBe(RECORDS_LIST_WIDTH.default);
    expect(initialListWidth(Number.NaN)).toBe(RECORDS_LIST_WIDTH.default);
    expect(initialListWidth(450)).toBe(450);
    expect(initialListWidth(5000)).toBe(RECORDS_LIST_WIDTH.max);
    expect(initialListWidth(10)).toBe(RECORDS_LIST_WIDTH.min);
  });
});
