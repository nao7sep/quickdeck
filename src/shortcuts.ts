import { isApplePlatform } from "./utils/zoom";

export type ShortcutId =
  | "toggleDark"
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
export type ShortcutDefinition = {
  id?: ShortcutId;
  keys: string;
  description: string;
};

// The command modifier word is resolved at runtime from the running platform:
// "Cmd" on macOS, "Ctrl" on Windows/Linux. The live shortcuts UI must show one
// word — never the combined "Cmd/Ctrl" and never a glyph (keyboard-shortcut
// conventions). Platform detection is shared with utils/zoom.ts so both surfaces
// agree on which physical key the user has.
const mod = isApplePlatform ? "Cmd" : "Ctrl";

// Built once at module load from the resolved modifier. Chord grammar:
// "+" joins with no spaces, modifier order is Cmd/Ctrl → Alt → Shift → key,
// keys are spelled in full, and shared-modifier alternatives use a tight "/".
export const shortcutDefinitions: ShortcutDefinition[] = [
  {
    id: "addPane",
    keys: `${mod}+N`,
    description: "Add pane",
  },
  {
    id: "focusPreviousPane",
    keys: `${mod}+Left`,
    description: "Focus previous pane",
  },
  {
    id: "focusNextPane",
    keys: `${mod}+Right`,
    description: "Focus next pane",
  },
  {
    id: "movePaneLeft",
    keys: `${mod}+Shift+Left`,
    description: "Move pane left",
  },
  {
    id: "movePaneRight",
    keys: `${mod}+Shift+Right`,
    description: "Move pane right",
  },
  {
    id: "toggleDark",
    keys: `${mod}+D`,
    description: "Toggle dark theme",
  },
  {
    id: "toggleZen",
    keys: `${mod}+K`,
    description: "Toggle zen mode",
  },
  {
    id: "toggleTopmost",
    keys: `${mod}+T`,
    description: "Toggle always on top",
  },
  {
    keys: `${mod}+Equal/Plus/Semicolon`,
    description: "Zoom in",
  },
  {
    keys: `${mod}+Minus`,
    description: "Zoom out",
  },
  {
    keys: `${mod}+0`,
    description: "Reset zoom",
  },
  {
    id: "openSettings",
    keys: `${mod}+Comma`,
    description: "Open settings",
  },
  {
    id: "openShortcuts",
    keys: `${mod}+Slash`,
    description: "Open shortcuts",
  },
  {
    id: "closeModal",
    keys: "Escape",
    description: "Close modal",
  },
];

export function matchesShortcut(event: KeyboardEvent, id: ShortcutId): boolean {
  const commandOrControl = event.metaKey || event.ctrlKey;

  if (id === "toggleDark") {
    return commandOrControl && !event.shiftKey && event.key.toLowerCase() === "d";
  }

  if (id === "toggleZen") {
    return commandOrControl && !event.shiftKey && event.key.toLowerCase() === "k";
  }

  if (id === "toggleTopmost") {
    return commandOrControl && !event.shiftKey && event.key.toLowerCase() === "t";
  }

  if (id === "addPane") {
    return commandOrControl && !event.shiftKey && event.key.toLowerCase() === "n";
  }

  if (id === "focusPreviousPane") {
    return commandOrControl && !event.shiftKey && event.key === "ArrowLeft";
  }

  if (id === "focusNextPane") {
    return commandOrControl && !event.shiftKey && event.key === "ArrowRight";
  }

  if (id === "movePaneLeft") {
    return commandOrControl && event.shiftKey && event.key === "ArrowLeft";
  }

  if (id === "movePaneRight") {
    return commandOrControl && event.shiftKey && event.key === "ArrowRight";
  }

  if (id === "openSettings") {
    return commandOrControl && !event.shiftKey && event.key === ",";
  }

  if (id === "openShortcuts") {
    return commandOrControl && !event.shiftKey && event.key === "/";
  }

  return id === "closeModal" && event.key === "Escape";
}
