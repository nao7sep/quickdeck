import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useI18n } from "../../src/i18n/I18nContext";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";
import { defaultSettings } from "../../src/state/defaults";
import type { LoadedAppData } from "../../src/services/persistence";

const persistence = vi.hoisted(() => ({
  loadAppData: vi.fn(),
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
    state: null,
    panes: null,
    refused: [],
    off: [],
    dataDir: "/private/tmp/quickdeck-test",
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
      <span data-testid="pane-content">{state.panes[0].content}</span>
      <span data-testid="load-error-path">{state.loadErrorPath}</span>
      <span data-testid="blocking-error">
        {state.blockingError ? [state.blockingError.message, ...(state.blockingError.details ?? [])].map(text).join(" ") : null}
      </span>
    </>
  );
}

let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  persistence.loadAppData.mockResolvedValue(loadedAppData());
  persistence.saveConfig.mockResolvedValue(undefined);
  persistence.saveState.mockResolvedValue(undefined);
  persistence.savePanes.mockResolvedValue(undefined);
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

describe("refused files", () => {
  it("stops on every refused file it is given, opens nothing and saves nothing", async () => {
    const refused = [
      { path: "/data/config.json", newer: 2 },
      { path: "/data/panes.json", newer: null },
    ];
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({
      refused,
      panes: { panes: [{ id: "p", title: "", content: "must not open", headerColor: "#112233", backgroundColor: "#ffffff" }] },
    }));

    const host = await renderStartupState();

    expect(latestStartup!.loadStatus).toBe("failed");
    expect(latestStartup!.loadRefused).toEqual(refused);
    expect(latestStartup!.loadError).toBeNull();
    expect(host.querySelector('[data-testid="pane-content"]')?.textContent).not.toBe("must not open");
    await act(async () => {
      await latestStartup!.saveNow();
    });
    expect(persistence.saveConfig).not.toHaveBeenCalled();
    expect(persistence.savePanes).not.toHaveBeenCalled();
    expect(persistence.saveState).not.toHaveBeenCalled();
  });

  it("speaks the saved language on the stop when settings could be read", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({
      config: { language: "ja" },
      refused: [{ path: "/data/state.json", newer: 2 }],
    }));

    await renderStartupState();
    await act(() => vi.dynamicImportSettled());

    expect(latestStartup!.loadStatus).toBe("failed");
    expect(latestStartup!.language).toBe("ja");
  });

  it("runs beside an unreadable records or backup database and says so once", async () => {
    persistence.loadAppData.mockResolvedValueOnce(loadedAppData({
      off: [
        { path: "/data/records.sqlite3", newer: null },
        { path: "/data/backups.sqlite3", newer: null },
      ],
    }));

    const host = await renderStartupState();

    expect(host.querySelector('[data-testid="load-status"]')?.textContent).toBe("ready");
    const notice = host.querySelector('[data-testid="blocking-error"]')?.textContent ?? "";
    expect(notice).toContain("Records: /data/records.sqlite3");
    expect(notice).toContain("Backup history: /data/backups.sqlite3");
    expect(notice).toContain("left them untouched");
  });
});

describe("persistence failure presentation", () => {
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

describe("startup invocation", () => {
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

it("reads an invalid set as its built-in and saves it back as it was until the user changes it", async () => {
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
  expect(persistence.saveConfig).toHaveBeenLastCalledWith({ zen: "yes", autosaveDelaySeconds: 0, topmost: true });
  await act(async () => { state!.updateSettings({ ...state!.settings, autosaveDelaySeconds: 5 }); });
  await act(async () => { await state!.saveNow(); });
  expect(persistence.saveConfig).toHaveBeenLastCalledWith({ zen: "yes", autosaveDelaySeconds: 5, topmost: true });
});
