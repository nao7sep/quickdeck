import { describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// QD-1: saveConfig, saveState and savePanes must serialize their writes the
// same way saveState already did, so a close-triggered save can never race an
// in-flight autosave of the same store and let a stale write win.
describe("persistence write queues", () => {
  it("serializes savePanes calls: the second invoke waits for the first to settle", async () => {
    const { savePanes } = await import("../../src/services/persistence");

    const order: string[] = [];
    let resolveFirst: () => void = () => {};
    invokeMock.mockImplementationOnce(() => {
      order.push("invoke-start-1");
      return new Promise<void>((resolve) => {
        resolveFirst = () => {
          order.push("invoke-end-1");
          resolve();
        };
      });
    });
    invokeMock.mockImplementationOnce(() => {
      order.push("invoke-start-2");
      return Promise.resolve();
    });

    const panesA = { version: 1 as const, panes: [], updatedAtUtc: "a" };
    const panesB = { version: 1 as const, panes: [], updatedAtUtc: "b" };

    const first = savePanes(panesA);
    const second = savePanes(panesB);

    // The second write's invoke must not have started yet: it is queued
    // behind the first, still in-flight write of the same store.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["invoke-start-1"]);

    resolveFirst();
    await first;
    await second;

    expect(order).toEqual(["invoke-start-1", "invoke-end-1", "invoke-start-2"]);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "save_panes", { panes: panesA });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_panes", { panes: panesB });
  });

  it("serializes saveConfig calls the same way", async () => {
    const { saveConfig } = await import("../../src/services/persistence");
    invokeMock.mockClear();
    invokeMock.mockResolvedValue(undefined);

    const configA = { version: 1 } as unknown as Parameters<typeof saveConfig>[0];
    const configB = { version: 2 } as unknown as Parameters<typeof saveConfig>[0];

    await Promise.all([saveConfig(configA), saveConfig(configB)]);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "save_config", { config: configA });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "save_config", { config: configB });
  });

  it("keeps a rejected write from blocking the queue for later writes", async () => {
    const { saveState } = await import("../../src/services/persistence");
    invokeMock.mockClear();
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    invokeMock.mockResolvedValueOnce(undefined);

    const stateA = { version: 1 as const, activePaneId: "p1", zoomLevel: 100, updatedAtUtc: "a" };
    const stateB = { version: 1 as const, activePaneId: "p1", zoomLevel: 100, updatedAtUtc: "b" };

    await expect(saveState(stateA)).rejects.toThrow("disk full");
    await expect(saveState(stateB)).resolves.toBeUndefined();
  });
});
