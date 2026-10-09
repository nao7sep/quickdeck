import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useI18n } from "../../src/i18n/I18nContext";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";
import { STARTUP_LOAD_BOUND_MS } from "../../src/services/startup";
import { defaultSettings } from "../../src/state/defaults";
import type { LoadedAppData } from "../../src/services/persistence";

const persistence = vi.hoisted(() => ({
  loadAppData: vi.fn(),
  quarantineCorruptPanes: vi.fn(),
  saveConfig: vi.fn(),
  countSnapshots: vi.fn(),
  saveState: vi.fn(),
  savePanes: vi.fn(),
  launchLanguage: vi.fn(),
}));

vi.mock("../../src/services/persistence", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../src/services/persistence")
  >();
  return {
    ...original,
    loadAppData: persistence.loadAppData,
    quarantineCorruptPanes: persistence.quarantineCorruptPanes,
    saveConfig: persistence.saveConfig,
    saveState: persistence.saveState,
    savePanes: persistence.savePanes,
    countSnapshots: persistence.countSnapshots,
    launchLanguage: persistence.launchLanguage,
  };
});

function loadedAppData(overrides: Partial<LoadedAppData> = {}): LoadedAppData {
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
    ...overrides,
  };
}

let latestStartup: ReturnType<typeof useAppState> | undefined;

function StartupState() {
  const state = useAppState();
  latestStartup = state;
  const { text } = useI18n();
  return (
    <>
      <span data-testid="load-status">{state.loadStatus}</span>
      <span data-testid="save-state">{state.saveState}</span>
      <span data-testid="load-error">{state.loadError ? text(state.loadError) : null}</span>
      <span data-testid="load-recovery">{state.loadRecovery.map(text).join(" ")}</span>
      <span data-testid="pane-content">{state.panes[0].content}</span>
      <span data-testid="load-error-path">{state.loadErrorPath}</span>
      <span data-testid="corrupt-panes">{String(state.loadErrorIsCorruptPanes)}</span>
      <span data-testid="blocking-error">
        {state.blockingError ? text(state.blockingError.message) : null}
      </span>
    </>
  );
}

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  persistence.loadAppData.mockResolvedValue(loadedAppData());
  persistence.saveConfig.mockResolvedValue(null);
  persistence.countSnapshots.mockResolvedValue(0);
  persistence.launchLanguage.mockResolvedValue({ language: "en", systemLanguage: "en", systemLocale: null });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  latestStartup = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

async function renderStartupState(): Promise<HTMLElement> {
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
  return host;
}

describe("first-run settings", () => {
  it("loads without writing defaults", async () => {
    const host = await renderStartupState();
    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe("ready");
    expect(persistence.saveConfig).not.toHaveBeenCalled();
  });
});

