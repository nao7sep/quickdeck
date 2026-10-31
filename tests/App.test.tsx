// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appState: {} as Record<string, unknown>,
  applyWindowTheme: vi.fn<(theme: "system" | "light" | "dark") => Promise<void>>(() => Promise.resolve()),
  applyLanguage: vi.fn<(language: string) => Promise<void>>(() => Promise.resolve()),
  setZoom: vi.fn<(zoom: number) => Promise<void>>(() => Promise.resolve()),
  applyTopmost: vi.fn(() => Promise.resolve()),
  setMinSize: vi.fn(() => Promise.resolve()),
  isMaximized: vi.fn(() => Promise.resolve(false)),
  isFullscreen: vi.fn(() => Promise.resolve(false)),
  isMinimized: vi.fn(() => Promise.resolve(false)),
  currentMonitor: vi.fn(() => Promise.resolve(null)),
  logWarn: vi.fn(),
  openRecordsWindow: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  aboutRequested: null as (() => void) | null,
  onCloseRequested: vi.fn<(
    listener: (event: { preventDefault: () => void }) => Promise<void>,
  ) => Promise<() => void>>(() => Promise.resolve(() => undefined)),
  onSessionEnding: vi.fn<(listener: (attempt: number) => void) => Promise<() => void>>(
    () => Promise.resolve(() => undefined),
  ),
  reportSessionEndSaved: vi.fn(() => Promise.resolve()),
  destroy: vi.fn(() => Promise.resolve()),
}));

vi.mock("../src/state/AppStateContext", () => ({
  useAppState: () => mocks.appState,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: () => Promise.resolve() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => undefined) }));
vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: mocks.currentMonitor,
  getCurrentWindow: () => ({
    setMinSize: mocks.setMinSize,
    isMaximized: mocks.isMaximized,
    isFullscreen: mocks.isFullscreen,
    isMinimized: mocks.isMinimized,
    onMoved: () => Promise.resolve(() => undefined),
    onScaleChanged: () => Promise.resolve(() => undefined),
    onCloseRequested: mocks.onCloseRequested,
    destroy: mocks.destroy,
  }),
  LogicalSize: class LogicalSize {
    constructor(public width: number, public height: number) {}
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: mocks.setZoom }),
}));
vi.mock("../src/services/appMenu", () => ({
  onAboutRequested: (listener: () => void) => {
    mocks.aboutRequested = listener;
    return Promise.resolve(() => undefined);
  },
}));
vi.mock("../src/services/windowTopmost", () => ({ applyTopmost: mocks.applyTopmost }));
vi.mock("../src/services/windowTheme", () => ({
  applyWindowTheme: mocks.applyWindowTheme,
}));
vi.mock("../src/services/persistence", () => ({
  applyLanguage: mocks.applyLanguage,
  applyDisplayPreferences: () => Promise.resolve(),
  systemTheme: () => Promise.resolve("dark"),
}));
vi.mock("../src/services/records", () => ({
  openRecordsWindow: mocks.openRecordsWindow,
}));
vi.mock("../src/services/logger", () => ({
  logError: vi.fn(),
  logWarn: mocks.logWarn,
  serializeError: (error: unknown) => ({ value: String(error) }),
}));
vi.mock("../src/services/quit", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/services/quit")>(),
  onSessionEnding: mocks.onSessionEnding,
  reportSessionEndSaved: mocks.reportSessionEndSaved,
}));

import { App } from "../src/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  mocks.applyWindowTheme.mockReset();
  mocks.applyWindowTheme.mockResolvedValue();
  mocks.applyLanguage.mockReset();
  mocks.applyLanguage.mockResolvedValue();
  mocks.setZoom.mockReset();
  mocks.setZoom.mockResolvedValue();
  mocks.applyTopmost.mockReset();
  mocks.applyTopmost.mockResolvedValue();
  mocks.setMinSize.mockReset();
  mocks.setMinSize.mockResolvedValue();
  mocks.logWarn.mockReset();
  mocks.onCloseRequested.mockReset();
  mocks.onCloseRequested.mockImplementation(() => Promise.resolve(() => undefined));
  mocks.onSessionEnding.mockReset();
  mocks.onSessionEnding.mockImplementation(() => Promise.resolve(() => undefined));
  mocks.reportSessionEndSaved.mockClear();
  mocks.destroy.mockClear();
});

