import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const compact = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

function rule(selector: string): string {
  const match = compact.match(new RegExp(`(?:^|\\})${selector.replace(/[.[\]()]/g, "\\$&")}\\{([^}]*)\\}`));
  if (match === null) throw new Error(`${selector} has no rule of its own`);
  return match[1]!;
}

// A line closes the title bar and opens the action row, in the app's one hairline
// (modal-dialog-conventions). The title bar used to be a violet gradient with no
// line while the action row had one. The hairline is pinned to --control-edge,
// not the fainter --border divider token, because the convention requires it
// read no fainter than the app's own control borders in either theme; and both
// bands share the dialog surface's own background rather than a tint or a muted
// fill, because "each band is drawn as a band" on one shared surface.
describe("modal bands", () => {
  it("closes the header and opens the footer with the same hairline, no fainter than the app's control borders", () => {
    expect(rule(".modalHeader")).toContain("border-bottom:1pxsolidvar(--control-edge)");
    expect(rule(".modalFooter")).toContain("border-top:1pxsolidvar(--control-edge)");
  });

  it("draws the header and footer on the dialog's own surface, not a gradient or a tint", () => {
    expect(rule(".modalHeader")).not.toContain("gradient");
    expect(rule(".modalHeader")).toContain("background:var(--surface)");
    expect(rule(".modalFooter")).toContain("background:var(--surface)");
  });

  it("drops the header's line when its title is hidden", () => {
    expect(rule(".modalHeader-bare")).toContain("border-bottom:0");
  });

  it("keeps the close control in its trailing corner", () => {
    expect(rule(".modalClose")).toContain("margin-left:auto");
  });

  it("pads the body equally at both ends", () => {
    expect(rule(".modalContent")).toContain("padding:20px");
  });
});

// One focus treatment, just clear of the edge, softened while the window is
// inactive (interface-styling-conventions).
describe("focus treatment", () => {
  it("rings controls 1px clear of their edge in the app's ring colour", () => {
    expect(compact).toContain("button:focus-visible,");
    expect(compact).toContain("outline:2pxsolidvar(--focus-ring);outline-offset:1px");
  });

  it("quiets the ring while the window is inactive", () => {
    expect(rule(":root[data-window-inactive]")).toContain("--focus-ring:var(--input-border)");
  });

  it("recedes every button role by the one disabled value", () => {
    for (const role of [".primaryButton:disabled", ".iconButton:disabled", ".modalClose:disabled"]) {
      expect(rule(role)).toContain("opacity:var(--disabled-opacity)");
    }
  });
});

// The outlined destructive trigger is written on top of an outlined role
// (`secondaryButton dangerTrigger`, `iconTextButton dangerTrigger`) at the same
// specificity, so it keeps its red in each state only by coming after them.
describe("destructive trigger", () => {
  it.each([":hover", ":active"])("keeps its red when %s over an outlined role", (state) => {
    const trigger = compact.indexOf(`.dangerTrigger${state}{`);
    for (const role of [".secondaryButton", ".iconTextButton"]) {
      expect(trigger, `${role}${state}`).toBeGreaterThan(compact.indexOf(`${role}${state}{`));
    }
  });
});
