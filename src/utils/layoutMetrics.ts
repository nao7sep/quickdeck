// Single source of truth for the window's content-based minimum size.
//
// Per the window-chrome-conventions, the window minimum is DERIVED from the
// panes and the fixed chrome — never a hand-typed literal that drifts the moment
// a pane changes. QuickDeck has no splitter: the panes are equal-stretch flex
// siblings (`.pane { flex: 1 1 0 }`) whose COUNT changes via Add / Delete, so
// the minimum WIDTH scales with the live pane count rather than being constant.
//
// These constants are the same numbers the CSS uses, kept here so the window
// minimum and the layout can never disagree:
//   - PANE_MIN_WIDTH / PANE_MIN_HEIGHT  → `.pane { min-width / min-height }`,
//     applied via the --pane-min-width / --pane-min-height vars in styles.css.
//   - DECK_GUTTER                       → `.paneDeck { gap }` (the inter-pane gutter).
//   - STATUS_BAR_HEIGHT                 → `.appStatusBar { height }`, the one piece
//     of fixed chrome reserved in the appShell's `auto` grid track.
// A CSS-text guard plus the tauri.conf.json guard (tests/) keep these in sync
// with the stylesheet and the native window manifest.

// The smallest width at which a single pane's header + editor stay usable.
export const PANE_MIN_WIDTH = 280;

// The smallest height at which a pane's header, editor, and footer stay usable.
export const PANE_MIN_HEIGHT = 240;

// The `.paneDeck` flex gap, drawn as the gutter between adjacent panes.
export const DECK_GUTTER = 2;

// The reserved height of the fixed status bar (`.appStatusBar`).
export const STATUS_BAR_HEIGHT = 44;

// Horizontal chrome flanking the pane deck (deck/shell padding). The deck spans
// the full window width with no side padding, so there is none today; it stays
// an explicit term so the sum reads as "panes + gutters + chrome".
export const HORIZONTAL_CHROME = 0;

// Minimum window width for the given pane count. Zen mode shows exactly one pane
// regardless of count, so the width floor collapses to a single pane. The width
// reserves every visible pane's minimum plus the gutters between them plus the
// horizontal chrome — so the OS can never shrink the window enough to squeeze a
// pane below its content.
export function computeWindowMinWidth(paneCount: number, zen: boolean): number {
  const visiblePanes = zen ? 1 : Math.max(1, paneCount);
  const gutters = Math.max(0, visiblePanes - 1) * DECK_GUTTER;
  return visiblePanes * PANE_MIN_WIDTH + gutters + HORIZONTAL_CHROME;
}

// Minimum window height: a single pane's minimum stacked above the fixed status
// bar. The pane row and the status bar are the appShell's two grid tracks, so
// the height floor is their sum.
export function computeWindowMinHeight(): number {
  return PANE_MIN_HEIGHT + STATUS_BAR_HEIGHT;
}
