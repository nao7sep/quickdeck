import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetModules();
  invokeMock.mockReset();
});

describe("persistence write queues", () => {
  it.each(["config", "state", "panes"] as const)(
    "retains only the latest pending %s save and settles all covered callers together",
    async (store) => {
      const persistence = await import("../../src/services/persistence");
      const firstBridge = deferred<unknown>();
      const finalBridge = deferred<unknown>();
      invokeMock.mockReturnValueOnce(firstBridge.promise).mockReturnValueOnce(finalBridge.promise);
      const submit = (index: number): Promise<unknown> => {
        if (store === "config") return persistence.saveConfig({ autosaveDelaySeconds: index + 1 });
        if (store === "state") return persistence.saveState({ activePaneId: `p${index}`, zoomLevel: 100 });
        return persistence.savePanes({ panes: [{ id: "p1", title: "", content: `${index}`, headerColor: "", backgroundColor: "" }] });
      };
      const first = submit(0);
      const covered = Array.from({ length: 20 }, (_, index) => submit(index + 1));
      const settled = vi.fn();
      const allCovered = Promise.all(covered).then(settled);
      expect(invokeMock).toHaveBeenCalledTimes(1);

      firstBridge.resolve("first result");
      await first;
      expect(invokeMock).toHaveBeenCalledTimes(2);
      expect(settled).not.toHaveBeenCalled();
      const finalValue = store === "config" ? { autosaveDelaySeconds: 21 }
        : store === "state" ? { activePaneId: "p20", zoomLevel: 100 }
        : { panes: [{ id: "p1", title: "", content: "20", headerColor: "", backgroundColor: "" }] };
      expect(invokeMock).toHaveBeenLastCalledWith(`save_${store}`, { [store]: finalValue });

      finalBridge.resolve("covering result");
      await allCovered;
      expect(settled).toHaveBeenCalledWith(Array(20).fill(undefined));
      expect(invokeMock).toHaveBeenCalledTimes(2);
    },
  );

  it("propagates the covering write's failure to every pending caller and permits later saves", async () => {
    const { saveConfig } = await import("../../src/services/persistence");
    const firstBridge = deferred<string | null>();
    const finalBridge = deferred<string | null>();
    invokeMock.mockReturnValueOnce(firstBridge.promise).mockReturnValueOnce(finalBridge.promise).mockResolvedValueOnce(null);
    const first = saveConfig({ zen: true });
    const pending = [saveConfig({ zen: false }), saveConfig({ zen: true }), saveConfig({ zen: false })];
    const results = Promise.allSettled(pending);
    firstBridge.resolve(null);
    await first;
    const error = new Error("disk full");
    finalBridge.reject(error);
    expect(await results).toEqual(Array(3).fill({ status: "rejected", reason: error }));
    await expect(saveConfig({ zen: true })).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it("starts the latest pending save after an active failure without hiding the failure", async () => {
    const { saveState } = await import("../../src/services/persistence");
    const firstBridge = deferred<void>();
    invokeMock.mockReturnValueOnce(firstBridge.promise).mockResolvedValueOnce(undefined);
    const first = saveState({ activePaneId: "p1", zoomLevel: 100 });
    const firstResult = expect(first).rejects.toThrow("disk full");
    const pending = saveState({ activePaneId: "p2", zoomLevel: 100 });
    const final = saveState({ activePaneId: "p3", zoomLevel: 100 });
    firstBridge.reject(new Error("disk full"));
    await firstResult;
    await Promise.all([pending, final]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("save_state", { state: { activePaneId: "p3", zoomLevel: 100 } });
  });

  it("keeps the active file reservation when a caller stops waiting", async () => {
    const { savePanes } = await import("../../src/services/persistence");
    const bridge = deferred<void>();
    invokeMock.mockReturnValueOnce(bridge.promise).mockResolvedValueOnce(undefined);
    const first = savePanes({ panes: [] });
    await expect(Promise.race([first, Promise.resolve("deadline")])).resolves.toBe("deadline");
    const pending = savePanes({ panes: [] });
    const final = savePanes({ panes: [] });
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledTimes(1);
    bridge.resolve();
    await Promise.all([first, pending, final]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("lets separate files save independently while one file is busy", async () => {
    const { saveConfig, saveState, savePanes } = await import("../../src/services/persistence");
    const bridge = deferred<string | null>();
    invokeMock.mockReturnValueOnce(bridge.promise).mockResolvedValue(undefined);
    const config = saveConfig({ zen: true });
    await Promise.all([saveState({ activePaneId: "p1", zoomLevel: 100 }), savePanes({ panes: [] })]);
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["save_config", "save_state", "save_panes"]);
    bridge.resolve(null);
    await config;
  });
});

// The files hold only what the app reads, so a save of unchanged panes or view
// state sends the same bytes and the core skips the write. The core adds each
// file's format version, so the frontend sends none.
describe("persisted file shapes", () => {
  it("builds the same panes and state files from the same input", async () => {
    const { buildPanesFile, buildStateFile } = await import("../../src/services/persistence");
    const panes = [{ id: "p1", title: "t", content: "c", headerColor: "", backgroundColor: "" }];

    expect(buildPanesFile(panes)).toEqual({ panes });
    expect(buildStateFile("p1", 110)).toEqual({ activePaneId: "p1", zoomLevel: 110 });
    expect(buildStateFile("p1", 110, 420)).toEqual({ activePaneId: "p1", zoomLevel: 110, recordsListWidth: 420 });
  });
});
