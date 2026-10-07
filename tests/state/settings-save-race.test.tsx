import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";

// A fake core behind the real write queue: config.json is whatever the last
// completed save_config wrote, and the first config write is held in flight.
const core = vi.hoisted(() => ({
  file: null as unknown,
  releaseFirstWrite: () => {},
  configWrites: 0,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, args: { config?: unknown } = {}) => {
    switch (command) {
      case "load_app_data":
        return {
          config: null,
          configQuarantinedTo: null,
          configNewer: null,
          state: null,
          panes: null,
          panesError: null,
          panesNewer: null,
          snapshotsNewer: null,
          panesPath: "/private/tmp/quickdeck-test/panes.json",
          snapshotsPath: "/private/tmp/quickdeck-test/snapshots.sqlite3",
          dataDir: "/private/tmp/quickdeck-test",
          debugEnabled: false,
          systemLanguage: "en",
          systemLocale: null,
        };
      case "save_config":
        core.configWrites += 1;
        if (core.configWrites === 1) {
          return new Promise<null>((resolve) => {
            core.releaseFirstWrite = () => {
              core.file = args.config;
              resolve(null);
            };
          });
        }
        core.file = args.config;
        return null;
      case "count_snapshots":
        return 0;
      default:
        return undefined;
    }
  },
}));

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
});

it("ends with the latest settings when a set is reverted during an in-flight save", async () => {
  let state: ReturnType<typeof useAppState>;
  function Probe() { state = useAppState(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => { root?.render(<AppStateProvider><Probe /></AppStateProvider>); });

  await act(async () => { state!.updateSettings({ ...state!.settings, zen: true }); });
  let first: Promise<boolean> = Promise.resolve(true);
  await act(async () => { first = state!.saveNow(); });
  await act(async () => { state!.updateSettings({ ...state!.settings, zen: false }); });
  let second: Promise<boolean> = Promise.resolve(true);
  await act(async () => { second = state!.saveNow(); });

  await act(async () => {
    core.releaseFirstWrite();
    await first;
    await second;
  });

  expect(core.configWrites).toBe(2);
  expect(core.file).toEqual({});
  expect(state!.settings.zen).toBe(false);
});
