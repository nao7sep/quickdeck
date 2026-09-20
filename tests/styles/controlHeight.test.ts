import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const compact = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "");

// Every selector that takes its height from the shared value, whichever rule
// declares it. Looking the rules up by declaration rather than by selector
// keeps this honest: a selector's own rule may exist without carrying it.
function selectorsSizedByControlHeight(property: "height" | "min-height"): string[] {
  const declaration = `${property}:var(--control-height)`;
  const selectors: string[] = [];
  for (const match of compact.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const body = match[2];
    // `min-height:` also ends with `height:`, so an exact property match matters.
    const declared = body
      .split(";")
      .some((part) => part === declaration);
    if (declared) {
      selectors.push(...match[1].split(",").map((one) => one.trim()));
    }
  }
  return selectors;
}

// One height for every one-line field and action button. The rule exists
// because a row that mixes them — a search box beside its Search button — shows
// any difference immediately, and because an unstyled select takes the
// platform's height instead of the app's.
describe("one control height", () => {
  it("is a named value, not repeated numbers", () => {
    expect(compact).toContain("--control-height:36px");
  });

  it("sizes every one-line field from it", () => {
    const sized = selectorsSizedByControlHeight("height");
    for (const field of [
      '.formGridinput[type="text"]',
      '.formGridinput[type="number"]',
      ".formGridselect",
      ".searchBoxinput",
    ]) {
      expect(sized, `${field} must take the shared height`).toContain(field);
    }
  });

  it("sizes every action button from it", () => {
    const sized = selectorsSizedByControlHeight("min-height");
    for (const button of [
      ".iconTextButton",
      ".primaryButton",
      ".secondaryButton",
      ".dangerButton",
    ]) {
      expect(sized, `${button} must take the shared height`).toContain(button);
    }
  });

  it("leaves no hard-coded standard control height behind", () => {
    expect(compact).not.toMatch(/min-height:3[46]px/);
  });

  // Left out of `font: inherit`, a select keeps the UA's own font — Arial at
  // regular weight beside the app's system-ui at semibold, which reads as
  // smaller text — and the UI font setting never reaches it.
  it("gives every form control the app's font, selects included", () => {
    const inheriting = compact.match(/([^{}]*)\{font:inherit;?\}/)?.[1] ?? "";
    for (const control of ["button", "input", "select", "textarea"]) {
      expect(inheriting.split(","), `${control} must inherit the app's font`).toContain(control);
    }
  });
});
