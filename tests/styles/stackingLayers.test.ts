import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const compact = css.replace(/\s+/g, "");

function layer(name: string): number {
  const value = compact.match(new RegExp(`--z-${name}:(\\d+);`))?.[1];
  expect(value, `--z-${name} is declared`).toBeDefined();
  return Number(value);
}

function rule(selector: string): string {
  return (
    compact.match(
      new RegExp(`${selector.replace(/\./g, "\\.")}\\{[^}]*\\}`),
    )?.[0] ?? ""
  );
}

/**
 * The status-bar menu and the notice stack both rise out of the bottom-right
 * corner above the status bar, so their order is not a matter of taste: with the
 * notices on top, every open toast covered the menu's lower items. A menu the
 * user opened owns the surface while it is open, and a modal owns it over both.
 */
describe("stacking layers", () => {
  it("puts an open menu above the notices and a modal above them all", () => {
    expect(layer("toast")).toBeLessThan(layer("menu"));
    expect(layer("menu")).toBeLessThan(layer("modal"));
  });

  it("draws each surface from its own layer token", () => {
    expect(rule(".menuPanel")).toContain("z-index:var(--z-menu)");
    expect(rule(".paneSwitcherPanel")).toContain("z-index:var(--z-menu)");
    expect(rule(".toastViewport")).toContain("z-index:var(--z-toast)");
    expect(rule(".modalOverlay")).toContain("z-index:var(--z-modal)");
  });
});
