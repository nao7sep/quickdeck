import { describe, expect, it } from "vitest";
import { matchesShortcut, shortcutDefinitions } from "../src/shortcuts";

type Mods = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

function key(k: string, mods: Mods = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: k, ...mods });
}

describe("matchesShortcut", () => {
  it("matches toggle shortcuts case-insensitively with either primary modifier", () => {
    expect(matchesShortcut(key("d", { ctrlKey: true }), "toggleDark")).toBe(true);
    expect(matchesShortcut(key("D", { metaKey: true }), "toggleDark")).toBe(true);
    expect(matchesShortcut(key("k", { ctrlKey: true }), "toggleZen")).toBe(true);
    expect(matchesShortcut(key("K", { metaKey: true }), "toggleZen")).toBe(true);
    expect(matchesShortcut(key("t", { ctrlKey: true }), "toggleTopmost")).toBe(true);
    expect(matchesShortcut(key("n", { metaKey: true }), "addPane")).toBe(true);
  });

  it("requires the modifier and rejects the shift variant for toggles", () => {
    expect(matchesShortcut(key("k", {}), "toggleZen")).toBe(false);
    expect(matchesShortcut(key("k", { ctrlKey: true, shiftKey: true }), "toggleZen")).toBe(false);
  });

  it("distinguishes focus (no shift) from move (shift) on the bracket keys", () => {
    const left = key("[", { ctrlKey: true });
    const shiftLeft = key("{", { ctrlKey: true, shiftKey: true });
    expect(matchesShortcut(left, "focusPreviousPane")).toBe(true);
    expect(matchesShortcut(left, "movePaneLeft")).toBe(false);
    expect(matchesShortcut(shiftLeft, "movePaneLeft")).toBe(true);
    expect(matchesShortcut(shiftLeft, "focusPreviousPane")).toBe(false);

    const right = key("]", { metaKey: true });
    const shiftRight = key("}", { metaKey: true, shiftKey: true });
    expect(matchesShortcut(right, "focusNextPane")).toBe(true);
    expect(matchesShortcut(shiftRight, "movePaneRight")).toBe(true);
  });

  it("matches punctuation shortcuts", () => {
    expect(matchesShortcut(key(",", { ctrlKey: true }), "openSettings")).toBe(true);
    expect(matchesShortcut(key("/", { ctrlKey: true }), "openShortcuts")).toBe(true);
  });

  it("rejects AltGr chords — Windows delivers AltGr as Ctrl+Alt and must keep typing", () => {
    // An unmapped AltGr combination falls back to the base letter, so e.g.
    // AltGr+N arrives as key "n" with ctrlKey && altKey.
    expect(matchesShortcut(key("n", { ctrlKey: true, altKey: true }), "addPane")).toBe(false);
    expect(matchesShortcut(key("k", { ctrlKey: true, altKey: true }), "toggleZen")).toBe(false);
    expect(matchesShortcut(key(",", { ctrlKey: true, altKey: true }), "openSettings")).toBe(false);
    expect(matchesShortcut(key("/", { ctrlKey: true, altKey: true }), "openShortcuts")).toBe(false);
  });

  it("opens shortcuts on shifted-slash layouts and via the bare '?' alias", () => {
    // German QWERTZ types "/" as Shift+7 — the chord arrives with shiftKey
    // true and must still match; US Shift+"/" produces "?", the alias.
    expect(matchesShortcut(key("/", { ctrlKey: true, shiftKey: true }), "openShortcuts")).toBe(true);
    expect(matchesShortcut(key("?", { shiftKey: true }), "openShortcuts")).toBe(true);
    expect(matchesShortcut(key("?", {}), "openShortcuts")).toBe(true);
    // A command-modified "?" is not a binding, and AltGr-typed "?" is typing.
    expect(matchesShortcut(key("?", { metaKey: true }), "openShortcuts")).toBe(false);
    expect(matchesShortcut(key("?", { ctrlKey: true, altKey: true }), "openShortcuts")).toBe(false);
  });

  it("matches Escape for closeModal regardless of modifier", () => {
    expect(matchesShortcut(key("Escape", {}), "closeModal")).toBe(true);
    expect(matchesShortcut(key("Escape", { metaKey: true }), "closeModal")).toBe(true);
    expect(matchesShortcut(key("a", {}), "closeModal")).toBe(false);
  });
});

describe("shortcutDefinitions", () => {
  it("lists the toggles in dark -> zen -> topmost order", () => {
    const toggles = shortcutDefinitions
      .map((s) => s.id)
      .filter((id) => id === "toggleDark" || id === "toggleZen" || id === "toggleTopmost");
    expect(toggles).toEqual(["toggleDark", "toggleZen", "toggleTopmost"]);
  });

  it("has unique descriptions, since the modal uses them as render keys", () => {
    const descriptions = shortcutDefinitions.map((s) => s.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("includes the zoom rows as id-less, display-only entries", () => {
    // Zoom is matched in utils/zoom.ts, not matchesShortcut, so it carries no id.
    const idless = shortcutDefinitions.filter((s) => s.id === undefined).map((s) => s.description);
    expect(idless).toEqual(["Zoom in", "Zoom out", "Reset zoom"]);
  });
});

describe("the pane chords avoid Cocoa's text keymap", () => {
  it("uses bracket keys, not arrows — Cmd+Arrow is line navigation in a text field", () => {
    // QuickDeck's only surface is a textarea, so an arrow-bound pane chord was
    // advertised in the help modal and never fired.
    expect(matchesShortcut(key("ArrowLeft", { metaKey: true }), "focusPreviousPane")).toBe(false);
    expect(matchesShortcut(key("ArrowRight", { metaKey: true }), "focusNextPane")).toBe(false);
  });

  it("accepts both shifted forms of the bracket, like the slash chord", () => {
    // Shift+[ delivers "{" on US layouts and "[" on some others.
    expect(matchesShortcut(key("[", { metaKey: true, shiftKey: true }), "movePaneLeft")).toBe(true);
    expect(matchesShortcut(key("}", { metaKey: true, shiftKey: true }), "movePaneRight")).toBe(true);
  });
});
