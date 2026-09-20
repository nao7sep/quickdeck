import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, parseHex } from "../helpers/themeCss";

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
  it.each([".primaryButton", ".dangerButton", ".secondaryButton", ".dangerTrigger"])(
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

// Every animation the app runs stops, or loses its movement, for a reader who
// asks for no motion. The saving badge's pulse is the one that runs forever.
describe("reduced motion", () => {
  it("answers the preference", () => {
    expect(compact).toContain("@media(prefers-reduced-motion:reduce)");
  });

  it.each(["savePulse", "snapshotFlash"])("stops or stills %s", (animation) => {
    const declared = compact.indexOf(`animation:${animation}`);
    expect(declared, `${animation} must be used`).toBeGreaterThanOrEqual(0);
    const reduced = compact.slice(compact.indexOf("@media(prefers-reduced-motion:reduce)"));
    expect(reduced).toMatch(new RegExp(`animation(-name)?:(none|${animation}Still)`));
  });
});

// The two filled buttons are gradients, so their label is read on stops rather
// than on a token and the pair lists above cannot reach them. Both carried white
// on a fill it could not be read on — 4.2 to 4.5:1 at rest, and 3.3 to 4.1 under
// their own hover, which brightens. Each stop is checked at rest and lifted by
// that hover, since the hover is where the floor bites hardest.
describe("filled button gradients", () => {
  const WHITE = parseHex("#ffffff");
  const HOVER_LIFT = 1.1;

  function stopsOf(rule: string): string[] {
    const declaration = css.match(new RegExp(`\\${rule}\\s*\\{[^}]*?background:\\s*linear-gradient\\(([^)]*)\\)`));
    if (declaration === null) throw new Error(`${rule} no longer declares a gradient`);
    return [...declaration[1]!.matchAll(/#[0-9a-f]{6}/gi)].map(([hex]) => hex);
  }

  it.each([".primaryButton", ".dangerButton"])("keeps a white label readable on %s", (rule) => {
    const stops = stopsOf(rule);
    expect(stops.length, `${rule} must declare its stops as hex`).toBeGreaterThan(1);
    for (const stop of stops) {
      const rgb = parseHex(stop);
      const lifted = rgb.map((channel) => Math.min(255, Math.round(channel * HOVER_LIFT))) as typeof rgb;
      expect(contrast(WHITE, rgb), `white on ${rule} stop ${stop}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(WHITE, lifted), `white on hovered ${rule} stop ${stop}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
