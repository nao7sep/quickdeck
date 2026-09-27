import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesShortcut, shortcutDefinitions } from "../src/shortcuts";

type Mods = { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

function key(k: string, mods: Mods = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: k, ...mods });
}

describe("matchesShortcut", () => {
  it("matches toggle shortcuts case-insensitively with either primary modifier", () => {
    expect(matchesShortcut(key("k", { ctrlKey: true }), "toggleZen")).toBe(true);
    expect(matchesShortcut(key("K", { metaKey: true }), "toggleZen")).toBe(true);
    expect(matchesShortcut(key("t", { ctrlKey: true }), "toggleTopmost")).toBe(true);
    expect(matchesShortcut(key("n", { metaKey: true }), "addPane")).toBe(true);
  });

  it("requires the modifier and rejects the shift variant for toggles", () => {
    expect(matchesShortcut(key("k", {}), "toggleZen")).toBe(false);
    expect(matchesShortcut(key("k", { ctrlKey: true, shiftKey: true }), "toggleZen")).toBe(false);
  });

  it("distinguishes focus (no shift) from move (shift) on PageUp/PageDown", () => {
    const left = key("PageUp", { ctrlKey: true });
    const shiftLeft = key("PageUp", { ctrlKey: true, shiftKey: true });
    expect(matchesShortcut(left, "focusPreviousPane")).toBe(true);
    expect(matchesShortcut(left, "movePaneLeft")).toBe(false);
    expect(matchesShortcut(shiftLeft, "movePaneLeft")).toBe(true);
    expect(matchesShortcut(shiftLeft, "focusPreviousPane")).toBe(false);

    const right = key("PageDown", { metaKey: true });
    const shiftRight = key("PageDown", { metaKey: true, shiftKey: true });
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

  it("cycles panes with the literal Ctrl+Tab / Ctrl+Shift+Tab chord, bound as Ctrl on every platform", () => {
    expect(matchesShortcut(key("Tab", { ctrlKey: true }), "focusNextPane")).toBe(true);
    expect(matchesShortcut(key("Tab", { ctrlKey: true, shiftKey: true }), "focusPreviousPane")).toBe(true);
    // Wrong shift state for the branch, and the command-modifier form, don't match.
    expect(matchesShortcut(key("Tab", { ctrlKey: true }), "focusPreviousPane")).toBe(false);
    expect(matchesShortcut(key("Tab", { ctrlKey: true, shiftKey: true }), "focusNextPane")).toBe(false);
    expect(matchesShortcut(key("Tab", { metaKey: true }), "focusNextPane")).toBe(false);
  });

  it("rejects Ctrl+Tab when Alt or Cmd also rides along", () => {
    // AltGr safety, and the literal-Ctrl branch never doubles as the dual-bound form.
    expect(matchesShortcut(key("Tab", { ctrlKey: true, altKey: true }), "focusNextPane")).toBe(false);
    expect(matchesShortcut(key("Tab", { ctrlKey: true, metaKey: true }), "focusNextPane")).toBe(false);
  });

  it("focuses a pane by number with Cmd/Ctrl+1..9", () => {
    for (const digit of "123456789") {
      expect(matchesShortcut(key(digit, { metaKey: true }), "focusPaneByNumber")).toBe(true);
      expect(matchesShortcut(key(digit, { ctrlKey: true }), "focusPaneByNumber")).toBe(true);
    }
    expect(matchesShortcut(key("0", { metaKey: true }), "focusPaneByNumber")).toBe(false);
    expect(matchesShortcut(key("1", {}), "focusPaneByNumber")).toBe(false);
    expect(matchesShortcut(key("1", { metaKey: true, shiftKey: true }), "focusPaneByNumber")).toBe(false);
    expect(matchesShortcut(key("1", { metaKey: true, altKey: true }), "focusPaneByNumber")).toBe(false);
  });

  it("moves panes with Cmd/Ctrl+LessThan / GreaterThan, tolerating Shift", () => {
    expect(matchesShortcut(key("<", { metaKey: true }), "movePaneLeft")).toBe(true);
    expect(matchesShortcut(key("<", { ctrlKey: true, shiftKey: true }), "movePaneLeft")).toBe(true);
    expect(matchesShortcut(key(">", { metaKey: true }), "movePaneRight")).toBe(true);
    expect(matchesShortcut(key(">", { ctrlKey: true, shiftKey: true }), "movePaneRight")).toBe(true);
    expect(matchesShortcut(key("<", { metaKey: true, altKey: true }), "movePaneLeft")).toBe(false);
    expect(matchesShortcut(key("<", {}), "movePaneLeft")).toBe(false);
  });

  it("matches Escape for closeModal regardless of modifier", () => {
    expect(matchesShortcut(key("Escape", {}), "closeModal")).toBe(true);
    expect(matchesShortcut(key("Escape", { metaKey: true }), "closeModal")).toBe(true);
    expect(matchesShortcut(key("a", {}), "closeModal")).toBe(false);
  });
});

describe("shortcutDefinitions", () => {
  it("lists the toggles in zen -> topmost order", () => {
    const toggles = shortcutDefinitions
      .map((s) => s.id)
      .filter((id) => id === "toggleZen" || id === "toggleTopmost");
    expect(toggles).toEqual(["toggleZen", "toggleTopmost"]);
  });

  it("offers no theme shortcut; the theme changes only in Settings", () => {
    expect(shortcutDefinitions.some((s) => /theme|dark/i.test(s.description))).toBe(false);
  });

  it("has unique descriptions, since the modal uses them as render keys", () => {
    const descriptions = shortcutDefinitions.map((s) => s.description);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("includes the zoom rows as id-less, display-only entries", () => {
    // Zoom is matched in utils/zoom.ts, not matchesShortcut, so it carries no id.
    const idless = shortcutDefinitions.filter((s) => s.id === undefined).map((s) => s.description);
    expect(idless).toEqual(["shortcuts.zoomIn", "shortcuts.zoomOut", "shortcuts.zoomReset"]);
  });

  describe("platform pane-key labels", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function paneKeys(platform: string): Promise<Record<string, string>> {
      vi.stubGlobal("navigator", { platform, userAgent: platform });
      vi.resetModules();
      const { shortcutDefinitions: definitions } = await import("../src/shortcuts");
      return Object.fromEntries(
        definitions.flatMap((definition) =>
          definition.id ? [[definition.id, definition.keys]] : [],
        ),
      );
    }

    it("shows the named PageUp/PageDown form on macOS, never the Fn+Arrow keystrokes", async () => {
      // keyboard-shortcut-conventions: a chord is written with the key's own
      // name, never the keystrokes a particular keyboard needs to produce it.
      const keys = await paneKeys("MacIntel");
      expect(keys.focusPreviousPane).toBe("Cmd+PageUp / Ctrl+Shift+Tab");
      expect(keys.focusNextPane).toBe("Cmd+PageDown / Ctrl+Tab");
      expect(keys.movePaneLeft).toBe("Cmd+Shift+PageUp / Cmd+LessThan");
      expect(keys.movePaneRight).toBe("Cmd+Shift+PageDown / Cmd+GreaterThan");
    });

    it("shows PageUp/PageDown where those are the platform keys", async () => {
      const keys = await paneKeys("Win32");
      expect(keys.focusPreviousPane).toBe("Ctrl+PageUp / Ctrl+Shift+Tab");
      expect(keys.focusNextPane).toBe("Ctrl+PageDown / Ctrl+Tab");
    });

    it("shows the literal Ctrl+Tab cycling chord unchanged on every platform", async () => {
      // Bound as Ctrl, not the command modifier — it must read "Ctrl" even on
      // macOS, where every other chord's word resolves to "Cmd".
      const mac = await paneKeys("MacIntel");
      const win = await paneKeys("Win32");
      expect(mac.focusPreviousPane).toContain("Ctrl+Shift+Tab");
      expect(mac.focusNextPane).toContain("Ctrl+Tab");
      expect(win.focusPreviousPane).toContain("Ctrl+Shift+Tab");
      expect(win.focusNextPane).toContain("Ctrl+Tab");
    });

    it("shows the numbered pane-focus row with the platform's own modifier", async () => {
      const mac = await paneKeys("MacIntel");
      const win = await paneKeys("Win32");
      expect(mac.focusPaneByNumber).toBe("Cmd+1/2/3/4/5/6/7/8/9");
      expect(win.focusPaneByNumber).toBe("Ctrl+1/2/3/4/5/6/7/8/9");
    });
  });
});

describe("the pane chords avoid Cocoa's text keymap and printable layout keys", () => {
  it("uses PageUp/PageDown, not arrows — Cmd+Arrow is line navigation in a text field", () => {
    // QuickDeck's only surface is a textarea, so an arrow-bound pane chord was
    // advertised in the help modal and never fired.
    expect(matchesShortcut(key("ArrowLeft", { metaKey: true }), "focusPreviousPane")).toBe(false);
    expect(matchesShortcut(key("ArrowRight", { metaKey: true }), "focusNextPane")).toBe(false);
  });

  it("does not depend on brackets that require Alt/AltGr on common layouts", () => {
    expect(matchesShortcut(key("[", { metaKey: true, altKey: true }), "focusPreviousPane")).toBe(false);
    expect(matchesShortcut(key("]", { ctrlKey: true, altKey: true }), "focusNextPane")).toBe(false);
    expect(matchesShortcut(key("PageUp", { metaKey: true }), "focusPreviousPane")).toBe(true);
    expect(matchesShortcut(key("PageDown", { ctrlKey: true }), "focusNextPane")).toBe(true);
  });
});