describe("persistence failure presentation", () => {
  it("keeps a raw panes read diagnostic in the log and out of recovery copy", async () => {
    persistence.loadAppData.mockResolvedValueOnce(
      loadedAppData({ panesError: "TypeError EACCES /private/tmp/HOSTILE-SENTINEL" }),
    );

    const host = await renderStartupState();

    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe("failed");
    const message = host.querySelector('[data-testid="load-error"]')?.textContent ?? "";
    expect(message).toContain("pane text file");
    expect(message).not.toContain("EACCES");
    expect(message).not.toContain("HOSTILE-SENTINEL");
    expect(message).not.toContain("TypeError");
  });

  it("keeps pane shape diagnostics in the log and out of recovery copy", async () => {
    persistence.loadAppData.mockResolvedValueOnce(
      loadedAppData({
        panes: {
          panes: [{ id: "HOSTILE-SENTINEL", content: 42 }],
        } as unknown as LoadedAppData["panes"],
      }),
    );

    const host = await renderStartupState();

    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe("failed");
    const message = host.querySelector('[data-testid="load-error"]')?.textContent ?? "";
    expect(message).toContain("is damaged");
    expect(message).not.toContain("HOSTILE-SENTINEL");
    expect(message).not.toContain("non-string content");
  });

  it("names where an unreadable settings file was moved", async () => {
    persistence.loadAppData.mockResolvedValueOnce(
      loadedAppData({
        configQuarantinedTo: "/private/tmp/quickdeck-test/config-20261006-010203-004-utc.invalid",
      }),
    );

    const host = await renderStartupState();

    const message = host.querySelector('[data-testid="blocking-error"]')?.textContent ?? "";
    expect(message).toContain(
      "moved it to /private/tmp/quickdeck-test/config-20261006-010203-004-utc.invalid",
    );
    expect(message).toContain("default settings");
  });

  it("names a settings file set aside by a save", async () => {
    persistence.saveConfig.mockResolvedValueOnce(
      "/private/tmp/quickdeck-test/config-20261006-010203-004-utc.invalid",
    );
    let state: ReturnType<typeof useAppState> | undefined;
    function SaveProbe() {
      state = useAppState();
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <AppStateProvider>
          <SaveProbe />
          <StartupState />
        </AppStateProvider>,
      );
    });

    await act(async () => {
      await state?.saveNow();
    });

    const message = host.querySelector('[data-testid="blocking-error"]')?.textContent ?? "";
    expect(message).toContain(
      "moved it to /private/tmp/quickdeck-test/config-20261006-010203-004-utc.invalid",
    );
    expect(message).toContain("current settings stay in use");
  });

  it("names the pane text file a halt left in place, and where the reset moved it", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ panesError: "unreadable" }));
    persistence.quarantineCorruptPanes.mockResolvedValueOnce(
      "/private/tmp/quickdeck-test/panes-20261006-010203-004-utc.invalid",
    );
    let state: ReturnType<typeof useAppState> | undefined;
    function ResetProbe() {
      state = useAppState();
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <AppStateProvider>
          <ResetProbe />
          <StartupState />
        </AppStateProvider>,
      );
    });
    expect(host.querySelector('[data-testid="load-error-path"]')?.textContent).toBe(
      "/private/tmp/quickdeck-test/panes.json",
    );

    await act(async () => {
      await state?.resetCorruptPanes();
    });

    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe("ready");
    const message = host.querySelector('[data-testid="blocking-error"]')?.textContent ?? "";
    expect(message).toContain("moved to /private/tmp/quickdeck-test/panes-20261006-010203-004-utc.invalid");
  });

  it("names the store a failed load stopped at and keeps its diagnostic out of the copy", async () => {
    persistence.loadAppData.mockRejectedValueOnce({
      path: "/private/tmp/quickdeck-test/snapshots.sqlite3",
      message: "TypeError EACCES HOSTILE-SENTINEL",
    });

    const host = await renderStartupState();

    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe("failed");
    expect(host.querySelector('[data-testid="load-error-path"]')?.textContent).toBe(
      "/private/tmp/quickdeck-test/snapshots.sqlite3",
    );
    const message = host.querySelector('[data-testid="load-error"]')?.textContent ?? "";
    expect(message).not.toContain("HOSTILE-SENTINEL");
    expect(message).not.toContain("EACCES");
  });

  it("names no file when a failed load stopped before reaching a store", async () => {
    persistence.loadAppData.mockRejectedValueOnce("could not create data dir HOSTILE-SENTINEL");

    const host = await renderStartupState();

    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe("failed");
    expect(host.querySelector('[data-testid="load-error-path"]')?.textContent).toBe("");
  });
});

