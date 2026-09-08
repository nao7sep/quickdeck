// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsModal } from "../../src/components/ShortcutsModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ShortcutsModal", () => {
  it("focuses one passive scroll owner for the catalogue", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<ShortcutsModal onClose={vi.fn()} />);
    });

    const owner = document.querySelector<HTMLElement>(
      '[data-passive-scroll-region][aria-label="Keyboard shortcuts"]',
    );
    expect(owner).not.toBeNull();
    expect(owner?.tabIndex).toBe(0);
    expect(document.activeElement).toBe(owner);
  });
});
