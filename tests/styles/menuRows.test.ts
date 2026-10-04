import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const compact = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

// Every rule body whose selector list names this selector exactly.
function rulesFor(selector: string): string[] {
  const bodies: string[] = [];
  for (const match of compact.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (match[1].split(",").includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

// The zoom row sits among the menu items, so its icon, label and inset line up
// with theirs: one rule sizes both, and the stepper is pushed to the row's end.
describe("menu rows", () => {
  it("sizes the zoom row with the rule that sizes the menu items", () => {
    const shared = rulesFor(".menuZoomRow").filter((body) => rulesFor(".menuPanelbutton").includes(body));
    expect(shared).toHaveLength(1);
    for (const declaration of ["gap:10px", "min-height:38px", "padding:8px12px", "align-items:center"]) {
      expect(shared[0]).toContain(declaration);
    }
  });

  it("never centres the zoom row, and ends it with the stepper", () => {
    expect(rulesFor(".menuZoomRow").join(";")).not.toContain("justify-content");
    expect(rulesFor(".menuZoomControls").join(";")).toContain("margin-inline-start:auto");
  });
});