describe("startup invocation and recovery truth", () => {
  it("does not let an old StrictMode load overwrite edits in the same provider", async () => {
    let settle!: () => void;
    persistence.loadAppData.mockImplementationOnce(() => new Promise<LoadedAppData>((resolve) => { settle = () => resolve(loadedAppData()); }));
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(<React.StrictMode><AppStateProvider><StartupState /></AppStateProvider></React.StrictMode>));
    try {
      expect(latestStartup!.loadStatus).toBe("ready");
      await act(async () => latestStartup!.updatePaneContent(latestStartup!.activePaneId, "live edit"));
    } finally { await act(async () => settle()); }
    expect(latestStartup!.panes[0].content).toBe("live edit");
    expect(latestStartup!.saveState).toBe("unsaved");
  });

  it("retains a stale completed settings move without replacing live edits or the newer-settings notice", async () => {
    let settle!: () => void;
    persistence.loadAppData.mockImplementationOnce(() => new Promise<LoadedAppData>((resolve) => {
      settle = () => resolve(loadedAppData({ configQuarantinedTo: "/actual/config.invalid" }));
    }));
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ configNewer: 2 }));
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(<React.StrictMode><AppStateProvider><StartupState /></AppStateProvider></React.StrictMode>));
    try {
      expect(latestStartup!.loadStatus).toBe("ready");
      await act(async () => latestStartup!.updatePaneContent(latestStartup!.activePaneId, "live edit"));
    } finally { await act(async () => settle()); }
    expect(latestStartup!.panes[0].content).toBe("live edit");
    expect(latestStartup!.saveState).toBe("unsaved");
    expect(latestStartup!.blockingError?.message.key).toBe("settingsNewer.body");
    expect(latestStartup!.blockingError?.details).toEqual([{ key: "load.settingsSetAside", values: { path: "/actual/config.invalid" } }]);
    expect(latestStartup!.loadRecovery).toEqual(latestStartup!.blockingError?.details);
  });

  it.each([null, "/actual/current-config.invalid"])("adds an earlier stale move alongside the current settings notice (%s)", async (currentMove) => {
    let settleOld!: () => void;
    let settleCurrent!: () => void;
    persistence.loadAppData.mockImplementationOnce(() => new Promise<LoadedAppData>((resolve) => {
      settleOld = () => resolve(loadedAppData({ configQuarantinedTo: "/actual/config.invalid" }));
    }));
    persistence.loadAppData.mockImplementationOnce(() => new Promise<LoadedAppData>((resolve) => {
      settleCurrent = () => resolve(loadedAppData({ configNewer: currentMove === null ? 2 : null, configQuarantinedTo: currentMove }));
    }));
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(<React.StrictMode><AppStateProvider><StartupState /></AppStateProvider></React.StrictMode>));
    try { await act(async () => settleOld()); }
    finally { await act(async () => { settleOld(); settleCurrent(); }); }
    expect(latestStartup!.loadStatus).toBe("ready");
    expect(latestStartup!.blockingError?.message.key).toBe(currentMove === null ? "settingsNewer.body" : "settingsReset.body");
    expect(latestStartup!.blockingError?.details).toEqual([{ key: "load.settingsSetAside", values: { path: "/actual/config.invalid" } }]);
  });

  it.each([null, 2])("reports actual authored panes after a move and preserves newer-settings notice (%s)", async (configNewer) => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ panesError: "bad" }));
    persistence.quarantineCorruptPanes.mockResolvedValueOnce("/actual/panes.invalid");
    await renderStartupState();
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ configNewer, panes: { panes: [{ id: "authored", title: "Authored", content: "restored by another writer", headerColor: "#112233", backgroundColor: "#ffffff" }] } }));
    await act(async () => latestStartup!.resetCorruptPanes());
    expect(latestStartup!.loadStatus).toBe("ready");
    expect(latestStartup!.panes[0].content).toBe("restored by another writer");
    const paneMove = { key: "load.panesSetAside", values: { path: "/actual/panes.invalid" } };
    if (configNewer === null) expect(latestStartup!.blockingError?.message).toEqual(paneMove);
    else {
      expect(latestStartup!.blockingError?.message.key).toBe("settingsNewer.body");
      expect(latestStartup!.blockingError?.details).toContainEqual(paneMove);
    }
  });

  it("halts a timed-out required load and retains its late move without adopting its panes", async () => {
    vi.useFakeTimers();
    let settle!: () => void;
    persistence.loadAppData.mockImplementationOnce(() => new Promise<LoadedAppData>((resolve) => {
      settle = () => resolve(loadedAppData({ configQuarantinedTo: "/actual/config.invalid", panes: { panes: [
        { id: "late", title: "Late", content: "must not adopt", headerColor: "#112233", backgroundColor: "#ffffff" },
      ] } }));
    }));
    try {
      await renderStartupState();
      await act(async () => vi.advanceTimersByTimeAsync(STARTUP_LOAD_BOUND_MS));
      expect(latestStartup!.loadStatus).toBe("failed");
      expect(latestStartup!.loadError?.key).toBe("load.failed");
      expect(persistence.savePanes).not.toHaveBeenCalled();
    } finally { await act(async () => settle()); vi.useRealTimers(); }
    expect(latestStartup!.loadStatus).toBe("failed");
    expect(latestStartup!.panes[0].content).not.toBe("must not adopt");
    expect(latestStartup!.loadRecovery).toContainEqual({ key: "load.settingsSetAside", values: { path: "/actual/config.invalid" } });
  });

  it("bounds informational startup count without allowing its late value to replace a current count", async () => {
    vi.useFakeTimers();
    let settle!: () => void;
    persistence.countSnapshots.mockImplementationOnce(() => new Promise<number>((resolve) => { settle = () => resolve(999); }));
    try {
      await renderStartupState();
      await act(async () => vi.advanceTimersByTimeAsync(STARTUP_LOAD_BOUND_MS));
      expect(latestStartup!.loadStatus).toBe("ready");
      persistence.countSnapshots.mockResolvedValueOnce(7);
      await act(async () => latestStartup!.refreshSnapshotCount());
      expect(latestStartup!.snapshotCount).toBe(7);
    } finally { await act(async () => settle()); vi.useRealTimers(); }
    expect(latestStartup!.snapshotCount).toBe(7);
  });

  it("reads the snapshot count again once ready when the startup count was late", async () => {
    vi.useFakeTimers();
    persistence.countSnapshots
      .mockImplementationOnce(() => new Promise<number>(() => undefined))
      .mockResolvedValueOnce(5);
    try {
      await renderStartupState();
      await act(async () => vi.advanceTimersByTimeAsync(STARTUP_LOAD_BOUND_MS));
      expect(latestStartup!.loadStatus).toBe("ready");
      expect(latestStartup!.snapshotCount).toBe(5);
    } finally { vi.useRealTimers(); }
  });

  it("retains a completed settings move on a later native required-load failure", async () => {
    persistence.loadAppData.mockRejectedValueOnce({ path: "/actual/snapshots.sqlite3", configQuarantinedTo: "/actual/config.invalid", message: "HOSTILE" });
    const host = await renderStartupState();
    expect(latestStartup!.loadStatus).toBe("failed");
    expect(host.querySelector('[data-testid="load-recovery"]')?.textContent).toContain("moved to /actual/config.invalid");
    expect(host.querySelector('[data-testid="load-recovery"]')?.textContent).not.toContain("default settings");
    expect(host.textContent).not.toContain("HOSTILE");
  });

  it("reports the completed panes move when reset reload fails without claiming an empty editor", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ panesError: "bad", configQuarantinedTo: "/actual/config.invalid" }));
    persistence.quarantineCorruptPanes.mockResolvedValueOnce("/actual/panes.invalid");
    await renderStartupState();
    persistence.loadAppData.mockRejectedValueOnce({ path: "/actual/snapshots.sqlite3", message: "HOSTILE" });
    await act(async () => latestStartup!.resetCorruptPanes());
    expect(latestStartup!.loadStatus).toBe("failed");
    expect(latestStartup!.loadErrorPath).toBe("/actual/snapshots.sqlite3");
    expect(latestStartup!.loadRecovery).toEqual([
      { key: "load.settingsSetAside", values: { path: "/actual/config.invalid" } },
      { key: "load.panesSetAside", values: { path: "/actual/panes.invalid" } },
    ]);
    expect(latestStartup!.blockingError).toBeNull();
  });

  it("claims reset synchronously so a duplicate request cannot lose its completed move", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ panesError: "bad" }));
    await renderStartupState();
    let settle!: () => void;
    persistence.quarantineCorruptPanes.mockImplementationOnce(() => new Promise<string>((resolve) => { settle = () => resolve("/actual/panes.invalid"); }));
    let resetting!: Promise<void>;
    await act(async () => { resetting = latestStartup!.resetCorruptPanes(); void latestStartup!.resetCorruptPanes(); });
    try { expect(persistence.quarantineCorruptPanes).toHaveBeenCalledOnce(); }
    finally { await act(async () => { settle(); await resetting; }); }
    expect(latestStartup!.blockingError?.message).toEqual({ key: "panesSetAside.body", values: { path: "/actual/panes.invalid" } });
  });

  it.each([null, 2])("reloads a repaired/newer reset target without claiming a move (newer: %s)", async (newer) => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ panesError: "bad" }));
    persistence.quarantineCorruptPanes.mockResolvedValueOnce(null);
    await renderStartupState();
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ panesNewer: newer }));
    await act(async () => latestStartup!.resetCorruptPanes());
    expect(latestStartup!.loadStatus).toBe(newer === null ? "ready" : "failed");
    expect(latestStartup!.loadErrorIsCorruptPanes).toBe(false);
    expect(latestStartup!.loadRecovery).toEqual([]);
    expect(latestStartup!.blockingError).toBeNull();
  });
});

