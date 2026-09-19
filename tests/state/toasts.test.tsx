import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { message } from "../../src/i18n/translate";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";
import type { LoadedAppData } from "../../src/services/persistence";

const persistence = vi.hoisted(() => ({
  loadAppData: vi.fn(),
  createSnapshot: vi.fn(),
}));

vi.mock("../../src/services/persistence", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../src/services/persistence")
  >();
  return {
    ...original,
    loadAppData: persistence.loadAppData,
    createSnapshot: persistence.createSnapshot,
    countSnapshots: vi.fn(async () => 0),
  };
});

function loadedAppData(): LoadedAppData {
  return {
    config: null,
    configQuarantinedTo: null,
    state: null,
    panes: null,
    panesError: null,
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
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  latestState = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
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

describe("operational toast ownership", () => {
  it("keeps one live warning when the same blocked pane deletion is repeated", async () => {
    await renderState();
    const paneId = latestState!.panes[0].id;

    await act(async () => {
      latestState!.deletePane(paneId);
      latestState!.deletePane(paneId);
      latestState!.deletePane(paneId);
    });

    expect(latestState!.toasts).toHaveLength(1);
    expect(latestState!.toasts[0]).toMatchObject({
      owner: "pane-delete",
      kind: "warning",
      message: message("toast.lastPane"),
    });
  });

  // The messages never name a pane, so per-pane owners would stack identical
  // cards nobody can tell apart; the later blocked delete supersedes instead.
  it("keeps one blocked-delete warning across different panes", async () => {
    await renderState();
    await act(async () => {
      latestState!.addPane();
    });
    const [first, second] = latestState!.panes;
    await act(async () => {
      latestState!.updatePaneContent(first.id, "kept");
      latestState!.updatePaneContent(second.id, "also kept");
    });

    await act(async () => {
      latestState!.deletePane(first.id);
      latestState!.deletePane(second.id);
    });

    expect(latestState!.toasts).toHaveLength(1);
    expect(latestState!.toasts[0]).toMatchObject({
      owner: "pane-delete",
      message: message("toast.nonEmptyPane"),
    });
  });

  it("keeps one snapshot warning when several panes fail to snapshot", async () => {
    persistence.createSnapshot.mockRejectedValue(new Error("read-only data folder"));
    await renderState();

    await act(async () => {
      latestState!.recordSnapshot("pane-a", "copy", "first");
      latestState!.recordSnapshot("pane-b", "copy", "second");
    });

    expect(latestState!.toasts).toHaveLength(1);
    expect(latestState!.toasts[0]).toMatchObject({
      owner: "snapshot",
      message: message("toast.snapshotFailed"),
    });
  });

  it("replaces one owner without clearing or dismissing another owner", async () => {
    await renderState();

    await act(async () => {
      latestState!.showToast("operation:a", "warning", message("toast.lastPane"));
      latestState!.showToast("operation:b", "error", message("toast.closeFailed"));
      latestState!.showToast("operation:a", "warning", message("toast.nonEmptyPane"));
    });

    expect(latestState!.toasts).toHaveLength(2);
    expect(latestState!.toasts.map((toast) => toast.owner)).toEqual([
      "operation:b",
      "operation:a",
    ]);
    expect(latestState!.toasts[1].message).toEqual(message("toast.nonEmptyPane"));

    await act(async () => {
      latestState!.dismissToast(latestState!.toasts[1].id);
    });

    expect(latestState!.toasts.map((toast) => toast.owner)).toEqual(["operation:b"]);
  });
});
