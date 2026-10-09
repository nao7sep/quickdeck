// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pane } from "../../src/types";

const mocks = vi.hoisted(() => ({
  getTextCounts: vi.fn(() => ({ words: 0, chars: 0, xWeightedChars: 0, xLimit: 280, xValid: true })),
  recordSnapshot: vi.fn(),
}));

vi.mock("../../src/utils/counts", () => ({ getTextCounts: mocks.getTextCounts }));

const settings = {
  zen: false,
  editorFontFamily: "monospace",
  editorFontSize: 14,
  editorLineHeight: 1.4,
  editorPadding: 8,
  editorBold: false,
  editorItalic: false,
  editorUnderline: false,
};

vi.mock("../../src/state/AppStateContext", () => ({
  useAppState: () => ({
    activePaneId: "pane-1",
    settings,
    setActivePaneId: vi.fn(),
    updatePaneTitle: vi.fn(),
    commitPaneTitle: vi.fn(),
    updatePaneContent: vi.fn(),
    deletePane: vi.fn(),
    recordSnapshot: mocks.recordSnapshot,
  }),
}));

import { PaneView } from "../../src/components/PaneView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  if (container) document.body.removeChild(container);
  container = null;
  mocks.getTextCounts.mockClear();
  mocks.recordSnapshot.mockClear();
});

function pane(content: string): Pane {
  return {
    id: "pane-1",
    title: "Scratch",
    content,
    headerColor: "#c72323",
    backgroundColor: "#111111",
  };
}

// QD-4: counts must be recomputed only when this pane's own content changes,
// not on every re-render caused by unrelated state elsewhere in the app (the
// AppStateContext value's identity changes on every keystroke in any pane).
describe("PaneView counts memoization", () => {
  it("does not recompute counts when the pane object is re-rendered with unchanged content", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const paneA = pane("hello world");
    await act(async () => root?.render(<PaneView pane={paneA} />));
    expect(mocks.getTextCounts).toHaveBeenCalledTimes(1);

    // Re-render with the SAME pane reference and content, as happens when a
    // sibling pane's edit changes context identity but not this pane's data.
    await act(async () => root?.render(<PaneView pane={paneA} />));
    expect(mocks.getTextCounts).toHaveBeenCalledTimes(1);
  });

  it("recomputes counts when this pane's own content changes", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root?.render(<PaneView pane={pane("hello")} />));
    expect(mocks.getTextCounts).toHaveBeenCalledTimes(1);

    await act(async () => root?.render(<PaneView pane={pane("hello there")} />));
    expect(mocks.getTextCounts).toHaveBeenCalledTimes(2);
  });
});

describe("PaneView editor font resolution", () => {
  it("falls back to the --font-mono variable when editorFontFamily is blank", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const original = settings.editorFontFamily;
    settings.editorFontFamily = "";

    await act(async () => root?.render(<PaneView pane={pane("hello")} />));
    const textarea = container.querySelector("textarea.paneEditor") as HTMLTextAreaElement;
    expect(textarea.style.fontFamily).toBe("var(--font-mono)");

    settings.editorFontFamily = original;
  });

  it("uses the stored family when editorFontFamily is set", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const original = settings.editorFontFamily;
    settings.editorFontFamily = "Iosevka";

    await act(async () => root?.render(<PaneView pane={pane("hello")} />));
    const textarea = container.querySelector("textarea.paneEditor") as HTMLTextAreaElement;
    expect(textarea.style.fontFamily).toBe("Iosevka");

    settings.editorFontFamily = original;
  });
});

describe("PaneView title", () => {
  it("keeps a cleared title empty and shows the default name only as its placeholder", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => root?.render(<PaneView pane={{ ...pane("hello"), title: "" }} />));
    const input = container.querySelector("input.paneTitleInput") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("New Buffer");
  });
});

describe("PaneView snapshots before text disappears", () => {
  const long = "a".repeat(150);

  async function editor(content: string): Promise<HTMLTextAreaElement> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<PaneView pane={pane(content)} />));
    return container.querySelector("textarea.paneEditor") as HTMLTextAreaElement;
  }

  // Sets the value the way a user edit does, so React's onChange sees it.
  async function type(textarea: HTMLTextAreaElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function fire(textarea: HTMLTextAreaElement, type: "paste" | "cut") {
    await act(async () => {
      textarea.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }

  function triggers() {
    return mocks.recordSnapshot.mock.calls.map(([, trigger, content]) => [trigger, content]);
  }

  it("keeps the text before a paste replaces a selection", async () => {
    const textarea = await editor("old text");
    textarea.setSelectionRange(0, 3);
    await fire(textarea, "paste");
    await type(textarea, "new text");
    expect(triggers()).toEqual([
      ["before_paste", "old text"],
      ["paste", "new text"],
    ]);
  });

  it("adds nothing before a paste with no selection", async () => {
    const textarea = await editor("old text");
    textarea.setSelectionRange(3, 3);
    await fire(textarea, "paste");
    await type(textarea, "old new text");
    expect(triggers()).toEqual([["paste", "old new text"]]);
  });

  it("keeps the text before an edit empties the pane", async () => {
    const textarea = await editor("short");
    await type(textarea, "");
    expect(triggers()).toEqual([["before_removal", "short"]]);
  });

  it("keeps the text before typing over a large selection", async () => {
    const textarea = await editor(long);
    await type(textarea, "x");
    expect(triggers()).toEqual([["before_removal", long]]);
  });

  it("adds nothing for a small deletion", async () => {
    const textarea = await editor(long);
    await type(textarea, long.slice(0, -10));
    expect(triggers()).toEqual([]);
  });

  it("asks for the same text on a cut and its removal, which the store keeps once", async () => {
    const textarea = await editor(long);
    await fire(textarea, "cut");
    await type(textarea, "");
    expect(triggers()).toEqual([
      ["cut", long],
      ["before_removal", long],
    ]);
  });
});
