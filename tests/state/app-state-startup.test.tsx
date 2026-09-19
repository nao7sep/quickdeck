import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useI18n } from "../../src/i18n/I18nContext";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";
import type { LoadedAppData } from "../../src/services/persistence";

const persistence = vi.hoisted(() => ({
  loadAppData: vi.fn(),
  quarantineCorruptConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock("../../src/services/persistence", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../src/services/persistence")
  >();
  return {
    ...original,
    loadAppData: persistence.loadAppData,
    quarantineCorruptConfig: persistence.quarantineCorruptConfig,
    saveConfig: persistence.saveConfig,
    countSnapshots: vi.fn(async () => 0),
  };
});

function loadedAppData(overrides: Partial<LoadedAppData> = {}): LoadedAppData {
  return {
    config: null,
    configQuarantinedTo: null,
    state: null,
    panes: null,
    panesError: null,
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
  persistence.quarantineCorruptConfig.mockResolvedValue("/.quickdeck/config.invalid");
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

describe("first-run settings materialization", () => {
  it("halts with authored copy instead of settling a rejected write as saved", async () => {
    persistence.saveConfig.mockRejectedValueOnce(
      new TypeError("EACCES /private/tmp/HOSTILE-SENTINEL IPC"),
    );

    const host = await renderStartupState();

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
          version: 1,
          panes: [{ id: "HOSTILE-SENTINEL", content: 42 }],
          updatedAtUtc: "2026-09-06T00:00:00.000Z",
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

    expect(panes.map((pane) => pane.title)).toEqual(["Neuer Puffer"]);
  });
});
