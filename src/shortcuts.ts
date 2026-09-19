import type { MessageKey } from "./i18n/catalogues";
import { hasMod, isApplePlatform, primaryModWord } from "./utils/shortcuts";

export type ShortcutId =
  | "toggleZen"
  | "toggleTopmost"
  | "addPane"
  | "focusPreviousPane"
  | "focusNextPane"
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
const pageUp = isApplePlatform ? "Fn+Up" : "PageUp";
const pageDown = isApplePlatform ? "Fn+Down" : "PageDown";

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
    keys: `${mod}+${pageUp}`,
    description: "shortcuts.focusPreviousPane",
  },
  {
    id: "focusNextPane",
    keys: `${mod}+${pageDown}`,
    description: "shortcuts.focusNextPane",
  },
  {
    id: "movePaneLeft",
    keys: `${mod}+Shift+${pageUp}`,
    description: "shortcuts.movePaneLeft",
  },
  {
    id: "movePaneRight",
    keys: `${mod}+Shift+${pageDown}`,
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
  if (id === "focusPreviousPane") {
    return commandOrControl && !event.shiftKey && event.key === "PageUp";
  }

  if (id === "focusNextPane") {
    return commandOrControl && !event.shiftKey && event.key === "PageDown";
  }

  if (id === "movePaneLeft") {
    return commandOrControl && event.shiftKey && event.key === "PageUp";
  }

  if (id === "movePaneRight") {
    return commandOrControl && event.shiftKey && event.key === "PageDown";
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
