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
  it("keeps one passive scroll owner for the catalogue, without opening on it", async () => {
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
    // Reachable, not pre-focused. The owner reaches the modal's own edges, and the
    // key that opened the modal would light its ring as a second border inside it;
    // focus goes to the first real control instead. (This used to require the
    // opposite.)
    expect(document.activeElement).not.toBe(owner);
    expect(document.activeElement?.tagName).toBe("BUTTON");
    expect(document.activeElement?.hasAttribute("data-modal-close")).toBe(false);
  });
});