describe("stores from a newer build", () => {
  it("halts on a newer panes.json, names it, and offers no reset", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ panesNewer: 2 }));

    const host = await renderStartupState();

    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe("failed");
    const message = host.querySelector('[data-testid="load-error"]')?.textContent ?? "";
    expect(message).toContain("panes.json");
    expect(message).toContain("newer version");
    expect(message).toContain("(format 2)");
    expect(host.querySelector('[data-testid="corrupt-panes"]')?.textContent).toBe("false");
  });

  it("halts on a newer snapshots.sqlite3 and names it", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ snapshotsNewer: 3 }));

    const host = await renderStartupState();

    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe("failed");
    const message = host.querySelector('[data-testid="load-error"]')?.textContent ?? "";
    expect(message).toContain("snapshots.sqlite3");
    expect(message).toContain("(format 3)");
    expect(host.querySelector('[data-testid="load-error-path"]')?.textContent).toBe(
      "/private/tmp/quickdeck-test/snapshots.sqlite3",
    );
    expect(host.querySelector('[data-testid="corrupt-panes"]')?.textContent).toBe("false");
  });

  it("runs on built-in settings beside a newer config.json and says so", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ configNewer: 2 }));

    const host = await renderStartupState();

    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe("ready");
    const message = host.querySelector('[data-testid="blocking-error"]')?.textContent ?? "";
    expect(message).toContain("config.json");
    expect(message).toContain("default settings");
  });
});

