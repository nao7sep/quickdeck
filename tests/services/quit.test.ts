import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../../src/services/logger", () => ({
  logError: mocks.logError,
  logWarn: mocks.logWarn,
  serializeError: (error: unknown) => ({ value: String(error) }),
}));

import { EXIT_DEADLINE_MS, saveForQuit } from "../../src/services/quit";

const never = () => new Promise<void>(() => undefined);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  mocks.logError.mockReset();
  mocks.logWarn.mockReset();
});

describe("saveForQuit", () => {
  it("snapshots, then saves, and reports the work saved", async () => {
    const order: string[] = [];
    const saved = saveForQuit({
      snapshot: async () => void order.push("snapshot"),
      save: async () => { order.push("save"); return true; },
    });

    await expect(saved).resolves.toBe(true);
    expect(order).toEqual(["snapshot", "save"]);
    expect(mocks.logWarn).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("logs a failed snapshot and still saves", async () => {
    const save = vi.fn(() => Promise.resolve(true));
    const saved = saveForQuit({ snapshot: () => Promise.reject(new Error("disk full")), save });

    await expect(saved).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(mocks.logWarn).toHaveBeenCalledWith("close snapshot failed", expect.anything());
  });

  it("stops waiting for a snapshot at the deadline, logs it, and keeps the landed save", async () => {
    const save = vi.fn(() => Promise.resolve(true));
    const saved = saveForQuit({ snapshot: never, save }, Date.now() + EXIT_DEADLINE_MS);

    await vi.advanceTimersByTimeAsync(EXIT_DEADLINE_MS - 1);
    expect(save).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(saved).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(mocks.logWarn).toHaveBeenCalledWith("close snapshot unfinished at the exit deadline", {
      ms: EXIT_DEADLINE_MS,
    });
  });

  it("does not certify a completed save of outdated input", async () => {
    await expect(saveForQuit({ snapshot: async () => {}, save: async () => false })).resolves.toBe(false);
  });

  it("reports a failed save and logs it", async () => {
    const saved = saveForQuit({
      snapshot: () => Promise.resolve(),
      save: () => Promise.reject(new Error("read-only")),
    });

    await expect(saved).resolves.toBe(false);
    expect(mocks.logError).toHaveBeenCalledWith("save on close failed", expect.anything());
  });

  it("reports a save unfinished at the deadline as not saved, and logs it", async () => {
    let settled: boolean | null = null;
    const pending = () => new Promise<boolean>(() => undefined);
    void saveForQuit({ snapshot: () => Promise.resolve(), save: pending }, Date.now() + EXIT_DEADLINE_MS).then((value) => {
      settled = value;
    });

    await vi.advanceTimersByTimeAsync(EXIT_DEADLINE_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toBe(false);
    expect(mocks.logError).toHaveBeenCalledWith("save on close unfinished at the exit deadline", {
      ms: EXIT_DEADLINE_MS,
    });
  });

  it("holds no timer without a deadline: the session end's wait belongs to the core", async () => {
    let settled: boolean | null = null;
    void saveForQuit({ snapshot: () => Promise.resolve(), save: () => new Promise<boolean>(() => undefined) }).then((value) => {
      settled = value;
    });

    await vi.advanceTimersByTimeAsync(EXIT_DEADLINE_MS * 2);
    expect(settled).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a step that throws before returning a promise as failed", async () => {
    const saved = saveForQuit({
      snapshot: () => {
        throw new Error("sync");
      },
      save: () => {
        throw new Error("sync");
      },
    });

    await expect(saved).resolves.toBe(false);
    expect(mocks.logWarn).toHaveBeenCalledWith("close snapshot failed", expect.anything());
    expect(mocks.logError).toHaveBeenCalledWith("save on close failed", expect.anything());
  });
});
