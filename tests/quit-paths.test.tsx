// @vitest-environment jsdom
// The window's close, which the menu's Quit, Cmd+Q, the Dock's Quit and closing
// the last window all reach, and the save an OS logout, restart or shutdown asks
// for (unsaved-edits conventions, Quitting).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CloseHandler = (event: { preventDefault: () => void }) => Promise<void>;

const mocks = vi.hoisted(() => ({
  appState: {} as Record<string, unknown>,
  closeHandler: null as CloseHandler | null,
  sessionEnding: null as ((event: { payload: number }) => void) | null,
  invoke: vi.fn((_command: string) => Promise.resolve()),
  destroy: vi.fn(() => Promise.resolve()),
  logError: vi.fn(),
  logWarn: vi.fn(),
  minimized: false,
}));

vi.mock("../src/state/AppStateContext", () => ({
  useAppState: () => mocks.appState,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: (event: { payload: number }) => void) => {
    if (event === "session-ending") mocks.sessionEnding = handler;
    return Promise.resolve(() => undefined);
  },
}));
vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: () => Promise.resolve(null),
  getCurrentWindow: () => ({
    setMinSize: () => Promise.resolve(),
    isMaximized: () => Promise.resolve(false),
    isFullscreen: () => Promise.resolve(false),
    isMinimized: () => Promise.resolve(mocks.minimized),
    isVisible: () => Promise.resolve(true),
    onMoved: () => Promise.resolve(() => undefined),
    onScaleChanged: () => Promise.resolve(() => undefined),
    onCloseRequested: (handler: CloseHandler) => {
      mocks.closeHandler = handler;
      return Promise.resolve(() => undefined);
    },
    destroy: mocks.destroy,
  }),
  LogicalSize: class LogicalSize {
    constructor(public width: number, public height: number) {}
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: () => Promise.resolve() }),
}));
vi.mock("../src/services/windowTopmost", () => ({ applyTopmost: () => Promise.resolve() }));
vi.mock("../src/services/windowTheme", () => ({
  applyWindowTheme: () => Promise.resolve(),
}));
vi.mock("../src/services/persistence", () => ({
  applyLanguage: () => Promise.resolve(),
  applyDisplayPreferences: () => Promise.resolve(),
  saveFailureMessage: (error: any) => error?.newer ? { key: "saveError.panesNewer", values: { path: error.path, version: error.newer } } : null,
}));
vi.mock("../src/services/records", () => ({
  openRecordsWindow: () => Promise.resolve(),
}));
vi.mock("../src/services/logger", () => ({
  logError: mocks.logError,
  logWarn: mocks.logWarn,
  serializeError: (error: unknown) => ({ value: String(error) }),
}));

import { App } from "../src/App";
import { QUIT_SAVE_BOUND_MS, QUIT_SNAPSHOT_BOUND_MS } from "../src/services/quit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  mocks.closeHandler = null;
  mocks.sessionEnding = null;
  mocks.minimized = false;
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue();
  mocks.destroy.mockReset();
  mocks.destroy.mockResolvedValue();
  mocks.logError.mockReset();
  mocks.logWarn.mockReset();
});

function createAppState(overrides: Record<string, unknown> = {}) {
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
      snapshotSearchPageSize: 20,
    },
    zoomLevel: 1,
    setZoomLevel: noop,
    setActivePaneId: noop,
    addPane: noop,
    movePane: noop,
    saveNow: vi.fn(() => Promise.resolve(true)),
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
    ...overrides,
  };
}