function LanguageProbe() {
  const { t } = useI18n();
  const { language } = useAppState();
  return (
    <>
      <span data-testid="language">{language}</span>
      <span data-testid="settings-title">{t("settings.title")}</span>
    </>
  );
}

async function renderLanguageProbe(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <AppStateProvider>
        <LanguageProbe />
      </AppStateProvider>,
    );
  });
  await act(() => vi.dynamicImportSettled());
  return host;
}

describe("interface language", () => {
  it("speaks the saved language and declares it on the document", async () => {
    persistence.loadAppData.mockResolvedValueOnce(
      loadedAppData({ config: { language: "ja" } as LoadedAppData["config"], systemLanguage: "ko" }),
    );

    const host = await renderLanguageProbe();

    expect(host.querySelector('[data-testid="language"]')?.textContent).toBe("ja");
    expect(host.querySelector('[data-testid="settings-title"]')?.textContent).toBe("設定");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("shows a failed load's halt screen in the language the menu speaks", async () => {
    persistence.loadAppData.mockRejectedValueOnce("the data folder was not claimed");
    persistence.launchLanguage.mockResolvedValueOnce({ language: "ja", systemLanguage: "ko", systemLocale: "ko-KR" });

    const host = await renderLanguageProbe();

    expect(host.querySelector('[data-testid="language"]')?.textContent).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("follows the computer's language under System", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ systemLanguage: "ko" }));

    const host = await renderLanguageProbe();

    expect(host.querySelector('[data-testid="language"]')?.textContent).toBe("ko");
    expect(host.querySelector('[data-testid="settings-title"]')?.textContent).toBe("설정");
  });

  it("falls back to English for a computer language the core did not resolve", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ systemLanguage: "xx" }));

    const host = await renderLanguageProbe();

    expect(host.querySelector('[data-testid="language"]')?.textContent).toBe("en");
  });

  it("speaks a newly saved language once its catalogue has loaded", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ systemLanguage: "en" }));
    let state: ReturnType<typeof useAppState> | undefined;
    function SettingsProbe() {
      state = useAppState();
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <AppStateProvider>
          <SettingsProbe />
          <LanguageProbe />
        </AppStateProvider>,
      );
    });
    expect(host.querySelector('[data-testid="settings-title"]')?.textContent).toBe("Settings");

    await act(async () => {
      state?.updateSettings({ ...state.settings, language: "fr" });
    });
    await act(() => vi.dynamicImportSettled());

    expect(host.querySelector('[data-testid="language"]')?.textContent).toBe("fr");
    expect(host.querySelector('[data-testid="settings-title"]')?.textContent).toBe("Réglages");
  });

  it("gives the first pane its default title in that language", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({ systemLanguage: "de" }));
    let panes: { title: string }[] = [];
    function PaneProbe() {
      panes = useAppState().panes;
      return null;
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <AppStateProvider>
          <PaneProbe />
        </AppStateProvider>,
      );
    });
    await act(() => vi.dynamicImportSettled());

    expect(panes.map((pane) => pane.title)).toEqual(["Neuer Puffer"]);
  });
});


