// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordsWindowSetup } from "../../src/services/records";

const mocks = vi.hoisted(() => ({
  setup: vi.fn<() => Promise<RecordsWindowSetup>>(),
  presentationChanged: null as ((value: RecordsWindowSetup) => void) | null,
  registration: vi.fn<() => Promise<() => void>>(),
  width: vi.fn<() => Promise<number | null>>(),
  page: vi.fn(() => Promise.resolve({ records: [], more: false })),
  saveWidth: vi.fn(() => Promise.resolve()),
  setMinSize: vi.fn(() => Promise.resolve()),
  logWarn: vi.fn(),
  // Catalogues whose load waits until the test releases it.
  held: new Map<string, Promise<void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setMinSize: mocks.setMinSize }),
  LogicalSize: class LogicalSize {
    constructor(public width: number, public height: number) {}
  },
}));
vi.mock("../../src/services/records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/records")>()),
  recordsWindowSetup: mocks.setup,
  onPresentationChanged: (listener: (value: RecordsWindowSetup) => void) => {
    mocks.presentationChanged = listener;
    return mocks.registration();
  },
  recordsListWidth: mocks.width,
  sendRecordsListWidth: mocks.saveWidth,
  onRecordsChanged: () => () => undefined,
  readRecordsPage: mocks.page,
  readRecordSources: () => Promise.resolve({ currentSession: "s", sessions: [] }),
  readRecordDetail: () => Promise.resolve(null),
}));
vi.mock("../../src/i18n/catalogues", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/i18n/catalogues")>();
  return {
    ...original,
    loadCatalogue: async (language: Parameters<typeof original.loadCatalogue>[0]) => {
      await mocks.held.get(language);
      await original.loadCatalogue(language);
    },
  };
});
vi.mock("../../src/services/logger", () => ({
  logWarn: mocks.logWarn,
  serializeError: (error: unknown) => ({ value: String(error) }),
}));

import { RecordsApp } from "../../src/records/RecordsApp";
import { RECORDS_LIST_WIDTH, RECORDS_WINDOW_MIN_HEIGHT, RECORDS_WINDOW_MIN_WIDTH } from "../../src/records/recordsLayout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  // jsdom lays nothing out; the shell is given a wide window's width.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("recordsShell") ? 2000 : 0;
    },
  });
  mocks.setup.mockReset();
  mocks.page.mockClear();
  mocks.setMinSize.mockClear();
  mocks.logWarn.mockReset();
  mocks.presentationChanged = null;
  mocks.registration.mockReset().mockResolvedValue(() => { mocks.presentationChanged = null; });
  mocks.width.mockReset().mockResolvedValue(500);
  mocks.held.clear();
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<RecordsApp />));
}

// A catalogue arrives through a dynamic import, whose first transform can take
// over a second while the whole suite runs, so the page is let run until the
// text appears, within the test's own time limit.
async function settleUntilText(text: string) {
  await vi.waitFor(
    async () => {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(document.body.textContent).toContain(text);
    },
    { timeout: 4000 },
  );
}

const listWidth = () =>
  document.querySelector<HTMLElement>(".recordsShell")?.style.getPropertyValue("--records-list-width");

