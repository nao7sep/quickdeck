// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const bounds = { x: 10, y: 20, width: 1120, height: 760 };
  const state = { minimized: false, fullscreen: false, maximized: false };
  const calls: string[] = [];
  let moved: (() => void) | undefined;
  let resized: (() => void) | undefined;
  let adjustWidth = 0;
  return {
    bounds, state, calls,
    report: vi.fn(),
    monitors: vi.fn(async () => [{
      workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
    }]),
    move: () => moved?.(),
    resize: () => resized?.(),
    adjust: (width: number) => { adjustWidth = width; },
    win: {
      outerPosition: async () => ({ x: bounds.x, y: bounds.y }),
      outerSize: async () => ({ width: bounds.width, height: bounds.height }),
      innerSize: async () => ({ width: bounds.width - 16, height: bounds.height - 39 }),
      setPosition: async (position: { x: number; y: number }) => {
        calls.push("setPosition");
        bounds.x = position.x;
        bounds.y = position.y;
        moved?.();
      },
      setSize: async (size: { width: number; height: number }) => {
        calls.push("setSize");
        bounds.width = size.width + 16 + adjustWidth;
        bounds.height = size.height + 39;
        resized?.();
      },
      show: async () => { calls.push("show"); },
      isMinimized: async () => state.minimized,
      isFullscreen: async () => state.fullscreen,
      isMaximized: async () => state.maximized,
      maximize: async () => {
        calls.push("maximize");
        state.maximized = true;
        Object.assign(bounds, { x: 0, y: 0, width: 1920, height: 1040 });
        resized?.();
      },
      onMoved: async (listener: () => void) => { moved = listener; return () => { moved = undefined; }; },
      onResized: async (listener: () => void) => { resized = listener; return () => { resized = undefined; }; },
    },
    reset: () => {
      Object.assign(bounds, { x: 10, y: 20, width: 1120, height: 760 });
      Object.assign(state, { minimized: false, fullscreen: false, maximized: false });
      calls.length = 0;
      moved = undefined;
      resized = undefined;
      adjustWidth = 0;
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../../src/services/logger", () => ({
  logWarn: mocks.report, serializeError: (error: unknown) => error,
}));
vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: mocks.monitors,
  getCurrentWindow: () => mocks.win,
  PhysicalPosition: class { constructor(public x: number, public y: number) {} },
  PhysicalSize: class { constructor(public width: number, public height: number) {} },
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mocks.reset();
  mocks.report.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("native placement lifecycle", () => {
  it.each(["opening", "innerSize", "monitors", "setPosition", "setSize", "finalSnapshot"] as const)(
    "restores saved maximized mode when %s fails",
    async (failure) => {
      const { initializeMainWindowPlacement, flushMainWindowPlacement } = await import("../../src/services/windowPlacement");
      const error = new Error("native geometry unavailable");
      if (failure === "opening") vi.spyOn(mocks.win, "outerPosition").mockRejectedValueOnce(error);
      else if (failure === "monitors") mocks.monitors.mockRejectedValueOnce(error);
      else if (failure === "finalSnapshot") {
        const read = mocks.win.outerPosition;
        vi.spyOn(mocks.win, "outerPosition").mockImplementationOnce(read).mockRejectedValueOnce(error);
      } else vi.spyOn(mocks.win, failure).mockRejectedValueOnce(error);
      const normalBounds = { x: 100, y: 110, width: 1200, height: 800 };
      const persist = vi.fn(async () => {});
      const start = initializeMainWindowPlacement({ normalBounds, mode: "maximized" }, persist);
      await vi.runAllTimersAsync();
      await start;
      expect(mocks.calls.at(-1)).toBe("maximize");
      expect(mocks.report).toHaveBeenCalled();
      await flushMainWindowPlacement();
      expect(persist).toHaveBeenLastCalledWith({
        normalBounds: failure === "opening" ? normalBounds : { x: 10, y: 20, width: 1120, height: 760 },
        mode: "maximized",
      });
    },
  );

  it("accepts adjusted geometry and flushes a move even when close interrupts debounce", async () => {
    const { initializeMainWindowPlacement, flushMainWindowPlacement } = await import("../../src/services/windowPlacement");
    const persist = vi.fn(async () => {});
    mocks.adjust(1);
    await initializeMainWindowPlacement(
      { normalBounds: { x: 100, y: 110, width: 1200, height: 800 }, mode: "normal" }, persist,
    );
    expect(mocks.calls).toEqual(["show", "setPosition", "setSize"]);
    expect(mocks.bounds).toEqual({ x: 100, y: 110, width: 1201, height: 800 });
    expect(mocks.report).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();

    Object.assign(mocks.bounds, { x: 150, y: 160, width: 1300, height: 850 });
    mocks.move();
    await flushMainWindowPlacement();
    expect(persist).toHaveBeenLastCalledWith({
      normalBounds: { x: 150, y: 160, width: 1300, height: 850 }, mode: "normal",
    });
  });

  it("restores maximized after normal bounds and keeps those bounds on transient close", async () => {
    const { initializeMainWindowPlacement, flushMainWindowPlacement } = await import("../../src/services/windowPlacement");
    const persist = vi.fn(async () => {});
    const normalBounds = { x: 100, y: 110, width: 1200, height: 800 };
    const start = initializeMainWindowPlacement({ normalBounds, mode: "maximized" }, persist);
    await vi.runAllTimersAsync();
    await start;
    expect(mocks.calls).toEqual(["show", "setPosition", "setSize", "maximize"]);
    await flushMainWindowPlacement();
    expect(persist).toHaveBeenLastCalledWith({ normalBounds, mode: "maximized" });

    mocks.state.maximized = false;
    mocks.state.minimized = true;
    Object.assign(mocks.bounds, { x: -32000, y: -32000, width: 160, height: 32 });
    await flushMainWindowPlacement();
    expect(persist).toHaveBeenLastCalledWith({ normalBounds, mode: "maximized" });
    mocks.state.minimized = false;
    mocks.state.fullscreen = true;
    await flushMainWindowPlacement();
    expect(persist).toHaveBeenLastCalledWith({ normalBounds, mode: "maximized" });
  });

  it("does not grow the outer rectangle across repeated normal restores", async () => {
    const normalBounds = { x: 100, y: 110, width: 1200, height: 800 };
    for (let launch = 0; launch < 3; launch += 1) {
      vi.resetModules();
      mocks.reset();
      const { initializeMainWindowPlacement, flushMainWindowPlacement } = await import("../../src/services/windowPlacement");
      const persist = vi.fn(async () => {});
      await initializeMainWindowPlacement({ normalBounds, mode: "normal" }, persist);
      await flushMainWindowPlacement();
      expect(persist).toHaveBeenLastCalledWith({ normalBounds, mode: "normal" });
    }
  });

  it.each(["minimized", "fullscreen"] as const)("retains a normal move when %s interrupts its pending save", async (transient) => {
    const { initializeMainWindowPlacement, flushMainWindowPlacement } = await import("../../src/services/windowPlacement");
    const persist = vi.fn(async () => {});
    await initializeMainWindowPlacement({ normalBounds: null, mode: "normal" }, persist);
    const moved = { x: 150, y: 160, width: 1300, height: 850 };
    Object.assign(mocks.bounds, moved);
    mocks.move();
    await vi.advanceTimersByTimeAsync(0);
    expect(persist).not.toHaveBeenCalled();
    mocks.state[transient] = true;
    Object.assign(mocks.bounds, { x: 0, y: 0, width: 1920, height: 1080 });
    mocks.resize();
    await flushMainWindowPlacement();
    expect(persist).toHaveBeenLastCalledWith({ normalBounds: moved, mode: "normal" });
  });
});
