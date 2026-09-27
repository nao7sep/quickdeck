// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PaneSwatch } from "../../src/components/PaneSwatch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function render(node: React.ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(node));
  return container.querySelector<HTMLElement>(".paneSwatch")!;
}

// A pane's colour used to be drawn two ways: a rimmed rounded square in the pane
// switcher and a rimless circle in Snapshots. It is one swatch now.
describe("PaneSwatch", () => {
  it("draws the pane's colour, hidden from assistive technology", async () => {
    const swatch = await render(<PaneSwatch color="#7c3aed" />);
    expect(swatch.style.background).not.toBe("");
    expect(swatch.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps its shape without a colour, for a pane that is gone", async () => {
    const swatch = await render(<PaneSwatch />);
    expect(swatch.style.background).toBe("");
  });

  it("is the only way a pane's colour is drawn as a mark", () => {
    const dir = join(process.cwd(), "src/components");
    for (const file of readdirSync(dir).filter((name) => name !== "PaneSwatch.tsx")) {
      const text = readFileSync(join(dir, file), "utf8");
      expect(text, file).not.toMatch(/background:\s*\w+(\?)?\.headerColor/);
    }
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8").replace(/\s+/g, "");
    expect(css).toContain(".paneSwatch{");
    expect(css).toContain("border-radius:var(--radius-swatch)");
    expect(css).not.toMatch(/\.(paneSwitcherSwatch|snapshotRowDot)\{/);
  });
});