describe("RecordsApp", () => {
  it("shows no text until the required language is known", async () => {
    let resolve!: (setup: RecordsWindowSetup) => void;
    mocks.setup.mockReturnValue(new Promise((res) => (resolve = res)));
    await mount();
    expect(document.body.textContent).toBe("");

    await act(async () => resolve({ language: "ja", systemLocale: "ja-JP", displayZone: "system", revision: 0, uiFontFamily: "" }));
    await settleUntilText("すべての起動");
    expect(listWidth()).toBe("500px");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("sets the window minimum derived from its panes", async () => {
    mocks.setup.mockResolvedValue({ language: "en", systemLocale: null, displayZone: "system", revision: 0, uiFontFamily: "" });
    await mount();
    expect(mocks.setMinSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: RECORDS_WINDOW_MIN_WIDTH, height: RECORDS_WINDOW_MIN_HEIGHT }),
    );
    expect(listWidth()).toBe("500px");
  });

  it("follows a language saved in the main window", async () => {
    mocks.setup.mockResolvedValue({ language: "en", systemLocale: null, displayZone: "system", revision: 0, uiFontFamily: "" });
    await mount();
    expect(document.body.textContent).toContain("All launches");

    await act(async () => mocks.presentationChanged!({ revision: 2, language: "de", systemLocale: null, displayZone: "system", uiFontFamily: "" }));
    await settleUntilText("Alle Starts");
  });

  it("opens in English at the default width when its setup cannot be read", async () => {
    mocks.setup.mockRejectedValue(new Error("no state"));
    mocks.width.mockResolvedValue(null);
    await mount();
    expect(document.body.textContent).toContain("All launches");
    expect(listWidth()).toBe(`${RECORDS_LIST_WIDTH.default}px`);
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  // Holds a language's catalogue load until the returned release is called.
  function hold(language: string): () => void {
    let release!: () => void;
    mocks.held.set(language, new Promise((resolve) => (release = resolve)));
    return release;
  }

  it("shows the latest language when an earlier one's catalogue loads last", async () => {
    mocks.setup.mockResolvedValue({ language: "en", systemLocale: null, displayZone: "system", revision: 0, uiFontFamily: "" });
    await mount();
    const releaseJapanese = hold("ja");
    await act(async () => mocks.presentationChanged!({ revision: 1, language: "ja", systemLocale: null, displayZone: "system", uiFontFamily: "" }));
    await act(async () => mocks.presentationChanged!({ revision: 2, language: "de", systemLocale: null, displayZone: "system", uiFontFamily: "" }));
    await act(async () => releaseJapanese());
    await settleUntilText("Alle Starts");
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.documentElement.lang).toBe("de");
  });

  it("keeps a language change that arrives while its setup is still loading", async () => {
    let resolve!: (setup: RecordsWindowSetup) => void;
    mocks.setup.mockReturnValue(new Promise((res) => (resolve = res)));
    await mount();
    await act(async () => mocks.presentationChanged!({ revision: 2, language: "de", systemLocale: null, displayZone: "system", uiFontFamily: "" }));
    await act(async () => resolve({ language: "ja", systemLocale: "ja-JP", displayZone: "system", revision: 0, uiFontFamily: "" }));
    await settleUntilText("Alle Starts");
    expect(document.documentElement.lang).toBe("de");
    expect(listWidth()).toBe("500px");
  });

  it("applies nothing after the window closes", async () => {
    let resolve!: (setup: RecordsWindowSetup) => void;
    mocks.setup.mockReturnValue(new Promise((res) => (resolve = res)));
    await mount();
    await act(async () => root?.unmount());
    root = null;
    await act(async () => resolve({ language: "ja", systemLocale: "ja-JP", displayZone: "system", revision: 0, uiFontFamily: "" }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.body.textContent).toBe("");
    expect(mocks.presentationChanged).toBeNull();
  });
  it("waits for listener registration before fetching the snapshot", async () => {
    let ready!: (stop: () => void) => void;
    mocks.registration.mockReturnValue(new Promise((resolve) => { ready = resolve; }));
    mocks.setup.mockResolvedValue({ revision: 3, language: "ja", systemLocale: "ja-JP", displayZone: "system", uiFontFamily: "" });
    await mount();
    expect(mocks.setup).not.toHaveBeenCalled();
    await act(async () => ready(() => undefined));
    await settleUntilText("すべての起動");
    expect(mocks.setup).toHaveBeenCalledOnce();
  });

  it("removes a listener whose registration finishes after disposal", async () => {
    let ready!: (stop: () => void) => void;
    const stop = vi.fn();
    mocks.registration.mockReturnValue(new Promise((resolve) => { ready = resolve; }));
    await mount();
    await act(async () => root?.unmount());
    root = null;
    await act(async () => ready(stop));
    expect(stop).toHaveBeenCalledOnce();
    expect(mocks.setup).not.toHaveBeenCalled();
  });

  it("renders the required language while optional width remains unresolved", async () => {
    mocks.width.mockReturnValue(new Promise(() => undefined));
    mocks.setup.mockResolvedValue({ revision: 0, language: "ja", systemLocale: "ja-JP", displayZone: "system", uiFontFamily: "" });
    await mount();
    await settleUntilText("すべての起動");
    expect(listWidth()).toBe(`${RECORDS_LIST_WIDTH.default}px`);
  });

  it("applies initial and live UI fonts and removes a blank override", async () => {
    mocks.setup.mockResolvedValue({ revision: 0, language: "en", systemLocale: null, displayZone: "system", uiFontFamily: "  Example Font  " });
    await mount();
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe("Example Font");
    await act(async () => mocks.presentationChanged!({ revision: 1, language: "en", systemLocale: null, displayZone: "UTC", uiFontFamily: "Other Font" }));
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe("Other Font");
    await act(async () => mocks.presentationChanged!({ revision: 2, language: "en", systemLocale: null, displayZone: "UTC", uiFontFamily: "  " }));
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe("");
    expect(mocks.page).toHaveBeenCalledOnce();
  });

  it.each([false, true])("ignores optional width after resizing starts (committed: %s)", async (committed) => {
    let width!: (value: number) => void;
    mocks.width.mockReturnValue(new Promise((resolve) => { width = resolve; }));
    mocks.setup.mockResolvedValue({ revision: 0, language: "en", systemLocale: null, displayZone: "system", uiFontFamily: "" });
    await mount();
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!;
    await act(async () => {
      splitter.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 20 }));
    });
    if (committed) await act(async () => window.dispatchEvent(new MouseEvent("pointerup")));
    await act(async () => width(650));
    expect(listWidth()).toBe(`${RECORDS_LIST_WIDTH.default + 20}px`);
    await act(async () => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(listWidth()).toBe(`${RECORDS_LIST_WIDTH.default + 20}px`);
  });

  it("keeps newer presentation when an initial catalogue completes last", async () => {
    const releaseJapanese = hold("ja");
    mocks.setup.mockResolvedValue({ revision: 0, language: "ja", systemLocale: "ja-JP", displayZone: "system", uiFontFamily: "Old Font" });
    await mount();
    await act(async () => mocks.presentationChanged!({ revision: 1, language: "de", systemLocale: "de-DE", displayZone: "UTC", uiFontFamily: "New Font" }));
    await settleUntilText("Alle Starts");
    await act(async () => releaseJapanese());
    expect(document.documentElement.lang).toBe("de");
    expect(document.documentElement.style.getPropertyValue("--font-ui")).toBe("New Font");
  });

  it("still reads presentation when listener registration fails", async () => {
    mocks.registration.mockRejectedValue(new Error("no listener"));
    mocks.setup.mockResolvedValue({ revision: 0, language: "ja", systemLocale: "ja-JP", displayZone: "system", uiFontFamily: "" });
    await mount();
    await settleUntilText("すべての起動");
    expect(document.body.textContent).not.toContain("no listener");
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("accepts a native revision zero event after the setup fallback", async () => {
    mocks.setup.mockRejectedValue(new Error("no state"));
    await mount();
    expect(document.body.textContent).toContain("All launches");
    await act(async () => mocks.presentationChanged!({ revision: 0, language: "ja", systemLocale: "ja-JP", displayZone: "system", uiFontFamily: "" }));
    await settleUntilText("すべての起動");
  });

});

