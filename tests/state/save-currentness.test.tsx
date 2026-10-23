import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";
import { saveForQuit, QUIT_SAVE_BOUND_MS } from "../../src/services/quit";
import type { LoadedAppData } from "../../src/services/persistence";
import { defaultSettings } from "../../src/state/defaults";
import { storedSettingsSets } from "../../src/state/normalize";

const persistence = vi.hoisted(() => ({
  loadAppData: vi.fn(),
  createSnapshot: vi.fn(),
  saveConfig: vi.fn(),
  saveState: vi.fn(),
  savePanes: vi.fn(),
  createSnapshots: vi.fn(),
  countSnapshots: vi.fn(),
}));

vi.mock("../../src/services/persistence", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../src/services/persistence")
  >();
  return {
    ...original,
    loadAppData: persistence.loadAppData,
    createSnapshot: persistence.createSnapshot,
    saveConfig: persistence.saveConfig,
    saveState: persistence.saveState,
    savePanes: persistence.savePanes,
    createSnapshots: persistence.createSnapshots,
    countSnapshots: persistence.countSnapshots,
  };
});

function loadedAppData(): LoadedAppData {
  return {
    config: null,
    configQuarantinedTo: null,
    configNewer: null,
    state: null,
    panes: null,
    panesError: null,
    panesNewer: null,
    snapshotsNewer: null,
    panesPath: "/private/tmp/quickdeck-toast-test/panes.json",
    snapshotsPath: "/private/tmp/quickdeck-toast-test/snapshots.sqlite3",
    dataDir: "/private/tmp/quickdeck-toast-test",

    systemLanguage: "en",
    systemLocale: null,
  };
}

let latestState: ReturnType<typeof useAppState> | null = null;
let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function StateProbe() {
  latestState = useAppState();
  return null;
}

beforeEach(() => {
  persistence.loadAppData.mockResolvedValue(loadedAppData());
  persistence.countSnapshots.mockResolvedValue(0);
  persistence.saveConfig.mockResolvedValue(null);
  persistence.saveState.mockResolvedValue(undefined);
  persistence.savePanes.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  latestState = null;
  document.body.innerHTML = "";
  vi.resetAllMocks();
});

async function renderState(): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <AppStateProvider>
        <StateProbe />
      </AppStateProvider>,
    );
  });
}

function loadExistingPane() {
  persistence.loadAppData.mockResolvedValue({
    ...loadedAppData(),
    config: { ...storedSettingsSets(defaultSettings), obsoleteKey: true },
    panes: { panes: [{ id: "existing", title: "Existing", content: "loaded text", headerColor: "#112233", backgroundColor: "#ffffff" }] },
  });
}

