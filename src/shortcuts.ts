import type { MessageKey } from "./i18n/catalogues";
import { hasMod, primaryModWord } from "./utils/shortcuts";

export type ShortcutId =
  | "toggleZen"
  | "toggleTopmost"
  | "addPane"
  | "focusPreviousPane"
  | "focusNextPane"
  | "focusPaneByNumber"
  | "movePaneLeft"
  | "movePaneRight"
  | "openSettings"
  | "openShortcuts"
  | "closeModal";

// Single source of truth for the shortcuts the app advertises; the Shortcuts
// modal renders this list directly. `id` is present for shortcuts matched by
// matchesShortcut(); the zoom shortcuts carry no id because they are matched
// separately in utils/zoom.ts (they accept several keys across keyboard layouts).
// `keys` stay English in every language (they name the keycaps); the
// description is a catalogue key.
export type ShortcutDefinition = {
  id?: ShortcutId;
  keys: string;
  description: MessageKey;
};

// The command modifier word is resolved at runtime from the running platform:
// "Cmd" on macOS, "Ctrl" on Windows/Linux. The live shortcuts UI must show one
// word — never the combined "Cmd/Ctrl" and never a glyph (keyboard-shortcut
// conventions). Both the word and the matching predicate come from the one
// leaf module, so the label and the binding cannot disagree.
const mod = primaryModWord;
// Named keys are spelled with the key's own name, never the keystrokes a
// particular keyboard needs to produce it (keyboard-shortcut-conventions):
// `Cmd+PageUp` on every platform, never `Cmd+Fn+Up` for the Mac laptop route.
const pageUp = "PageUp";
const pageDown = "PageDown";

// Built once at module load from the resolved modifier. Chord grammar:
// "+" joins with no spaces, modifier order is Cmd/Ctrl → Alt → Shift → key,
// keys are spelled in full, and shared-modifier alternatives use a tight "/".
export const shortcutDefinitions: ShortcutDefinition[] = [
  {
    id: "addPane",
    keys: `${mod}+N`,
    description: "shortcuts.addPane",
  },
  {
    id: "focusPreviousPane",
    // Ctrl+Shift+Tab is a literal-Ctrl chord, bound as Ctrl on every platform
    // (not the command modifier) because it is a universal pane/tab-cycling
    // habit and the macOS text system gives it no meaning to shadow
    // (keyboard-shortcut-conventions, "The command modifier"). It is an
    // independent chord with a different modifier from the mod+PageUp form,
    // so the two are spaced, each written in full.
    keys: `${mod}+${pageUp} / Ctrl+Shift+Tab`,
    description: "shortcuts.focusPreviousPane",
  },
  {
    id: "focusNextPane",
    keys: `${mod}+${pageDown} / Ctrl+Tab`,
    description: "shortcuts.focusNextPane",
  },
  {
    id: "focusPaneByNumber",
    // Digits are keys every keyboard has without a layer, so the tight `/`
    // alternates the shared-modifier final keys in one row (browser tab
    // switching habit); 9 always focuses the last pane, matching every
    // browser's own Cmd/Ctrl+9 behavior.
    keys: `${mod}+1/2/3/4/5/6/7/8/9`,
    description: "shortcuts.focusPaneByNumber",
  },
  {
    id: "movePaneLeft",
    // Cmd+LessThan is an independent extra chord (Shift tolerated when typing
    // "<"), spaced from the mod+Shift+PageUp form because the modifiers differ.
    keys: `${mod}+Shift+${pageUp} / ${mod}+LessThan`,
    description: "shortcuts.movePaneLeft",
  },
  {
    id: "movePaneRight",
    keys: `${mod}+Shift+${pageDown} / ${mod}+GreaterThan`,
    description: "shortcuts.movePaneRight",
  },
  {
    id: "toggleZen",
    keys: `${mod}+K`,
    description: "shortcuts.toggleZen",
  },
  {
    id: "toggleTopmost",
    keys: `${mod}+T`,
    description: "shortcuts.toggleTopmost",
  },
  {
    keys: `${mod}+Equal/Plus/Semicolon`,
    description: "shortcuts.zoomIn",
  },
  {
    keys: `${mod}+Minus`,
    description: "shortcuts.zoomOut",
  },
  {
    keys: `${mod}+0`,
    description: "shortcuts.zoomReset",
  },
  {
    id: "openSettings",
    keys: `${mod}+Comma`,
    description: "shortcuts.openSettings",
  },
  {
    id: "openShortcuts",
    keys: `${mod}+Slash / Question`,
    description: "shortcuts.openShortcuts",
  },
  {
    id: "closeModal",
    keys: "Escape",
    description: "shortcuts.closeModal",
  },
];

