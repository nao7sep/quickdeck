// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordsWindowSetup } from "../../src/services/records";

const mocks = vi.hoisted(() => ({
  setup: vi.fn<() => Promise<RecordsWindowSetup>>(),
  languageChanged: null as ((language: string) => void) | null,
  setMinSize: vi.fn(() => Promise.resolve()),
  logWarn: vi.fn(),
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
  onLanguageChanged: (listener: (language: string) => void) => {
    mocks.languageChanged = listener;
    return () => {
      mocks.languageChanged = null;
    };
  },
  onRecordsChanged: () => () => undefined,
  readRecordsPage: () => Promise.resolve({ records: [], more: false }),
  readRecordSources: () => Promise.resolve({ currentSession: "s", sessions: [] }),
  readRecordDetail: () => Promise.resolve(null),
}));
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
  mocks.setMinSize.mockClear();
  mocks.logWarn.mockReset();
  mocks.languageChanged = null;
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
  it("shows no text until the language and the list width are known", async () => {
    let resolve!: (setup: RecordsWindowSetup) => void;
    mocks.setup.mockReturnValue(new Promise((res) => (resolve = res)));
    await mount();
    expect(document.body.textContent).toBe("");

    await act(async () => resolve({ language: "ja", systemLocale: "ja-JP", listWidth: 500 }));
    await settleUntilText("すべての起動");
    expect(listWidth()).toBe("500px");
    expect(document.documentElement.lang).toBe("ja");
  });

  it("sets the window minimum derived from its panes", async () => {
    mocks.setup.mockResolvedValue({ language: "en", systemLocale: null, listWidth: null });
    await mount();
    expect(mocks.setMinSize).toHaveBeenCalledWith(
      expect.objectContaining({ width: RECORDS_WINDOW_MIN_WIDTH, height: RECORDS_WINDOW_MIN_HEIGHT }),
    );
    expect(listWidth()).toBe(`${RECORDS_LIST_WIDTH.default}px`);
  });

  it("follows a language saved in the main window", async () => {
    mocks.setup.mockResolvedValue({ language: "en", systemLocale: null, listWidth: null });
    await mount();
    expect(document.body.textContent).toContain("All launches");

    await act(async () => mocks.languageChanged!("de"));
    await settleUntilText("Alle Starts");
  });

  it("opens in English at the default width when its setup cannot be read", async () => {
    mocks.setup.mockRejectedValue(new Error("no state"));
    await mount();
    expect(document.body.textContent).toContain("All launches");
    expect(listWidth()).toBe(`${RECORDS_LIST_WIDTH.default}px`);
    expect(mocks.logWarn).toHaveBeenCalled();
  });
});
