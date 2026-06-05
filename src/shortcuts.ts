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

export const shortcutDefinitions: ShortcutDefinition[] = [
  {
    id: "addPane",
    keys: "Cmd/Ctrl + N",
    description: "Add pane",
  },
  {
    id: "focusPreviousPane",
    keys: "Cmd/Ctrl + Left",
    description: "Focus previous pane",
  },
  {
    id: "focusNextPane",
    keys: "Cmd/Ctrl + Right",
    description: "Focus next pane",
  },
  {
    id: "movePaneLeft",
    keys: "Cmd/Ctrl + Shift + Left",
    description: "Move pane left",
  },
  {
    id: "movePaneRight",
    keys: "Cmd/Ctrl + Shift + Right",
    description: "Move pane right",
  },
  {
    id: "toggleDark",
    keys: "Cmd/Ctrl + D",
    description: "Toggle dark theme",
  },
  {
    id: "toggleZen",
    keys: "Cmd/Ctrl + K",
    description: "Toggle zen mode",
  },
  {
    id: "toggleTopmost",
    keys: "Cmd/Ctrl + T",
    description: "Toggle always on top",
  },
  {
    keys: "Cmd/Ctrl + Equal / Plus / Semicolon",
    description: "Zoom in",
  },
  {
    keys: "Cmd/Ctrl + Minus",
    description: "Zoom out",
  },
  {
    keys: "Cmd/Ctrl + 0",
    description: "Reset zoom",
  },
  {
    id: "openSettings",
    keys: "Cmd/Ctrl + Comma",
    description: "Open settings",
  },
  {
    id: "openShortcuts",
    keys: "Cmd/Ctrl + Slash",
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
