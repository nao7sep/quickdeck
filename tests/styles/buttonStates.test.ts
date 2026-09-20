import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const compact = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

// Nothing moves or resizes on hover or press (interface-styling-conventions).
// Both filled buttons used to answer a click by shrinking to 97 per cent — the
// pattern two other apps in the fleet had already replaced with a surface step,
// and one this app cannot even switch off, having no reduced-motion block.
describe("button pressed states", () => {
  it("answers a press with a surface step, never a resize", () => {
    expect(compact).not.toContain("transform:scale(");
    expect(compact).toContain("--pressed-brightness:");
  });

  // A mouse press matches :hover and :active at once, so a pressed rule only
  // shows if it beats the hover rule for the same button: same selector shape,
  // one pseudo-class apart, and declared after it.
  it.each([".primaryButton", ".dangerButton", ".secondaryButton"])(
    "%s presses with a step beyond its own hover",
    (role) => {
      const hoverAt = compact.indexOf(`${role}:hover{`);
      const pressedAt = compact.indexOf(`${role}:active{`);
      expect(hoverAt, `${role}:hover must exist`).toBeGreaterThanOrEqual(0);
      expect(pressedAt, `${role}:active must exist and follow its hover rule`)
        .toBeGreaterThan(hoverAt);
    },
  );
});
