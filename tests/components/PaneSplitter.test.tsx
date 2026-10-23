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
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
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

describe("PaneSplitter pointer drag", () => {
  async function splitter() {
    const onResize = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(<PaneSplitter label="Resize" width={380} min={320} max={640} onResize={onResize} onCommit={onCommit} onCancel={onCancel} />),
    );
    return { handle: container.querySelector<HTMLElement>("[role='separator']")!, onResize, onCommit, onCancel };
  }

  async function pointer(target: EventTarget, type: string, pointerId = 1, clientX = 100) {
    const event = new MouseEvent(type, { bubbles: true, clientX });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    await act(async () => { target.dispatchEvent(event); });
  }

  it("streams only its pointer and commits once on release, restoring body styles", async () => {
    const { handle, onResize, onCommit } = await splitter();
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";
    await pointer(handle, "pointerdown");
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    await pointer(window, "pointermove", 2, 200);
    await pointer(window, "pointerup", 2);
    await pointer(window, "pointercancel", 2);
    await pointer(window, "lostpointercapture", 2);
    expect(onResize).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    await pointer(window, "pointermove", 1, 150);
    expect(onResize).toHaveBeenLastCalledWith(430);
    await pointer(window, "pointerup");
    await pointer(window, "pointerup");
    await pointer(window, "pointermove", 1, 200);
    expect(onResize).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(430);
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])("retires a drag on %s without committing", async (type) => {
    const { handle, onResize, onCommit, onCancel } = await splitter();
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";
    await pointer(handle, "pointerdown");
    await pointer(window, "pointermove", 1, 150);
    await pointer(window, type);
    expect(onCancel).toHaveBeenCalledOnce();
    await pointer(window, "pointermove", 1, 200);
    await pointer(window, "pointerup");
    expect(onResize).toHaveBeenCalledExactlyOnceWith(430);
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
  });

  it("cleans up an unmounted drag without committing or responding afterward", async () => {
    const { handle, onResize, onCommit } = await splitter();
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";
    await pointer(handle, "pointerdown");
    await act(async () => root?.unmount());
    root = null;
    await pointer(window, "pointermove", 1, 150);
    await pointer(window, "pointerup");
    expect(onResize).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
  });

  it("retires the previous drag before starting another", async () => {
    const { handle, onResize, onCommit } = await splitter();
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";
    await pointer(handle, "pointerdown");
    await pointer(handle, "pointerdown", 2, 200);
    await pointer(window, "pointermove", 1, 150);
    await pointer(window, "pointerup", 1);
    expect(onResize).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    await pointer(window, "pointermove", 2, 250);
    await pointer(window, "pointerup", 2);
    expect(onResize).toHaveBeenCalledExactlyOnceWith(430);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(430);
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
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