// The literal-Ctrl pane-cycling chord: Ctrl+Tab / Ctrl+Shift+Tab, bound as
// Ctrl on every platform, never through the Cmd/Ctrl command predicate (see
// the callers below and keyboard-shortcut-conventions, "The command modifier").
function isCycleTabChord(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab";
}

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  const commandOrControl = hasMod(event);

  if (id === "toggleZen") {
    return commandOrControl && !event.shiftKey && event.key.toLowerCase() === "k";
  }

  if (id === "toggleTopmost") {
    return commandOrControl && !event.shiftKey && event.key.toLowerCase() === "t";
  }

  if (id === "addPane") {
    return commandOrControl && !event.shiftKey && event.key.toLowerCase() === "n";
  }

  // PageUp/PageDown are layout-independent named keys. Printable punctuation is
  // unsuitable here: brackets require Option or AltGr on common layouts, while
  // command matching must reject AltGr so typing cannot fire an accelerator.
  //
  // Ctrl+Tab / Ctrl+Shift+Tab are a separate, literal-Ctrl branch, not a
  // dual-bound Cmd/Ctrl chord: bound as Ctrl on every platform because macOS
  // owns Cmd+Tab and every browser already fixes Ctrl+Tab for cycling, so it
  // never passes through the commandOrControl predicate and stays live in an
  // editable pane (keyboard-shortcut-conventions, "The command modifier").
  if (id === "focusPreviousPane") {
    if (commandOrControl && !event.shiftKey && event.key === "PageUp") return true;
    return isCycleTabChord(event) && event.shiftKey;
  }

  if (id === "focusNextPane") {
    if (commandOrControl && !event.shiftKey && event.key === "PageDown") return true;
    return isCycleTabChord(event) && !event.shiftKey;
  }

  // Cmd+1..9 focus a pane by number, borrowed from the browser tab-switching
  // habit; 9 always means the last pane (see the App.tsx dispatch site).
  if (id === "focusPaneByNumber") {
    return commandOrControl && !event.shiftKey && /^[1-9]$/.test(event.key);
  }

  if (id === "movePaneLeft") {
    if (commandOrControl && event.shiftKey && event.key === "PageUp") return true;
    // Shift is tolerated: some layouts type "<" without it.
    return commandOrControl && event.key === "<";
  }

  if (id === "movePaneRight") {
    if (commandOrControl && event.shiftKey && event.key === "PageDown") return true;
    return commandOrControl && event.key === ">";
  }

  if (id === "openSettings") {
    return commandOrControl && !event.shiftKey && event.key === ",";
  }

  if (id === "openShortcuts") {
    // Shift is tolerated on the "/" branch: on shifted-slash layouts (German
    // QWERTZ Shift+7) the chord arrives as key "/" with shiftKey true, and
    // requiring its absence made the advertised chord unreachable there. On
    // US-style layouts Shift+"/" produces "?", which the alias branch below
    // catches — both forms resolve to this same command, in this same handler.
    if (commandOrControl && event.key === "/") return true;
    // Bare printable "?" alias: raw flags, never !hasMod(event) — the
    // predicate's Alt exclusion would make "no command modifier" read true
    // under AltGr. The dispatch site skips this branch while typing.
    return (
      !event.metaKey && !event.ctrlKey && !event.altKey && event.key === "?"
    );
  }

  return id === "closeModal" && event.key === "Escape";
}
