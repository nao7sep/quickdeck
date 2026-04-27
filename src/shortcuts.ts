export type ShortcutId =
  | "addPane"
  | "focusPreviousPane"
  | "focusNextPane"
  | "openSettings"
  | "openShortcuts"
  | "toggleTopmost"
  | "increaseOpacity"
  | "decreaseOpacity"
  | "closeModal";

export type ShortcutDefinition = {
  id: ShortcutId;
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
    id: "toggleTopmost",
    keys: "Cmd/Ctrl + Shift + T",
    description: "Toggle always on top",
  },
  {
    id: "increaseOpacity",
    keys: "Cmd/Ctrl + Shift + Up",
    description: "Increase opacity",
  },
  {
    id: "decreaseOpacity",
    keys: "Cmd/Ctrl + Shift + Down",
    description: "Decrease opacity",
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

  if (id === "openSettings") {
    return commandOrControl && !event.shiftKey && event.key === ",";
  }

  if (id === "openShortcuts") {
    return commandOrControl && !event.shiftKey && event.key === "/";
  }

  if (id === "toggleTopmost") {
    return commandOrControl && event.shiftKey && event.key.toLowerCase() === "t";
  }

  if (id === "increaseOpacity") {
    return commandOrControl && event.shiftKey && event.key === "ArrowUp";
  }

  if (id === "decreaseOpacity") {
    return commandOrControl && event.shiftKey && event.key === "ArrowDown";
  }

  return id === "closeModal" && event.key === "Escape";
}
