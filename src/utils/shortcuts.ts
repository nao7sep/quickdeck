// The leaf home of the command-modifier predicate and the platform display
// word (keyboard-shortcut-conventions): both src/shortcuts.ts (the chord
// definitions) and src/utils/zoom.ts import from here, downward — a per-file
// copy is what let quickdeck's named chords and zoom chords disagree on which
// modifier fires.

// navigator.platform is deprecated but still reliable in all current engines
// including Tauri's webview. @tauri-apps/plugin-os is not used in this project.
export const isApplePlatform = /Mac|iPhone|iPad|iPod/.test(
  typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent,
);

/** The platform's command-modifier word: Cmd on macOS, Ctrl elsewhere. Only
 * the DISPLAY word is platform-bound; the predicate below accepts both. */
export const primaryModWord = isApplePlatform ? "Cmd" : "Ctrl";

/**
 * The one shared command-modifier predicate: BOTH Cmd and Ctrl fire on every
 * platform (the conventions' cross-machine muscle-memory rule), and Alt is
 * excluded because Chromium delivers Windows AltGr as Ctrl+Alt — an unguarded
 * predicate would let an AltGr-typed character fire an accelerator and
 * swallow the character.
 */
export function hasMod(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

// Bare-Ctrl chords on these keys shadow Cocoa's text-editing keymap
// (StandardKeyBinding.dict: kill-line, transpose, next-line, ..., and
// Ctrl+Slash), so they belong to the text system while the caret is editable.
const COCOA_CTRL_TEXT_KEYS = new Set([
  "a", "b", "d", "e", "f", "h", "k", "l", "n", "o", "p", "t", "v", "y", "/",
]);

/**
 * True when this chord shadows a macOS text-editing binding and must stand
 * down while the event target is editable (keyboard-shortcut-conventions):
 * bare-Ctrl chords on Cocoa text keys, and Cmd/Ctrl+Arrow left/right —
 * line navigation and its Shift-extending selection forms — which quickdeck
 * binds for pane focus and pane reorder.
 */
export function shadowsMacTextEditing(event: KeyboardEvent): boolean {
  if (!isApplePlatform) return false;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    return event.metaKey || event.ctrlKey;
  }
  if (event.metaKey || !event.ctrlKey) return false;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return COCOA_CTRL_TEXT_KEYS.has(key);
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
