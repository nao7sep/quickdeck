import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";
import type { LoadedAppData } from "../../src/services/persistence";

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
    debugEnabled: false,
    systemLanguage: "en",
    systemLocale: null,
  };
}

let latestState: ReturnType<typeof useAppState> | null = null;
let root: Root | null = null;

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

describe("current input save truth", () => {
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