function createAppState() {
  const noop = vi.fn();
  return {
    panes: [{
      id: "pane-1",
      title: "Pane 1",
      content: "",
      headerColor: "#4338ca",
      backgroundColor: "#ffffff",
    }],
    activePaneId: "pane-1",
    blockingError: null,
    dismissBlockingError: noop,
    loadError: null,
    loadErrorIsCorruptPanes: false,
    resetCorruptPanes: vi.fn(() => Promise.resolve()),
    loadStatus: "ready",
    saveState: "saved",
    language: "en",
    settings: {
      language: "system",
      theme: "system",
      zen: false,
      topmost: false,
      uiFontFamily: "",
      editorFontFamily: "monospace",
      editorFontSize: 14,
      editorLineHeight: 1.5,
      editorPadding: 12,
      editorBold: false,
      editorItalic: false,
      editorUnderline: false,
      autosaveDelaySeconds: 1,
      snapshotPageSize: 20,
    },
    zoomLevel: 1,
    setZoomLevel: noop,
    setActivePaneId: noop,
    addPane: noop,
    movePane: noop,
    saveNow: vi.fn(() => Promise.resolve()),
    showBlockingError: noop,
    showToast: noop,
    snapshotAllPanes: vi.fn(() => Promise.resolve()),
    snapshotCount: 0,
    snapshotJustSavedAt: null,
    updateSettings: noop,
    updatePaneTitle: noop,
    commitPaneTitle: noop,
    updatePaneContent: noop,
    deletePane: noop,
    recordSnapshot: noop,
    toasts: [],
    dismissToast: noop,
    clearToast: noop,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("App close listener lifetime", () => {
  function delayedRegistration() {
    let resolve!: (unlisten: () => void) => void;
    const promise = new Promise<() => void>((settle) => { resolve = settle; });
    const unlisten = vi.fn();
    return { promise, unlisten, resolve: () => resolve(unlisten) };
  }

  it("disposes listener registrations that arrive after unmount and ignores their callbacks", async () => {
    const close = delayedRegistration();
    const session = delayedRegistration();
    mocks.onCloseRequested.mockReturnValueOnce(close.promise);
    mocks.onSessionEnding.mockReturnValueOnce(session.promise);
    const state = createAppState();
    mocks.appState = state;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    const closeCallback = mocks.onCloseRequested.mock.calls[0][0];
    const sessionCallback = mocks.onSessionEnding.mock.calls[0][0];
    await act(async () => root?.unmount());
    root = null;
    await act(async () => { close.resolve(); session.resolve(); });
    expect(close.unlisten).toHaveBeenCalledOnce();
    expect(session.unlisten).toHaveBeenCalledOnce();
    const preventDefault = vi.fn();
    await act(async () => {
      await closeCallback({ preventDefault });
      sessionCallback(1);
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(state.snapshotAllPanes).not.toHaveBeenCalled();
    expect(state.saveNow).not.toHaveBeenCalled();
    expect(mocks.reportSessionEndSaved).not.toHaveBeenCalled();
  });

  it("retires delayed registrations from StrictMode replay while keeping the live owner", async () => {
    const closes = [delayedRegistration(), delayedRegistration()];
    const sessions = [delayedRegistration(), delayedRegistration()];
    mocks.onCloseRequested.mockReturnValueOnce(closes[0].promise).mockReturnValueOnce(closes[1].promise);
    mocks.onSessionEnding.mockReturnValueOnce(sessions[0].promise).mockReturnValueOnce(sessions[1].promise);
    const state = createAppState();
    mocks.appState = state;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<React.StrictMode><App /></React.StrictMode>));
    expect(mocks.onCloseRequested).toHaveBeenCalledTimes(2);
    expect(mocks.onSessionEnding).toHaveBeenCalledTimes(2);
    await act(async () => {
      closes.forEach((registration) => registration.resolve());
      sessions.forEach((registration) => registration.resolve());
    });
    expect(closes[0].unlisten).toHaveBeenCalledOnce();
    expect(sessions[0].unlisten).toHaveBeenCalledOnce();
    expect(closes[1].unlisten).not.toHaveBeenCalled();
    expect(sessions[1].unlisten).not.toHaveBeenCalled();
    const preventDefault = vi.fn();
    await act(async () => {
      await mocks.onCloseRequested.mock.calls[0][0]({ preventDefault });
      mocks.onSessionEnding.mock.calls[0][0](1);
    });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(state.snapshotAllPanes).not.toHaveBeenCalled();
    expect(state.saveNow).not.toHaveBeenCalled();
    await act(async () => { mocks.onSessionEnding.mock.calls[1][0](1); });
    expect(state.snapshotAllPanes).toHaveBeenCalledOnce();
    expect(state.saveNow).toHaveBeenCalledOnce();
    expect(mocks.reportSessionEndSaved).toHaveBeenCalledExactlyOnceWith(1);
    await act(async () => root?.unmount());
    root = null;
    expect(closes[1].unlisten).toHaveBeenCalledOnce();
    expect(sessions[1].unlisten).toHaveBeenCalledOnce();
  });

  it("retires callbacks during native destruction without calling unsafe unlisten handles", async () => {
    const close = delayedRegistration();
    const session = delayedRegistration();
    mocks.onCloseRequested.mockReturnValueOnce(close.promise);
    mocks.onSessionEnding.mockReturnValueOnce(session.promise);
    const state = { ...createAppState(), saveNow: vi.fn(() => Promise.resolve(true)) };
    mocks.appState = state;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    const preventDefault = vi.fn();
    await act(async () => { await mocks.onCloseRequested.mock.calls[0][0]({ preventDefault }); });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    await act(async () => root?.unmount());
    root = null;
    await act(async () => { close.resolve(); session.resolve(); });
    expect(close.unlisten).not.toHaveBeenCalled();
    expect(session.unlisten).not.toHaveBeenCalled();
    await act(async () => {
      await mocks.onCloseRequested.mock.calls[0][0]({ preventDefault });
      mocks.onSessionEnding.mock.calls[0][0](1);
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(state.saveNow).toHaveBeenCalledOnce();
    expect(mocks.reportSessionEndSaved).not.toHaveBeenCalled();
  });
});

describe("App window-chrome results", () => {
  it("applies the content-derived window minimum on startup", async () => {
    mocks.appState = createAppState();

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    expect(mocks.setMinSize).toHaveBeenCalledOnce();
  });

  it("applies the theme only once settings have loaded, then on every change", async () => {
    const state = createAppState();
    mocks.appState = { ...state, loadStatus: "loading" };
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    // The Rust core applied the saved theme before showing the window; the
    // pre-load default must not replace it.
    expect(mocks.applyWindowTheme).not.toHaveBeenCalled();

    mocks.appState = { ...state, settings: { ...state.settings, theme: "dark" } };
    await act(async () => root?.render(<App />));
    await flushEffects();
    expect(mocks.applyWindowTheme).toHaveBeenLastCalledWith("dark");

    mocks.appState = { ...state, settings: { ...state.settings, theme: "system" } };
    await act(async () => root?.render(<App />));
    await flushEffects();
    expect(mocks.applyWindowTheme).toHaveBeenLastCalledWith("system");
    expect(mocks.applyWindowTheme).toHaveBeenCalledTimes(2);
  });

  it("renders no text until settings have loaded, so the first text is in the saved language", async () => {
    mocks.appState = { ...createAppState(), loadStatus: "loading" };
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    expect(container.textContent).toBe("");
    expect(container.querySelector(".appShell")).not.toBeNull();
  });

  it("sends the language to the native menu once settings have loaded, then on every change", async () => {
    const state = createAppState();
    mocks.appState = { ...state, loadStatus: "loading" };
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();
    expect(mocks.applyLanguage).not.toHaveBeenCalled();

    mocks.appState = state;
    await act(async () => root?.render(<App />));
    await flushEffects();
    expect(mocks.applyLanguage).toHaveBeenLastCalledWith("en");

    mocks.appState = { ...state, language: "ja" };
    await act(async () => root?.render(<App />));
    await flushEffects();
    expect(mocks.applyLanguage).toHaveBeenLastCalledWith("ja");
    expect(mocks.applyLanguage).toHaveBeenCalledTimes(2);
  });

  it("keeps a native-menu language failure until a later language applies", async () => {
    const state = createAppState();
    mocks.appState = state;
    mocks.applyLanguage.mockRejectedValueOnce(new Error("EACCES /private/tmp/MENU"));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    expect(document.body.textContent).toContain("The menu bar language could not be changed");
    expect(document.body.textContent).not.toContain("/private/tmp");

    mocks.appState = { ...state, language: "de" };
    await act(async () => root?.render(<App />));
    await flushEffects();
    expect(document.body.textContent).not.toContain("The menu bar language could not be changed");
  });

  it("offers no theme control outside Settings", async () => {
    mocks.appState = createAppState();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    const labels = Array.from(document.querySelectorAll(".appStatusBar button"))
      .map((button) => `${button.textContent} ${button.getAttribute("title") ?? ""}`);
    expect(labels.some((label) => /theme|light|dark/i.test(label))).toBe(false);
  });

  it("keeps theme and zoom failures independent through dismissal and matching retries", async () => {
    const state = createAppState();
    mocks.appState = state;
    mocks.applyWindowTheme.mockRejectedValueOnce(new Error("theme unavailable"));
    mocks.setZoom.mockRejectedValueOnce(new Error("zoom unavailable"));

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    const alertText = () => Array.from(document.querySelectorAll('[role="alert"]'))
      .map((alert) => alert.textContent ?? "");
    expect(alertText()).toEqual(expect.arrayContaining([
      expect.stringContaining("The theme could not be applied"),
      expect.stringContaining("Zoom could not be applied"),
    ]));

    const themeAlert = Array.from(document.querySelectorAll('[role="alert"]')).find(
      (alert) => alert.textContent?.includes("The theme could not be applied"),
    );
    const themeDismiss = themeAlert?.querySelector("button");
    if (!(themeDismiss instanceof HTMLButtonElement)) throw new Error("Missing theme dismiss button");
    await act(async () => themeDismiss.click());
    expect(alertText().some((text) => text.includes("The theme could not"))).toBe(false);
    expect(alertText().some((text) => text.includes("Zoom could not"))).toBe(true);

    mocks.applyWindowTheme.mockRejectedValueOnce(new Error("theme still unavailable"));
    mocks.setZoom.mockResolvedValueOnce();
    mocks.appState = {
      ...state,
      settings: { ...state.settings, theme: "dark" },
      zoomLevel: 1.1,
    };
    await act(async () => root?.render(<App />));
    await flushEffects();

    expect(alertText().some((text) => text.includes("The theme could not"))).toBe(true);
    expect(alertText().some((text) => text.includes("Zoom could not"))).toBe(false);

    mocks.applyWindowTheme.mockResolvedValueOnce();
    mocks.appState = {
      ...mocks.appState,
      settings: { ...state.settings, theme: "light" },
    };
    await act(async () => root?.render(<App />));
    await flushEffects();

    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("retains always-on-top failure until dismissal or a matching setting succeeds", async () => {
    const state = createAppState();
    mocks.appState = state;
    mocks.applyWindowTheme.mockResolvedValue();
    mocks.setZoom.mockResolvedValue();
    mocks.applyTopmost.mockRejectedValueOnce(new Error("EACCES /private/tmp/TOPMOST"));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    expect(document.body.textContent).toContain("Always on top could not be updated");
    expect(document.body.textContent).not.toContain("/private/tmp");

    mocks.applyTopmost.mockResolvedValueOnce();
    mocks.appState = { ...state, settings: { ...state.settings, topmost: true } };
    await act(async () => root?.render(<App />));
    await flushEffects();
    expect(document.body.textContent).not.toContain("Always on top could not be updated");
  });
});

// The native About item opens the main window's own About dialog, which stays
// above a main window kept on top (window conventions).
describe("native About item", () => {
  it("opens the in-window About dialog", async () => {
    mocks.appState = { ...createAppState(), showToast: vi.fn() };
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    await act(async () => mocks.aboutRequested?.());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("QuickDeck");
    expect(document.querySelector(".modalHeader-bare")).not.toBeNull();
  });
});

describe("App menu zoom row", () => {
  it("leads with an icon and its label like the items, and is not an item itself", async () => {
    mocks.appState = { ...createAppState(), showToast: vi.fn() };
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();
    await act(async () => document.querySelector<HTMLButtonElement>(".statusMenuButton")!.click());

    const row = document.querySelector<HTMLElement>(".menuZoomRow")!;
    const [icon, label, controls] = Array.from(row.children);
    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.getAttribute("width")).toBe("16");
    expect(label.textContent).toBe("Zoom");
    expect(controls.className).toBe("menuZoomControls");
    expect(row.closest('[role="menuitem"]')).toBeNull();
    expect(row.querySelector('[role="menuitem"]')).toBeNull();
  });
});

describe("App Records menu item", () => {
  async function chooseRecords() {
    await act(async () => document.querySelector<HTMLButtonElement>(".statusMenuButton")!.click());
    const item = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
      (button) => button.textContent === "Records",
    );
    expect(item).toBeDefined();
    await act(async () => item!.click());
    await flushEffects();
  }

  it("opens the Records window from the app menu", async () => {
    const state = { ...createAppState(), showToast: vi.fn() };
    mocks.appState = state;
    mocks.openRecordsWindow.mockReset();
    mocks.openRecordsWindow.mockResolvedValue();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    await chooseRecords();

    expect(mocks.openRecordsWindow).toHaveBeenCalledOnce();
    expect(state.showToast).not.toHaveBeenCalled();
  });

  it("says so when the Records window cannot be opened", async () => {
    const state = { ...createAppState(), showToast: vi.fn() };
    mocks.appState = state;
    mocks.openRecordsWindow.mockReset();
    mocks.openRecordsWindow.mockRejectedValue(new Error("no window"));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    await chooseRecords();

    expect(state.showToast).toHaveBeenCalledWith("records-window", "error", { key: "toast.recordsFailed" });
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("clears the failure once a later open succeeds", async () => {
    const state = { ...createAppState(), showToast: vi.fn(), clearToast: vi.fn() };
    mocks.appState = state;
    mocks.openRecordsWindow.mockReset();
    mocks.openRecordsWindow.mockRejectedValueOnce(new Error("no window")).mockResolvedValueOnce();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    await chooseRecords();
    expect(state.showToast).toHaveBeenCalledWith("records-window", "error", { key: "toast.recordsFailed" });
    expect(state.clearToast).not.toHaveBeenCalled();

    await chooseRecords();
    expect(state.clearToast).toHaveBeenCalledExactlyOnceWith("records-window");
    expect(state.showToast).toHaveBeenCalledOnce();
  });
});
