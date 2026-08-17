// navigator.platform is deprecated but still reliable in all current engines
// including Tauri's webview. @tauri-apps/plugin-os is not used in this project.
export const isApplePlatform = /Mac|iPhone|iPad|iPod/.test(
  typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent,
);

/** The platform's command-modifier word: Cmd on macOS, Ctrl elsewhere. */
export const primaryModWord = isApplePlatform ? "Cmd" : "Ctrl";

/** Alt is excluded because Chromium delivers Windows AltGr as Ctrl+Alt. */
export function hasMod(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

/**
 * On macOS, Ctrl inside a text field belongs to the text system whatever the
 * key is, so the Ctrl half of a dual-bound chord stands down there — one
 * blanket test, no per-chord key list (keyboard-shortcut-conventions). The
 * Cmd half is the binding and always fires.
 */
export function shadowsMacTextEditing(event: KeyboardEvent): boolean {
  return isApplePlatform && event.ctrlKey && !event.metaKey;
}

// Structural shape of an editable-target check, DOM-free for unit tests.
interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  parentElement?: EditableTargetLike | null;
  getAttribute?: (name: string) => string | null;
}

// INPUT types that carry typed text; the rest (checkbox, radio, range, ...)
// consume no printable key and are not editable for chord purposes.
const TEXT_INPUT_TYPES = new Set([
  "text", "search", "url", "tel", "email", "password", "number", "date",
  "datetime-local", "month", "time", "week",
]);

/**
 * One editable-target predicate for the whole app. The parentElement walk is
 * load-bearing: a rich-text editor's event target is a DIV descendant of the
 * contenteditable, so a tagName-only test would let every chord through.
 */
export function isEditableTarget(
  target: EditableTargetLike | null | undefined,
): boolean {
  let current: EditableTargetLike | null | undefined = target;
  while (current) {
    if (current.isContentEditable) return true;
    if (current.tagName === "TEXTAREA") return true;
    if (current.tagName === "INPUT") {
      const type = current.getAttribute?.("type")?.toLowerCase() ?? "text";
      return TEXT_INPUT_TYPES.has(type);
    }
    current = current.parentElement ?? null;
  }
  return false;
}
