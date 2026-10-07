import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";
import type { LoadedAppData } from "../../src/services/persistence";

const persistence = vi.hoisted(() => ({
  loadAppData: vi.fn(),
  createSnapshot: vi.fn(),
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

describe("snapshot count read ownership", () => {
  it.each(["single", "batch"] as const)("ignores an older deletion refresh after a %s insert refresh", async (kind) => {
    await renderState();
    let settleOld!: (count: number) => void;
    persistence.countSnapshots.mockImplementationOnce(() => new Promise<number>((resolve) => { settleOld = resolve; }));
    persistence.countSnapshots.mockResolvedValueOnce(3);
    persistence.createSnapshot.mockResolvedValueOnce({ inserted: true, id: "new" });
    persistence.createSnapshots.mockResolvedValueOnce([{ inserted: true, id: "new" }]);
    await act(async () => { latestState!.refreshSnapshotCount(); });
    try {
      if (kind === "single") {
        await act(async () => { latestState!.recordSnapshot(latestState!.panes[0].id, "copy", "new content"); });
      } else {
        await act(async () => { latestState!.updatePaneContent(latestState!.panes[0].id, "new content"); });
        await act(async () => { await latestState!.snapshotAllPanes("copy"); });
      }
      expect(latestState!.snapshotCount).toBe(3);
    } finally {
      await act(async () => settleOld(2));
    }
    expect(latestState!.snapshotCount).toBe(3);
    expect(persistence.countSnapshots).toHaveBeenCalledTimes(3);
  });

  it("reads the committed count instead of adding to a count that may already include an insert", async () => {
    await renderState();
    persistence.countSnapshots.mockResolvedValueOnce(1);
    await act(async () => { latestState!.refreshSnapshotCount(); });
    persistence.createSnapshot.mockResolvedValueOnce({ inserted: true, id: "new" });
    persistence.countSnapshots.mockResolvedValueOnce(1);
    await act(async () => { latestState!.recordSnapshot(latestState!.panes[0].id, "copy", "new content"); });
    expect(latestState!.snapshotCount).toBe(1);
  });
});