it("sends every set that differs from its built-in on each save", async () => {
  let state: ReturnType<typeof useAppState>;
  function Probe() { state = useAppState(); return null; }
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => { root?.render(<AppStateProvider><Probe /></AppStateProvider>); });
  await act(async () => { await state!.saveNow(); });
  expect(persistence.saveConfig).toHaveBeenLastCalledWith({});
  await act(async () => { state!.updateSettings({ ...state!.settings, zen: true }); });
  await act(async () => { await state!.saveNow(); });
  expect(persistence.saveConfig).toHaveBeenLastCalledWith({ zen: true });
  await act(async () => { state!.updatePaneContent(state!.activePaneId, "new text"); });
  await act(async () => { await state!.saveNow(); });
  expect(persistence.saveConfig).toHaveBeenLastCalledWith({ zen: true });
});

it("reads an invalid set as its built-in and drops it from the file at the next save", async () => {
  persistence.loadAppData.mockResolvedValue(
    loadedAppData({ config: { zen: "yes", autosaveDelaySeconds: 0, topmost: true } }),
  );
  let state: ReturnType<typeof useAppState>;
  function Probe() { state = useAppState(); return null; }
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => { root?.render(<AppStateProvider><Probe /></AppStateProvider>); });
  expect(state!.settings).toEqual({ ...defaultSettings, topmost: true });
  expect(persistence.saveConfig).not.toHaveBeenCalled();
  await act(async () => { await state!.saveNow(); });
  expect(persistence.saveConfig).toHaveBeenLastCalledWith({ topmost: true });
});
