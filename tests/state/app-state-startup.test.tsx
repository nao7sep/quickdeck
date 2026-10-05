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
  saveState: vi.fn(),
  savePanes: vi.fn(),
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
    countSnapshots: vi.fn(async () => 0),
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
    dataDir: "/private/tmp/quickdeck-test",
    debugEnabled: false,
    systemLanguage: "en",
    systemLocale: null,
    ...overrides,
  };
}

function StartupState() {
  const state = useAppState();
  const { text } = useI18n();
  return (
    <>
      <span data-testid="load-status">{state.loadStatus}</span>
      <span data-testid="save-state">{state.saveState}</span>
      <span data-testid="load-error">{state.loadError ? text(state.loadError) : null}</span>
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
  persistence.saveConfig.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
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

  it("keeps internal quarantine paths in the log and out of settings recovery copy", async () => {
    persistence.loadAppData.mockResolvedValueOnce(
      loadedAppData({
        configQuarantinedTo: "/.quickdeck/HOSTILE-SENTINEL-EACCES.invalid",
      }),
    );

    const host = await renderStartupState();

    const message = host.querySelector('[data-testid="blocking-error"]')?.textContent ?? "";
    expect(message).toContain("preserved copy's location is recorded in the log");
    expect(message).not.toContain("/.quickdeck/");
    expect(message).not.toContain(".invalid");
    expect(message).not.toContain("HOSTILE-SENTINEL");
    expect(message).not.toContain("EACCES");
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
