export type ShortcutId =
  | "addPane"
  | "focusPreviousPane"
  | "focusNextPane"
  | "movePaneLeft"
  | "movePaneRight"
  | "openSettings"
  | "openShortcuts"
  | "toggleTopmost"
  | "closeModal";

export type ShortcutDefinition = {
  id: ShortcutId;
  keys: string;
  description: string;
};

export const shortcutDefinitions: ShortcutDefinition[] = [
  {
    id: "toggleTopmost",
    keys: "Cmd/Ctrl + Shift + T",
    description: "Toggle always on top",
  },
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
    description: "Move active pane left",
  },
  {
    id: "movePaneRight",
    keys: "Cmd/Ctrl + Shift + Right",
    description: "Move active pane right",
  },
  {
    id: "openSettings",
    keys: "Cmd/Ctrl + ,",
    description: "Open settings",
  },
  {
    id: "openShortcuts",
    keys: "Cmd/Ctrl + /",
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

  if (id === "toggleTopmost") {
    return commandOrControl && event.shiftKey && event.key.toLowerCase() === "t";
  }

  return id === "closeModal" && event.key === "Escape";
}
