// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keyedWidth, PaneSplitter, SPLITTER_KEY_STEP } from "../../src/components/PaneSplitter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("keyedWidth", () => {
  it("moves by one step and holds to the bounds", () => {
    expect(keyedWidth("ArrowRight", 380, 320, 640)).toBe(380 + SPLITTER_KEY_STEP);
    expect(keyedWidth("ArrowLeft", 380, 320, 640)).toBe(380 - SPLITTER_KEY_STEP);
    expect(keyedWidth("ArrowLeft", 330, 320, 640)).toBe(320);
    expect(keyedWidth("ArrowRight", 630, 320, 640)).toBe(640);
  });

  it("jumps to the bounds on Home and End and ignores other keys", () => {
    expect(keyedWidth("Home", 500, 320, 640)).toBe(320);
    expect(keyedWidth("End", 500, 320, 640)).toBe(640);
    expect(keyedWidth("ArrowUp", 500, 320, 640)).toBeNull();
    expect(keyedWidth("a", 500, 320, 640)).toBeNull();
  });
});

describe("PaneSplitter keyboard", () => {
  async function splitter() {
    const onResize = vi.fn();
    const onCommit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(<PaneSplitter label="Resize" width={380} min={320} max={640} onResize={onResize} onCommit={onCommit} />),
    );
    const handle = container.querySelector<HTMLElement>("[role='separator']")!;
    return { handle, onResize, onCommit };
  }

  const key = (target: HTMLElement, type: "keydown" | "keyup", name: string) =>
    act(async () => {
      target.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true }));
    });

  it("is focusable and states its width and bounds", async () => {
    const { handle } = await splitter();
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute("aria-valuenow")).toBe("380");
    expect(handle.getAttribute("aria-valuemin")).toBe("320");
    expect(handle.getAttribute("aria-valuemax")).toBe("640");
  });

  it("streams held arrow presses and saves once on key release", async () => {
    const { handle, onResize, onCommit } = await splitter();
    await key(handle, "keydown", "ArrowRight");
    await key(handle, "keydown", "ArrowRight");
    expect(onResize).toHaveBeenLastCalledWith(380 + 2 * SPLITTER_KEY_STEP);
    expect(onCommit).not.toHaveBeenCalled();
    await key(handle, "keyup", "ArrowRight");
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(380 + 2 * SPLITTER_KEY_STEP);
  });

  it("saves a keyed width on blur and nothing when no key moved it", async () => {
    const { handle, onCommit } = await splitter();
    handle.focus();
    await key(handle, "keyup", "Tab");
    expect(onCommit).not.toHaveBeenCalled();
    await key(handle, "keydown", "Home");
    await act(async () => handle.blur());
    expect(onCommit).toHaveBeenCalledWith(320);
  });
});
