// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appState: {} as Record<string, unknown>,
  setTheme: vi.fn<(theme: "dark" | "light") => Promise<void>>(),
  setZoom: vi.fn<(zoom: number) => Promise<void>>(),
  setAlwaysOnTop: vi.fn(() => Promise.resolve()),
  setMinSize: vi.fn(() => Promise.resolve()),
  currentMonitor: vi.fn(() => Promise.resolve(null)),
  logWarn: vi.fn(),
}));

vi.mock("../src/state/AppStateContext", () => ({
  useAppState: () => mocks.appState,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: mocks.currentMonitor,
  getCurrentWindow: () => ({
    setTheme: mocks.setTheme,
    setAlwaysOnTop: mocks.setAlwaysOnTop,
    setMinSize: mocks.setMinSize,
    onMoved: () => Promise.resolve(() => undefined),
    onScaleChanged: () => Promise.resolve(() => undefined),
    onCloseRequested: () => Promise.resolve(() => undefined),
    destroy: () => Promise.resolve(),
  }),
  LogicalSize: class LogicalSize {
    constructor(public width: number, public height: number) {}
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: mocks.setZoom }),
}));
vi.mock("../src/services/logger", () => ({
  logError: vi.fn(),
  logWarn: mocks.logWarn,
  serializeError: (error: unknown) => ({ value: String(error) }),
}));

import { App } from "../src/App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
  mocks.setTheme.mockReset();
  mocks.setZoom.mockReset();
  mocks.setAlwaysOnTop.mockReset();
  mocks.setAlwaysOnTop.mockResolvedValue();
  mocks.logWarn.mockReset();
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
    settings: {
      dark: false,
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
      snapshotSearchPageSize: 20,
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
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("App window-chrome results", () => {
  it("keeps theme and zoom failures independent through dismissal and matching retries", async () => {
    const state = createAppState();
    mocks.appState = state;
    mocks.setTheme.mockRejectedValueOnce(new Error("theme unavailable"));
    mocks.setZoom.mockRejectedValueOnce(new Error("zoom unavailable"));

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    const alertText = () => Array.from(document.querySelectorAll('[role="alert"]'))
      .map((alert) => alert.textContent ?? "");
    expect(alertText()).toEqual(expect.arrayContaining([
      expect.stringContaining("Window theme could not be applied"),
      expect.stringContaining("Zoom could not be applied"),
    ]));

    const themeAlert = Array.from(document.querySelectorAll('[role="alert"]')).find(
      (alert) => alert.textContent?.includes("Window theme could not be applied"),
    );
    const themeDismiss = themeAlert?.querySelector("button");
    if (!(themeDismiss instanceof HTMLButtonElement)) throw new Error("Missing theme dismiss button");
    await act(async () => themeDismiss.click());
    expect(alertText().some((text) => text.includes("Window theme"))).toBe(false);
    expect(alertText().some((text) => text.includes("Zoom could not"))).toBe(true);

    mocks.setTheme.mockRejectedValueOnce(new Error("theme still unavailable"));
    mocks.setZoom.mockResolvedValueOnce();
    mocks.appState = {
      ...state,
      settings: { ...state.settings, dark: true },
      zoomLevel: 1.1,
    };
    await act(async () => root?.render(<App />));
    await flushEffects();

    expect(alertText().some((text) => text.includes("Window theme could not"))).toBe(true);
    expect(alertText().some((text) => text.includes("Zoom could not"))).toBe(false);

    mocks.setTheme.mockResolvedValueOnce();
    mocks.appState = {
      ...mocks.appState,
      settings: { ...state.settings, dark: false },
    };
    await act(async () => root?.render(<App />));
    await flushEffects();

    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("retains always-on-top failure until dismissal or a matching setting succeeds", async () => {
    const state = createAppState();
    mocks.appState = state;
    mocks.setTheme.mockResolvedValue();
    mocks.setZoom.mockResolvedValue();
    mocks.setAlwaysOnTop.mockRejectedValueOnce(new Error("EACCES /private/tmp/TOPMOST"));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<App />));
    await flushEffects();

    expect(document.body.textContent).toContain("Always on top could not be updated");
    expect(document.body.textContent).not.toContain("/private/tmp");

    mocks.setAlwaysOnTop.mockResolvedValueOnce();
    mocks.appState = { ...state, settings: { ...state.settings, topmost: true } };
    await act(async () => root?.render(<App />));
    await flushEffects();
    expect(document.body.textContent).not.toContain("Always on top could not be updated");
  });
});
