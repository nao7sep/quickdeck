import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const compact = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

// Every declaration in the rules whose selector list names this selector.
function declarations(selector: string): string {
  const bodies: string[] = [];
  for (const match of compact.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].split(",").includes(selector)) bodies.push(match[2]);
  }
  if (bodies.length === 0) throw new Error(`${selector} has no rule`);
  return bodies.join(";");
}

const ONE_LINE = ["overflow:hidden", "text-overflow:ellipsis", "white-space:nowrap", "min-width:0"];

// interface-styling-conventions, Labels: identifying text takes one line and
// keeps its beginning; the whole value is reachable where the item is selected.
describe("identifying text", () => {
  it.each([
    [".paneSwitcherTitle", "the zen status bar's pane name"],
    [".paneSwitcherOptionTitle", "a pane name in the switcher's list"],
    [".snapshotRowPane", "a snapshot row's pane name"],
    [".menuItemLabel", "a menu command's label"],
    [".recordsRowTitle", "a record row's message"],
    [".recordsRowText", "a record row's operation"],
  ])("%s keeps to one line (%s)", (selector) => {
    const rule = declarations(selector);
    for (const declaration of ONE_LINE) expect(rule, `${selector} ${declaration}`).toContain(declaration);
    expect(rule).not.toContain("overflow-wrap");
  });

  it("reads a snapshot's whole pane name inside the detail's scroll region", () => {
    expect(declarations(".snapshotDetailPane")).toContain("overflow-wrap:anywhere");
    expect(declarations(".snapshotDetailBody")).toContain("overflow:auto");
  });
});

// composite-control-conventions, Menu: as wide as the longest item up to a cap.
describe("popup width", () => {
  it.each([".menuPanel", ".paneSwitcherPanel"])("%s sizes to its content up to a cap", (selector) => {
    const rule = declarations(selector);
    expect(rule).toContain("width:max-content");
    expect(rule).toMatch(/max-width:min\(\d+px,calc\(100vw-\d+px\)\)/);
  });
});
