// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RecordDetail,
  RecordsPage,
  RecordsQuery,
  RecordSources,
  RecordSummary,
} from "../../src/services/records";

const mocks = vi.hoisted(() => ({
  readRecordsPage: vi.fn<(query: RecordsQuery) => Promise<RecordsPage>>(),
  readRecordDetail: vi.fn<(id: number) => Promise<RecordDetail | null>>(),
  readRecordSources: vi.fn<() => Promise<RecordSources>>(),
  saveRecordsListWidth: vi.fn<(width: number) => Promise<void>>(),
  logWarn: vi.fn(),
  recordsChanged: null as (() => void) | null,
}));

vi.mock("../../src/services/records", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/records")>()),
  readRecordsPage: mocks.readRecordsPage,
  readRecordDetail: mocks.readRecordDetail,
  readRecordSources: mocks.readRecordSources,
  saveRecordsListWidth: mocks.saveRecordsListWidth,
  onRecordsChanged: (listener: () => void) => {
    mocks.recordsChanged = listener;
    return () => {
      mocks.recordsChanged = null;
    };
  },
}));
vi.mock("../../src/services/logger", () => ({
  logWarn: mocks.logWarn,
  serializeError: (error: unknown) => ({ value: String(error) }),
}));

import { RecordsWindow } from "../../src/records/RecordsWindow";
import {
  RECORDS_DETAIL_MIN_WIDTH,
  RECORDS_GAP,
  RECORDS_LIST_WIDTH,
  RECORDS_PADDING,
} from "../../src/records/recordsLayout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = "2026-10-02T08:00:00.000Z";

const failure: RecordSummary = {
  id: 4, session: SESSION, time: "2026-10-02T08:01:00.000Z", level: "error", message: "boundary failed", op: "save_panes",
};
const warning: RecordSummary = {
  id: 9, session: SESSION, time: "2026-10-02T08:00:30.000Z", level: "warn", message: "set zoom failed", op: null,
};
const failureDetail: RecordDetail = {
  id: 4, session: SESSION, time: "2026-10-02T08:01:00.250Z", level: "error", message: "boundary failed",
  paneId: "pane-1", snapshotId: null, fields: JSON.stringify({ op: "save_panes", ms: 3, error: "disk full" }),
};
const newer: RecordSummary = {
  id: 12, session: SESSION, time: "2026-10-02T08:02:00.000Z", level: "info", message: "boundary ok", op: "save_state",
};

let root: Root | null = null;

// jsdom lays nothing out, so the list's scroll box and the shell's width are set
// here. By default the list is scrolled to the top and far from its end.
const box = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, shellWidth: 2000 };
const resizeCallbacks = new Set<() => void>();
class TestResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe(): void {
    resizeCallbacks.add(this.callback);
  }
  disconnect(): void {
    resizeCallbacks.delete(this.callback);
  }
}
const isScroll = (element: HTMLElement) => element.classList.contains("recordsListScroll");

beforeEach(() => {
  mocks.readRecordsPage.mockReset();
  mocks.readRecordsPage.mockResolvedValue({ records: [failure, warning], more: false });
  mocks.readRecordDetail.mockReset();
  mocks.readRecordDetail.mockResolvedValue(failureDetail);
  mocks.readRecordSources.mockReset();
  mocks.readRecordSources.mockResolvedValue({ currentSession: SESSION, sessions: [SESSION, "2026-10-01T08:00:00.000Z"] });
  mocks.saveRecordsListWidth.mockReset();
  mocks.saveRecordsListWidth.mockResolvedValue();
  mocks.logWarn.mockReset();
  mocks.recordsChanged = null;
  Object.assign(box, { scrollTop: 0, scrollHeight: 1000, clientHeight: 200, shellWidth: 2000 });
  resizeCallbacks.clear();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  Object.defineProperties(HTMLElement.prototype, {
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) {
        return isScroll(this) ? box.scrollTop : 0;
      },
      set(this: HTMLElement, value: number) {
        if (isScroll(this)) box.scrollTop = value;
      },
    },
    scrollHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isScroll(this) ? box.scrollHeight : 0;
      },
    },
    clientHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isScroll(this) ? box.clientHeight : 0;
      },
    },
    clientWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("recordsShell") ? box.shellWidth : 0;
      },
    },
  });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const name of ["scrollTop", "scrollHeight", "clientHeight", "clientWidth"]) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
});