async function renderApp(state: Record<string, unknown>) {
  mocks.appState = state;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<App />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

// Starts a close the way Tauri does and returns its completion.
async function requestClose(): Promise<{ done: Promise<void>; preventDefault: ReturnType<typeof vi.fn> }> {
  const preventDefault = vi.fn();
  let done!: Promise<void>;
  await act(async () => {
    done = mocks.closeHandler!({ preventDefault });
    await vi.advanceTimersByTimeAsync(0);
  });
  return { done, preventDefault };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(dialog()?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) throw new Error(`no ${label} button`);
  return found as HTMLButtonElement;
}

async function click(label: string) {
  await act(async () => {
    button(label).click();
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("closing the window", () => {
  it("snapshots and saves, then closes", async () => {
    const state = createAppState();
    await renderApp(state);

    const { done, preventDefault } = await requestClose();
    await done;

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(state.snapshotAllPanes).toHaveBeenCalledWith("app_close");
    expect(state.saveNow).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it("closes after a failed snapshot, which is only logged", async () => {
    const state = createAppState({
      snapshotAllPanes: vi.fn(() => Promise.reject(new Error("snapshot store busy"))),
    });
    await renderApp(state);

    const { done } = await requestClose();
    await done;

    expect(mocks.logWarn).toHaveBeenCalledWith("close snapshot failed", expect.anything());
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it("closes once a stalled snapshot passes its bound", async () => {
    const state = createAppState({ snapshotAllPanes: vi.fn(() => new Promise(() => undefined)) });
    await renderApp(state);

    const { done } = await requestClose();
    expect(state.saveNow).toHaveBeenCalledOnce();
    await advance(QUIT_SNAPSHOT_BOUND_MS);
    await done;

    expect(state.saveNow).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("cancels the close when the save fails and offers Cancel, Retry and Quit anyway", async () => {
    const state = createAppState({ saveNow: vi.fn(() => Promise.reject(new Error("read-only"))) });
    await renderApp(state);

    await requestClose();

    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("QuickDeck couldn't save your data");
    const labels = Array.from(dialog()!.querySelectorAll("footer button")).map((b) => b.textContent);
    expect(labels).toEqual(["Cancel", "Retry", "Quit anyway"]);
    // The safe choice takes focus, never the one that loses work.
    expect(document.activeElement).toBe(button("Retry"));
    expect(mocks.logError).toHaveBeenCalledWith("save on close failed", expect.anything());
  });

  // window-conventions: a question never attaches to a hidden window or brings
  // it back; it stands alone instead.
  describe("while the window is minimized", () => {
    function standaloneAnswers(answer: () => Promise<unknown>) {
      mocks.minimized = true;
      mocks.invoke.mockImplementation(((command: string) =>
        command === "ask_quit_save_failure_standalone" ? answer() : Promise.resolve()) as never);
    }

    it("asks in a standalone dialog, never in the window, and quits on Quit anyway", async () => {
      standaloneAnswers(() => Promise.resolve("quitAnyway"));
      const state = createAppState({ saveNow: vi.fn(() => Promise.reject(new Error("read-only"))) });
      await renderApp(state);

      const { done } = await requestClose();
      await act(async () => done);

      expect(dialog()).toBeNull();
      expect(mocks.invoke).toHaveBeenCalledWith("ask_quit_save_failure_standalone", {
        question: expect.objectContaining({ retry: "Retry", quitAnyway: "Quit anyway", cancel: "Cancel" }),
      });
      expect(mocks.destroy).toHaveBeenCalledTimes(1);
    });

    it("stays open when the standalone dialog is cancelled or cannot be shown", async () => {
      for (const answer of [() => Promise.resolve("cancel"), () => Promise.reject(new Error("no dialog"))]) {
        standaloneAnswers(answer);
        const state = createAppState({ saveNow: vi.fn(() => Promise.reject(new Error("read-only"))) });
        await renderApp(state);

        const { done } = await requestClose();
        await act(async () => done);

        expect(dialog()).toBeNull();
        expect(mocks.destroy).not.toHaveBeenCalled();
        await act(async () => root?.unmount());
        root = null;
      }
    });
  });

  it("treats a save stalled past its bound as failed", async () => {
    const state = createAppState({ saveNow: vi.fn(() => new Promise(() => undefined)) });
    await renderApp(state);

    await requestClose();
    await advance(QUIT_SAVE_BOUND_MS - 1);
    expect(dialog()).toBeNull();
    await advance(1);

    expect(dialog()?.textContent).toContain("QuickDeck couldn't save your data");
    expect(mocks.logError).toHaveBeenCalledWith("save on close wait expired", {
      ms: QUIT_SAVE_BOUND_MS,
    });
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("keeps the window open when only an older input version was saved", async () => {
    const state = createAppState({ saveNow: vi.fn(() => Promise.resolve(false)) });
    await renderApp(state);
    const { done } = await requestClose();
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("latest changes are still open");
    await click("Cancel");
    await done;
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("names a newer panes refusal while retaining quit recovery choices", async () => {
    const state = createAppState({ saveNow: vi.fn(() => Promise.reject({ path: "/actual/panes.json", newer: 2, message: "HOSTILE" })) });
    await renderApp(state);
    const { done } = await requestClose();
    expect(dialog()?.textContent).toContain("/actual/panes.json");
    expect(dialog()?.textContent).toContain("newer format (format 2)");
    expect(dialog()?.textContent).not.toContain("Free some storage");
    expect(dialog()?.textContent).not.toContain("HOSTILE");
    await click("Cancel");
    await done;
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("closes when Retry saves", async () => {
    const saveNow = vi.fn()
      .mockRejectedValueOnce(new Error("read-only"))
      .mockResolvedValueOnce(true);
    const state = createAppState({ saveNow });
    await renderApp(state);

    const { done } = await requestClose();
    await click("Retry");
    await done;

    expect(saveNow).toHaveBeenCalledTimes(2);
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(dialog()).toBeNull();
  });

  it("asks again when Retry fails again", async () => {
    const state = createAppState({ saveNow: vi.fn(() => Promise.reject(new Error("read-only"))) });
    await renderApp(state);

    await requestClose();
    await click("Retry");

    expect(state.saveNow).toHaveBeenCalledTimes(2);
    expect(dialog()?.textContent).toContain("QuickDeck couldn't save your data");
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("closes without the save on Quit anyway, and logs it", async () => {
    const state = createAppState({ saveNow: vi.fn(() => Promise.reject(new Error("read-only"))) });
    await renderApp(state);

    const { done } = await requestClose();
    await click("Quit anyway");
    await done;

    expect(state.saveNow).toHaveBeenCalledOnce();
    expect(mocks.logWarn).toHaveBeenCalledWith("quit without saving", {});
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("stays open on Cancel, and a later close asks again", async () => {
    const state = createAppState({ saveNow: vi.fn(() => Promise.reject(new Error("read-only"))) });
    await renderApp(state);

    const first = await requestClose();
    await click("Cancel");
    await first.done;

    expect(dialog()).toBeNull();
    expect(mocks.destroy).not.toHaveBeenCalled();

    await requestClose();
    expect(state.saveNow).toHaveBeenCalledTimes(2);
    expect(dialog()?.textContent).toContain("QuickDeck couldn't save your data");
  });

  it("ignores a second close while the first is still asking", async () => {
    const state = createAppState({ saveNow: vi.fn(() => Promise.reject(new Error("read-only"))) });
    await renderApp(state);

    await requestClose();
    const second = await requestClose();
    await second.done;

    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(state.saveNow).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});

describe("an OS logout, restart or shutdown", () => {
  async function endSession(attempt = 1) {
    await act(async () => {
      mocks.sessionEnding!({ payload: attempt });
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("snapshots and saves, then reports, without closing the window itself", async () => {
    const state = createAppState();
    await renderApp(state);

    await endSession();

    expect(state.snapshotAllPanes).toHaveBeenCalledWith("app_close");
    expect(state.saveNow).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("session_end_saved", { attempt: 1 });
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("never prompts when the save fails: it logs and reports", async () => {
    const state = createAppState({ saveNow: vi.fn(() => Promise.reject(new Error("read-only"))) });
    await renderApp(state);

    await endSession();

    expect(dialog()).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith("save on close failed", expect.anything());
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("session_end_saved", { attempt: 1 });
  });

  it("reports once a stalled snapshot and save pass their bounds", async () => {
    const stalled = vi.fn(() => new Promise<void>(() => undefined));
    const state = createAppState({ snapshotAllPanes: stalled, saveNow: stalled });
    await renderApp(state);

    await endSession();
    await advance(Math.max(QUIT_SNAPSHOT_BOUND_MS, QUIT_SAVE_BOUND_MS) - 1);
    expect(mocks.invoke).not.toHaveBeenCalled();
    await advance(1);

    expect(dialog()).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("session_end_saved", { attempt: 1 });
  });

  it.each([true, false])("joins a user save already in flight without a second save or a prompt (saved: %s)", async (saved) => {
    let settle!: () => void;
    const saveNow = vi.fn(() => new Promise<boolean>((resolve) => { settle = () => resolve(saved); }));
    await renderApp(createAppState({ saveNow }));
    const closing = await requestClose();
    try {
      await endSession();
      await endSession();
      expect(saveNow).toHaveBeenCalledOnce();
      expect(mocks.invoke).not.toHaveBeenCalled();
    } finally { await act(async () => { settle(); await closing.done; await vi.advanceTimersByTimeAsync(0); }); }
    expect(dialog()).toBeNull();
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("session_end_saved", { attempt: 1 });
  });

  it.each([true, false])("captures anew while a cancelled attempt is late without prompting (saved: %s)", async (saved) => {
    let settleOld!: () => void;
    const saveNow = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { settleOld = () => resolve(saved); }))
      .mockResolvedValueOnce(true);
    await renderApp(createAppState({ saveNow }));
    await endSession(1);
    await endSession(2);
    expect(saveNow).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("session_end_saved", { attempt: 2 });
    await act(async () => { settleOld(); await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.invoke).toHaveBeenLastCalledWith("session_end_saved", { attempt: 1 });
    expect(dialog()).toBeNull();
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  it("takes over the existing quit question and retries without another prompt", async () => {
    const saveNow = vi.fn()
      .mockRejectedValueOnce(new Error("read-only"))
      .mockResolvedValueOnce(true);
    const state = createAppState({ saveNow });
    await renderApp(state);

    await requestClose();
    expect(dialog()).not.toBeNull();
    await endSession();

    expect(saveNow).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("session_end_saved", { attempt: 1 });
  });
});
