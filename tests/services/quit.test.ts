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

import { QUIT_SAVE_BOUND_MS, QUIT_SNAPSHOT_BOUND_MS, saveForQuit } from "../../src/services/quit";

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
      save: async () => void order.push("save"),
    });

    await expect(saved).resolves.toBe(true);
    expect(order).toEqual(["snapshot", "save"]);
    expect(mocks.logWarn).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("logs a failed snapshot and still saves", async () => {
    const save = vi.fn(() => Promise.resolve());
    const saved = saveForQuit({ snapshot: () => Promise.reject(new Error("disk full")), save });

    await expect(saved).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(mocks.logWarn).toHaveBeenCalledWith("close snapshot failed", expect.anything());
  });

  it("gives up on a snapshot past its bound, logs it, and still saves", async () => {
    const save = vi.fn(() => Promise.resolve());
    const saved = saveForQuit({ snapshot: never, save });

    await vi.advanceTimersByTimeAsync(QUIT_SNAPSHOT_BOUND_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await expect(saved).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(mocks.logWarn).toHaveBeenCalledWith("close snapshot wait expired", {
      ms: QUIT_SNAPSHOT_BOUND_MS,
    });
  });

  it("reports a failed save and logs it", async () => {
    const saved = saveForQuit({
      snapshot: () => Promise.resolve(),
      save: () => Promise.reject(new Error("read-only")),
    });

    await expect(saved).resolves.toBe(false);
    expect(mocks.logError).toHaveBeenCalledWith("save on close failed", expect.anything());
  });

  it("reports a save past its bound as not saved, and logs it", async () => {
    let settled: boolean | null = null;
    void saveForQuit({ snapshot: () => Promise.resolve(), save: never }).then((value) => {
      settled = value;
    });

    await vi.advanceTimersByTimeAsync(QUIT_SAVE_BOUND_MS - 1);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(settled).toBe(false);
    expect(mocks.logError).toHaveBeenCalledWith("save on close wait expired", {
      ms: QUIT_SAVE_BOUND_MS,
    });
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