async function mount(): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<RecordsWindow initialListWidth={RECORDS_LIST_WIDTH.default} />));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
const titles = () => options().map((option) => option.querySelector(".recordsRowTitle")?.textContent);
const lastQuery = (): RecordsQuery => mocks.readRecordsPage.mock.calls.at(-1)![0];
const scrollBox = () => document.querySelector<HTMLElement>(".recordsListScroll")!;
const scrollTo = async (top: number, events = 1) => {
  await act(async () => {
    box.scrollTop = top;
    for (let index = 0; index < events; index++) scrollBox().dispatchEvent(new Event("scroll"));
  });
};
const press = async (key: string) => {
  await act(async () => {
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
};
const signal = async () => {
  await act(async () => mocks.recordsChanged!());
};
const cursorOf = (record: RecordSummary) => ({ time: record.time, id: record.id });
const choose = async (select: HTMLSelectElement, value: string) => {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

describe("RecordsWindow", () => {
  it("lists the records newest first, with every filter off and nothing selected yet", async () => {
    await mount();

    expect(titles()).toEqual(["boundary failed", "set zoom failed"]);
    expect(options()[0]!.querySelector(".recordsRowText")?.textContent).toBe("save_panes");
    expect(lastQuery()).toEqual({ session: null, level: null, search: "", after: null });
    expect(document.body.textContent).toContain("Select a record to see everything it holds.");
    expect(options()[0]!.tabIndex).toBe(0);
    expect(options()[1]!.tabIndex).toBe(-1);
    expect(document.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe("Records");
  });

  it("shows every field a selected record holds", async () => {
    await mount();
    await act(async () => options()[0]!.click());

    expect(mocks.readRecordDetail).toHaveBeenCalledWith(4);
    expect(document.querySelector(".recordsDetailTitle")?.textContent).toBe("boundary failed");
    expect(document.querySelector(".recordsBlockText")?.textContent).toBe(
      JSON.stringify({ op: "save_panes", ms: 3, error: "disk full" }, null, 2),
    );
    const body = document.querySelector(".recordsDetailBody")!.textContent!;
    expect(body).toContain("pane-1");
    expect(body).toContain("(this launch)");
    expect(body).toContain("250");
    expect(body).not.toContain("Snapshot");
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("moves the selection with the arrow keys", async () => {
    await mount();
    await act(async () => options()[0]!.focus());
    await press("ArrowDown");

    expect(document.activeElement).toBe(options()[1]);
    expect(mocks.readRecordDetail).toHaveBeenLastCalledWith(9);
    await press("Home");
    expect(document.activeElement).toBe(options()[0]);
  });

  it("reads again with each filter, and searches once typing pauses", async () => {
    await mount();
    const selects = Array.from(document.querySelectorAll("select"));
    expect(Array.from(selects[0]!.options).map((option) => option.textContent)).toEqual([
      "All launches",
      expect.stringContaining("(this launch)"),
      expect.not.stringContaining("(this launch)"),
    ]);

    await choose(selects[0]!, SESSION);
    await choose(selects[1]!, "error");
    expect(lastQuery()).toEqual({ session: SESSION, level: "error", search: "", after: null });

    vi.useFakeTimers();
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(search, "disk");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(lastQuery().search).toBe("");
    await act(async () => vi.advanceTimersByTime(300));
    expect(lastQuery().search).toBe("disk");
  });

  it("waits for an IME composition to finish before it searches", async () => {
    await mount();
    vi.useFakeTimers();
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      search.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      setValue.call(search, "ろぐ");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(1000));
    expect(lastQuery().search).toBe("");

    await act(async () => {
      search.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(300));
    expect(lastQuery().search).toBe("ろぐ");
  });

  it("offers Needs attention first among the levels", async () => {
    await mount();
    const level = document.querySelectorAll("select")[1]!;
    expect(Array.from(level.options).map((option) => option.textContent)).toEqual([
      "All levels", "Needs attention", "Error", "Warning", "Info", "Debug",
    ]);
    expect(level.value).toBe("");
  });

  it("shows a loading note while the first page is read, then the rows", async () => {
    const first = deferred<RecordsPage>();
    mocks.readRecordsPage.mockReturnValueOnce(first.promise);
    await mount();

    expect(document.body.textContent).toContain("Loading records…");
    expect(document.body.textContent).not.toContain("No records match these filters.");
    expect(options()).toHaveLength(0);

    await act(async () => first.resolve({ records: [failure, warning], more: false }));
    expect(options()).toHaveLength(2);
    expect(document.body.textContent).not.toContain("Loading records…");
  });

  it("says when no record matches, and when one does again", async () => {
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [], more: false });
    await mount();
    expect(document.body.textContent).toContain("No records match these filters.");
    expect(options()).toHaveLength(0);

    await choose(document.querySelectorAll("select")[1]!, "attention");
    expect(options()).toHaveLength(2);
    expect(document.body.textContent).not.toContain("No records match these filters.");
  });

  it("has no Refresh or Show more button", async () => {
    await mount();
    expect(document.querySelectorAll("button")).toHaveLength(0);
  });

  it("reads the next page from the last row once the list is scrolled near its end", async () => {
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [failure], more: true });
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [warning], more: false });
    await mount();
    expect(mocks.readRecordsPage).toHaveBeenCalledOnce();

    await scrollTo(700);

    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(lastQuery().after).toEqual(cursorOf(failure));
    expect(titles()).toEqual(["boundary failed", "set zoom failed"]);
  });

  it("reads the next page when ArrowDown is pressed on the last row", async () => {
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [failure, warning], more: true });
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [], more: false });
    await mount();
    await act(async () => options()[1]!.focus());
    await press("ArrowDown");

    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(lastQuery().after).toEqual(cursorOf(warning));
    expect(document.activeElement).toBe(options()[1]);
  });

  it("makes one request for two scroll events together", async () => {
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [failure, warning], more: true });
    mocks.readRecordsPage.mockReturnValueOnce(new Promise<RecordsPage>(() => {}));
    await mount();

    await scrollTo(800, 2);

    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(options()).toHaveLength(2);
    expect(document.body.textContent).toContain("Loading records…");
  });

  it("reads the next page by itself while a page does not fill the list", async () => {
    box.scrollHeight = 150;
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [failure], more: true });
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [warning], more: false });
    await mount();

    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(titles()).toEqual(["boundary failed", "set zoom failed"]);
  });

  it("keeps a failed page's note at the end, and reads it again when the end is reached again", async () => {
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [failure], more: true });
    mocks.readRecordsPage.mockRejectedValueOnce(new Error("busy"));
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [warning], more: false });
    await mount();

    await scrollTo(700);
    expect(document.body.textContent).toContain("The records could not be read.");
    expect(options()).toHaveLength(1);
    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(2);

    await scrollTo(750);
    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(3);
    expect(lastQuery().after).toEqual(cursorOf(failure));
    expect(titles()).toEqual(["boundary failed", "set zoom failed"]);
    expect(document.body.textContent).not.toContain("The records could not be read.");
  });

  it("re-reads the newest page once for a burst of new records while at the top, keeping the rows shown", async () => {
    await mount();
    vi.useFakeTimers();
    const next = deferred<RecordsPage>();
    mocks.readRecordsPage.mockReturnValueOnce(next.promise);

    await signal();
    await signal();
    await signal();
    await act(async () => vi.advanceTimersByTime(1000));

    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(lastQuery()).toEqual({ session: null, level: null, search: "", after: null });
    expect(mocks.readRecordSources).toHaveBeenCalledTimes(2);
    expect(options()).toHaveLength(2);
    expect(document.body.textContent).not.toContain("Loading records…");

    await act(async () => next.resolve({ records: [newer, failure, warning], more: false }));
    expect(titles()).toEqual(["boundary ok", "boundary failed", "set zoom failed"]);
  });

  it("leaves the list alone while scrolled down, and shows new records once back at the top", async () => {
    await mount();
    await scrollTo(300);
    vi.useFakeTimers();
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [newer, failure, warning], more: false });

    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(mocks.readRecordsPage).toHaveBeenCalledOnce();
    expect(options()).toHaveLength(2);

    await scrollTo(0);
    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(titles()).toEqual(["boundary ok", "boundary failed", "set zoom failed"]);
  });

  it("keeps the selected record selected through an update", async () => {
    await mount();
    await act(async () => options()[1]!.click());
    vi.useFakeTimers();
    mocks.readRecordsPage.mockResolvedValueOnce({ records: [newer, failure, warning], more: false });

    await signal();
    await act(async () => vi.advanceTimersByTime(1000));

    expect(options()).toHaveLength(3);
    expect(options()[2]!.getAttribute("aria-selected")).toBe("true");
    expect(mocks.readRecordDetail).toHaveBeenCalledOnce();
  });

  it("stops reading on new-record signals after a failed read, until a read succeeds", async () => {
    await mount();
    vi.useFakeTimers();
    mocks.readRecordsPage.mockRejectedValueOnce(new Error("busy"));

    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(2);

    // The failure was logged, and that record's signal must not start another read.
    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(2);
    expect(options()).toHaveLength(2);

    // A read the reader starts succeeds, and the window follows new records again.
    await choose(document.querySelectorAll("select")[1]!, "attention");
    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(3);
    await signal();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(mocks.readRecordsPage).toHaveBeenCalledTimes(4);
  });

  it("stops listening for new records when it closes", async () => {
    await mount();
    expect(mocks.recordsChanged).not.toBeNull();
    await act(async () => root?.unmount());
    root = null;
    expect(mocks.recordsChanged).toBeNull();
  });

  it("saves the list width once when a drag ends, held to the pane's bounds", async () => {
    await mount();
    const splitter = document.querySelector<HTMLElement>('[role="separator"]')!;
    expect(splitter.getAttribute("aria-label")).toBe("Resize list pane");

    await act(async () => {
      splitter.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 0 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 100 }));
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 2000 }));
    });
    expect(mocks.saveRecordsListWidth).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointerup"));
    });

    expect(mocks.saveRecordsListWidth).toHaveBeenCalledExactlyOnceWith(RECORDS_LIST_WIDTH.max);
    const shell = document.querySelector<HTMLElement>(".recordsShell")!;
    expect(shell.style.getPropertyValue("--records-list-width")).toBe(`${RECORDS_LIST_WIDTH.max}px`);
  });

  it("narrows the list when the window narrows, saving nothing", async () => {
    await mount();
    const shell = document.querySelector<HTMLElement>(".recordsShell")!;
    expect(shell.style.getPropertyValue("--records-list-width")).toBe(`${RECORDS_LIST_WIDTH.default}px`);

    await act(async () => {
      box.shellWidth = RECORDS_PADDING * 2 + RECORDS_GAP + RECORDS_DETAIL_MIN_WIDTH + RECORDS_LIST_WIDTH.min;
      for (const callback of resizeCallbacks) callback();
    });

    expect(shell.style.getPropertyValue("--records-list-width")).toBe(`${RECORDS_LIST_WIDTH.min}px`);
    expect(mocks.saveRecordsListWidth).not.toHaveBeenCalled();
  });

  it("says when the records cannot be read, without the raw error", async () => {
    mocks.readRecordsPage.mockRejectedValue(new Error("SQLITE_CORRUPT /Users/someone/.quickdeck/records.sqlite3"));
    await mount();

    expect(document.body.textContent).toContain("The records could not be read.");
    expect(document.body.textContent).not.toContain("SQLITE_CORRUPT");
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it("says when a selected record cannot be read", async () => {
    mocks.readRecordDetail.mockResolvedValueOnce(null);
    await mount();
    await act(async () => options()[0]!.click());

    expect(document.body.textContent).toContain("This record could not be read.");
  });
});
