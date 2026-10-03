export type NavDirection = "next" | "prev" | "first" | "last" | "page-next" | "page-prev";

/**
 * The roving-navigation index math shared by the app's in-app composite layers
 * (the Menu, the zen-mode PaneSwitcher tablist, and the Records window's
 * listbox). Given a direction, the current item index, and the item count,
 * returns the index a directional key should move to; a page moves `pageStep`
 * items, about one viewport.
 *
 * Stops at the ends (no wrapping). When nothing is current yet (index `-1`),
 * "next" enters at the first item and "prev" at the last. Returns `-1` for an
 * empty set. Each control maps its own keys onto a direction (the menu uses
 * Up/Down, the vertical tablist uses Up/Down and Left/Right) and keeps the DOM
 * focus movement itself, which is verified by manual QA.
 */
export function nextIndex(direction: NavDirection, current: number, length: number, pageStep = 1): number {
  if (length === 0) return -1;
  switch (direction) {
    case "page-next":
      return current < 0 ? 0 : Math.min(current + pageStep, length - 1);
    case "page-prev":
      return current < 0 ? 0 : Math.max(current - pageStep, 0);
    case "next":
      return current < 0 ? 0 : Math.min(current + 1, length - 1);
    case "prev":
      return current < 0 ? length - 1 : Math.max(current - 1, 0);
    case "first":
      return 0;
    case "last":
      return length - 1;
  }
}

export function indexOfId(ids: readonly string[], id: string | null | undefined): number {
  return id ? ids.indexOf(id) : -1;
}

/**
 * Maps a keyboard key to a navigation direction for a vertical composite that
 * also accepts the horizontal arrows (the zen-mode pane-switcher tablist). Up
 * and Left mean "prev"; Down and Right mean "next"; Home/End are first/last.
 * Returns null for any other key so the handler can ignore it.
 */
export function verticalTablistDirection(key: string): NavDirection | null {
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return "next";
    case "ArrowUp":
    case "ArrowLeft":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

/**
 * Maps a keyboard key to a navigation direction for a listbox
 * (composite-control-conventions, Listbox): Up/Down by one, PageUp/PageDown by
 * about one viewport, Home/End to the ends. Returns null for any other key.
 */
export function listboxDirection(key: string): NavDirection | null {
  switch (key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "prev";
    case "PageDown":
      return "page-next";
    case "PageUp":
      return "page-prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}
