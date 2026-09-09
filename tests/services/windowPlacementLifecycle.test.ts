// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let moved: (() => void) | null = null;
  let resized: (() => void) | null = null;
  const frame = { width: 16, height: 39 };
  const bounds = { x: 10, y: 20, width: 1120, height: 760 };
  const calls: string[] = [];
  return {
    bounds,
    calls,
    frame,
    takeMoved: () => moved,
    setMoved: (listener: () => void) => { moved = listener; },
    setResized: (listener: () => void) => { resized = listener; },
    reset: () => {
      Object.assign(bounds, { x: 10, y: 20, width: 1120, height: 760 });
      moved = null;
      resized = null;
      calls.length = 0;
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: async () => [{
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
    scaleFactor: 1,
  }],
  getCurrentWindow: () => ({
    outerPosition: async () => ({ x: mocks.bounds.x, y: mocks.bounds.y }),
    outerSize: async () => ({ width: mocks.bounds.width, height: mocks.bounds.height }),
    innerSize: async () => ({
      width: mocks.bounds.width - mocks.frame.width,
      height: mocks.bounds.height - mocks.frame.height,
    }),
    setPosition: async (position: { x: number; y: number }) => {
      mocks.calls.push("setPosition");
      mocks.bounds.x = position.x;
      mocks.bounds.y = position.y;
    },
    setSize: async (size: { width: number; height: number }) => {
      mocks.bounds.width = size.width + mocks.frame.width;
      mocks.bounds.height = size.height + mocks.frame.height;
    },
    isMinimized: async () => false,
    isFullscreen: async () => false,
    isMaximized: async () => false,
    maximize: async () => undefined,
    show: async () => { mocks.calls.push("show"); },
    onMoved: async (listener: () => void) => {
      mocks.setMoved(listener);
      return () => undefined;
    },
    onResized: async (listener: () => void) => {
      mocks.setResized(listener);
      return () => undefined;
    },
  }),
  PhysicalPosition: class PhysicalPosition {
    constructor(public x: number, public y: number) {}
  },
  PhysicalSize: class PhysicalSize {
    constructor(public width: number, public height: number) {}
  },
}));

import {
  flushMainWindowPlacement,
  initializeMainWindowPlacement,
} from "../../src/services/windowPlacement";

describe("window placement lifecycle", () => {
  beforeEach(() => mocks.reset());

  it("flushes the current normal bounds when close lands inside the debounce", async () => {
    const persisted: unknown[] = [];
    await initializeMainWindowPlacement(
      { normalBounds: { x: 100, y: 110, width: 1200, height: 800 }, mode: "normal" },
      { width: 900, height: 600 },
      async (record) => { persisted.push(record); },
    );
    expect(mocks.calls.indexOf("show")).toBeLessThan(mocks.calls.indexOf("setPosition"));
    expect(mocks.bounds).toEqual({ x: 100, y: 110, width: 1200, height: 800 });

    Object.assign(mocks.bounds, { x: 150, y: 160, width: 1300, height: 850 });
    mocks.takeMoved()?.();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await flushMainWindowPlacement();

    expect(persisted.at(-1)).toEqual({
      normalBounds: { x: 150, y: 160, width: 1300, height: 850 },
      mode: "normal",
    });
  });
});
