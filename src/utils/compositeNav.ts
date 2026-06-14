export type NavDirection = "next" | "prev" | "first" | "last";

/**
 * The roving-navigation index math shared by the app's in-app composite layers
 * (the Menu and the zen-mode PaneSwitcher tablist). Given a direction, the
 * current item index, and the item count, returns the index a directional key
 * should move to.
 *
 * Stops at the ends (no wrapping). When nothing is current yet (index `-1`),
 * "next" enters at the first item and "prev" at the last. Returns `-1` for an
 * empty set. Each control maps its own keys onto a direction (the menu uses
 * Up/Down, the vertical tablist uses Up/Down and Left/Right) and keeps the DOM
 * focus movement itself, which is verified by manual QA.
 */
export function nextIndex(direction: NavDirection, current: number, length: number): number {
  if (length === 0) return -1;
  switch (direction) {
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
