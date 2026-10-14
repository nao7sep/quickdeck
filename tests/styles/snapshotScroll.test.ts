import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
// Comments go first: a rule preceded by one would otherwise not sit at a
// selector boundary, and `.modalContent` would match inside `.modalContent-fixed`.
const compact = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

function ruleIndex(selector: string): number {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = compact.match(new RegExp(`(^|[},])${escaped}\\{[^}]*\\}`));
  expect(match, `${selector} must exist`).toBeTruthy();
  return match!.index!;
}

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return compact.match(new RegExp(`(^|[},])${escaped}\\{[^}]*\\}`))?.[0] ?? "";
}

// The snapshots modal is a split whose halves each scroll. Two things have to
// hold, and each failed once on its own: the halves need a bounded height, or
// they never scroll and the body scrolls the whole split instead; and the body
// must not be a scroller behind them.
describe("snapshot browser scrolling", () => {
  it("gives the viewer tier a definite height, not only a cap", () => {
    const wide = rule(".modalSurface-wide");
    expect(wide, "a scroller inside an unbounded surface never scrolls").toMatch(
      /height:\d+(vh|px|%)/,
    );
    expect(wide.replace(/max-height:[^;}]*/g, "")).toMatch(/[;{]height:/);
  });

  it("fills the body without depending on a percentage height resolving", () => {
    const browser = rule(".snapshotBrowser");
    expect(browser).toContain("flex:1 1 auto".replace(/\s/g, ""));
    expect(browser).toContain("min-height:0");
    expect(browser).not.toContain("height:100%");
  });

  it("keeps each half's scrolling to itself", () => {
    expect(rule(".snapshotList")).toContain("overscroll-behavior:contain");
    expect(rule(".snapshotDetailpre")).toContain("overscroll-behavior:contain");
  });

  // Same specificity, so source order is the whole of it: the override has to
  // come last or the body keeps `overflow: auto` and scrolls the split.
  it("lets the fixed body actually win over the default body", () => {
    expect(rule(".modalContent-fixed")).toContain("overflow:hidden");
    expect(rule(".modalContent")).toContain("overflow:auto");
    expect(ruleIndex(".modalContent-fixed")).toBeGreaterThan(ruleIndex(".modalContent"));
  });
});
