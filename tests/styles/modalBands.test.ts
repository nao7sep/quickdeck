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

// Header and footer share the section/band hairline on one surface.
describe("modal bands", () => {
  it("closes the header and opens the footer with the same band hairline", () => {
    expect(rule(".modalHeader")).toContain("border-bottom:1pxsolidvar(--border)");
    expect(rule(".modalFooter")).toContain("border-top:1pxsolidvar(--border)");
  });

  it("draws the header and footer on the dialog's own surface, not a gradient or a tint", () => {
    expect(rule(".modalHeader")).not.toContain("gradient");
    expect(rule(".modalHeader")).toContain("background:var(--surface)");
    expect(rule(".modalFooter")).toContain("background:var(--surface)");
  });

  it("moves footer actions to a new row instead of clipping them on a narrow window", () => {
    expect(rule(".modalFooter")).toContain("flex-wrap:wrap");
  });

  it("drops the header's and footer's lines when its title is hidden", () => {
    expect(rule(".modalHeader-bare")).toContain("border-bottom:0");
    expect(rule(".modalFooter-bare")).toContain("border-top:0");
    // Same specificity, so the override must come after the line it removes.
    expect(compact.indexOf(".modalFooter-bare{")).toBeGreaterThan(compact.lastIndexOf(".modalFooter{"));
    expect(rule(".modalFooter-bare")).not.toContain("padding");
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
