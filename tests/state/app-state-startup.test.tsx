import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";

const persistence = vi.hoisted(() => ({
  saveConfig: vi.fn(),
}));

vi.mock("../../src/services/persistence", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../src/services/persistence")
  >();
  return {
    ...original,
    loadAppData: vi.fn(async () => ({
      config: null,
      configQuarantinedTo: null,
      state: null,
      panes: null,
      panesError: null,
      dataDir: "/private/tmp/quickdeck-test",
      debugEnabled: false,
    })),
    saveConfig: persistence.saveConfig,
    countSnapshots: vi.fn(async () => 0),
  };
});

function StartupState() {
  const state = useAppState();
  return (
    <>
      <span data-testid="load-status">{state.loadStatus}</span>
      <span data-testid="save-state">{state.saveState}</span>
      <span data-testid="load-error">{state.loadError}</span>
    </>
  );
}

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("first-run settings materialization", () => {
  it("halts with authored copy instead of settling a rejected write as saved", async () => {
    persistence.saveConfig.mockRejectedValueOnce(
      new TypeError("EACCES /private/tmp/HOSTILE-SENTINEL IPC"),
    );

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <AppStateProvider>
          <StartupState />
        </AppStateProvider>,
      );
    });

    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe(
      "failed",
    );
    expect(host.querySelector('[data-testid="save-state"]')?.textContent).toBe(
      "error",
    );
    const message =
      host.querySelector('[data-testid="load-error"]')?.textContent ?? "";
    expect(message).toContain("could not create its settings file");
    expect(message).not.toContain("EACCES");
    expect(message).not.toContain("/private/tmp");
    expect(message).not.toContain("HOSTILE-SENTINEL");
    expect(message).not.toContain("IPC");
  });
});