describe("current input save truth", () => {
  it.each(["settings", "zoom"])("skips loaded panes for a %s-only change", async (kind) => {
    loadExistingPane();
    await renderState();
    await act(async () => {
      if (kind === "settings") latestState!.updateSettings({ ...latestState!.settings, zen: true });
      else latestState!.setZoomLevel(1.1);
    });
    await act(async () => { expect(await latestState!.saveNow()).toBe(true); });
    expect(persistence.savePanes).not.toHaveBeenCalled();
    // Even a readable loaded config needs one canonical save to retire keys.
    expect(persistence.saveConfig).toHaveBeenCalledTimes(1);
    expect(persistence.saveConfig.mock.calls[0][0]).not.toHaveProperty("obsoleteKey");
    expect(persistence.saveState).toHaveBeenCalledWith(expect.objectContaining({ zoomLevel: kind === "zoom" ? 1.1 : 1 }));
    await act(async () => { expect(await latestState!.saveNow()).toBe(true); });
    expect(persistence.saveConfig).toHaveBeenCalledTimes(1);
    expect(persistence.savePanes).not.toHaveBeenCalled();
  });

  it("submits an unchanged valid config on the first explicit save only", async () => {
    const data = loadedAppData();
    data.config = storedSettingsSets(defaultSettings);
    persistence.loadAppData.mockResolvedValue(data);
    await renderState();
    await act(async () => { expect(await latestState!.saveNow()).toBe(true); });
    await act(async () => { expect(await latestState!.saveNow()).toBe(true); });
    expect(persistence.saveConfig).toHaveBeenCalledTimes(1);
  });

  it.each(["config", "panes"])("preserves the successful store baseline when %s fails", async (failedStore) => {
    loadExistingPane();
    await renderState();
    await act(async () => {
      latestState!.updateSettings({ ...latestState!.settings, zen: true });
      latestState!.updatePaneContent(latestState!.activePaneId, "changed text");
    });
    const failing = failedStore === "config" ? persistence.saveConfig : persistence.savePanes;
    const successful = failedStore === "config" ? persistence.savePanes : persistence.saveConfig;
    failing.mockRejectedValueOnce(new Error("write unavailable"));
    await act(async () => { await expect(latestState!.saveNow()).rejects.toThrow("write unavailable"); });
    expect(latestState!.saveState).toBe("error");
    await act(async () => { expect(await latestState!.saveNow()).toBe(true); });
    expect(failing).toHaveBeenCalledTimes(2);
    expect(successful).toHaveBeenCalledTimes(1);
  });

  it("does not acknowledge settings edited while their preceding save is pending", async () => {
    loadExistingPane();
    await renderState();
    let settle!: (path: null) => void;
    persistence.saveConfig.mockImplementationOnce(() => new Promise<null>((resolve) => { settle = resolve; }));
    let saving!: Promise<boolean>;
    await act(async () => { saving = latestState!.saveNow(); });
    await act(async () => latestState!.updateSettings({ ...latestState!.settings, zen: true }));
    await act(async () => { settle(null); expect(await saving).toBe(false); });
    expect(latestState!.saveState).toBe("unsaved");
    await act(async () => { expect(await latestState!.saveNow()).toBe(true); });
    expect(persistence.saveConfig).toHaveBeenCalledTimes(2);
    expect(persistence.saveConfig.mock.calls[1][0]).toMatchObject({ zen: true });
    expect(persistence.savePanes).not.toHaveBeenCalled();
  });

  it("does not regress the pane acknowledgement when an older save settles last", async () => {
    loadExistingPane();
    await renderState();
    let settleFirst!: () => void;
    persistence.savePanes.mockImplementationOnce(() => new Promise<void>((resolve) => { settleFirst = resolve; }));
    await act(async () => latestState!.updatePaneContent(latestState!.activePaneId, "first"));
    let first!: Promise<boolean>;
    await act(async () => { first = latestState!.saveNow(); });
    await act(async () => latestState!.updatePaneContent(latestState!.activePaneId, "newest"));
    await act(async () => { expect(await latestState!.saveNow()).toBe(true); });
    await act(async () => { settleFirst(); expect(await first).toBe(false); });
    await act(async () => { expect(await latestState!.saveNow()).toBe(true); });
    expect(persistence.savePanes).toHaveBeenCalledTimes(2);
    expect(latestState!.panes[0].content).toBe("newest");
  });

  it("does not save an older render payload after a synchronous edit admission", async () => {
    await renderState();
    const oldSave = latestState!.saveNow;
    let result = true;
    await act(async () => {
      latestState!.updatePaneContent(latestState!.activePaneId, "latest");
      result = await oldSave();
    });
    expect(result).toBe(false);
    expect(persistence.savePanes).not.toHaveBeenCalled();
    await act(async () => { expect(await latestState!.saveNow()).toBe(true); });
    expect(persistence.savePanes.mock.calls[0][0].panes[0].content).toBe("latest");
  });

  it("keeps newer authored input unsaved after an older captured write completes", async () => {
    await renderState();
    await act(async () => latestState!.updatePaneContent(latestState!.activePaneId, "first"));
    let settle!: () => void;
    persistence.savePanes.mockImplementationOnce(() => new Promise<void>((resolve) => { settle = resolve; }));
    let saving!: Promise<boolean>;
    await act(async () => { saving = latestState!.saveNow(); });
    try {
      await act(async () => latestState!.updatePaneContent(latestState!.activePaneId, "later"));
      expect(persistence.savePanes.mock.calls[0][0].panes[0].content).toBe("first");
    } finally {
      await act(async () => { settle(); expect(await saving).toBe(false); });
    }
    expect(latestState!.panes[0].content).toBe("later");
    expect(latestState!.saveState).toBe("unsaved");
    await act(async () => { expect(await latestState!.saveNow()).toBe(true); });
    expect(persistence.savePanes.mock.calls[1][0].panes[0].content).toBe("later");
  });

  it.each(["failed", "pending"])("allows quit after required saves despite %s optional view state", async (outcome) => {
    vi.useFakeTimers();
    let settleState = () => {};
    try {
      await renderState();
      await act(async () => latestState!.updatePaneContent(latestState!.activePaneId, "authored"));
      persistence.saveState.mockImplementationOnce(() => outcome === "failed"
        ? Promise.reject(new Error("optional state unavailable"))
        : new Promise<void>((resolve) => { settleState = resolve; }));
      let result: boolean | undefined;
      await act(async () => {
        void saveForQuit({ snapshot: async () => {}, save: latestState!.saveNow }).then((saved) => { result = saved; });
        await vi.advanceTimersByTimeAsync(QUIT_SAVE_BOUND_MS);
      });
      expect(result).toBe(true);
      expect(latestState!.saveState).toBe("saved");
      expect(persistence.savePanes).toHaveBeenCalledWith(expect.objectContaining({
        panes: expect.arrayContaining([expect.objectContaining({ content: "authored" })]),
      }));
    } finally {
      await act(async () => settleState());
      vi.useRealTimers();
    }
  });

  it("retains current edits when native panes save refuses a newer destination", async () => {
    await renderState();
    await act(async () => latestState!.updatePaneContent(latestState!.activePaneId, "authored"));
    const refusal = { path: "/actual/panes.json", newer: 2, message: "diagnostic sentinel" };
    persistence.savePanes.mockRejectedValueOnce(refusal);
    await act(async () => { await expect(latestState!.saveNow()).rejects.toEqual(refusal); });
    expect(latestState!.saveState).toBe("error");
    expect(latestState!.panes[0].content).toBe("authored");
  });
});
