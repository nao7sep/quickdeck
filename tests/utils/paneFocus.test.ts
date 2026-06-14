import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shouldPullEditorFocus } from "../../src/utils/paneFocus";

// Builds a pane deck (one pane's title + editor inside it) plus a control that
// lives OUTSIDE the deck, standing in for the zen-mode pane switcher tab in the
// status bar.
let deck: HTMLElement;
let editor: HTMLElement;
let title: HTMLElement;
let outside: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  deck = document.createElement("div");
  deck.className = "paneDeck";
  title = document.createElement("input");
  editor = document.createElement("textarea");
  deck.append(title, editor);
  outside = document.createElement("button");
  document.body.append(deck, outside);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("shouldPullEditorFocus", () => {
  it("does not steal focus from an out-of-deck control (the zen pane switcher)", () => {
    // The regression this guards: arrowing the zen switcher remounts the pane,
    // and without this rule the remounted editor stole focus off the switcher.
    expect(shouldPullEditorFocus(outside, editor, title, deck)).toBe(false);
  });

  it("does not re-focus when the editor already holds focus", () => {
    expect(shouldPullEditorFocus(editor, editor, title, deck)).toBe(false);
  });

  it("does not steal from this pane's own title input (an in-progress rename)", () => {
    expect(shouldPullEditorFocus(title, editor, title, deck)).toBe(false);
  });

  it("pulls focus when focus is nowhere — null or the document body", () => {
    // Null/body happens on the first mount and when the previously focused pane
    // unmounted during a zen Cmd/Ctrl+Arrow switch, dropping focus to the body.
    expect(shouldPullEditorFocus(null, editor, title, deck)).toBe(true);
    expect(shouldPullEditorFocus(document.body, editor, title, deck)).toBe(true);
  });

  it("pulls focus on a pane-to-pane move where focus is inside the deck", () => {
    // Cmd/Ctrl+Arrow from another pane's editor (still mounted, in the deck).
    const otherPaneEditor = document.createElement("textarea");
    deck.append(otherPaneEditor);
    expect(shouldPullEditorFocus(otherPaneEditor, editor, title, deck)).toBe(true);
  });

  it("does not steal when there is no deck and focus is on an outside element", () => {
    expect(shouldPullEditorFocus(outside, editor, title, null)).toBe(false);
  });

  it("tolerates a missing title input", () => {
    expect(shouldPullEditorFocus(document.body, editor, null, deck)).toBe(true);
    expect(shouldPullEditorFocus(outside, editor, null, deck)).toBe(false);
  });
});
