// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pane } from "../../src/types";

const mocks = vi.hoisted(() => ({
  getTextCounts: vi.fn(() => ({ words: 0, chars: 0, xWeightedChars: 0, xLimit: 280, xValid: true })),
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
    recordSnapshot: vi.fn(),
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
