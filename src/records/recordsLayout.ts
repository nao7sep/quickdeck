import { clampPaneWidth } from "../utils/paneWidth";

// The Records window's layout: a user-adjustable list pane (filters above the
// record list) beside the detail pane, which takes the rest. Pane sizing:
// window-conventions. These constants mirror the `.records*` rules in
// src/styles.css; tests/records/recordsLayout.test.ts keeps the two in step.

// `.recordsShell` padding and the gap between its two panes.
export const RECORDS_PADDING = 16;
export const RECORDS_GAP = 16;

// The list pane's bounds. `min` still fits the two filter selects side by side
// and feeds the window minimum below; the width is saved only when a splitter
// drag ends, and shown clamped to the live window.
export const RECORDS_LIST_WIDTH = { min: 320, default: 380, max: 640 } as const;

// The detail pane's real minimum: its field grid still reads at two columns.
export const RECORDS_DETAIL_MIN_WIDTH = 420;

// The filter band: 12px padding above and below a search field and one row of
// selects (two 36px controls, 8px apart), and the line below it.
export const RECORDS_FILTERS_HEIGHT = 12 * 2 + 36 * 2 + 8 + 1;

// The list itself keeps room for a few rows below the filters.
export const RECORDS_LIST_MIN_HEIGHT = 160;

// A pane's own border, on both sides.
const RECORDS_PANE_BORDERS = 2;

// Derived — do not hand-edit.
export const RECORDS_WINDOW_MIN_WIDTH =
  RECORDS_PADDING * 2 +
  RECORDS_LIST_WIDTH.min +
  RECORDS_GAP +
  RECORDS_DETAIL_MIN_WIDTH +
  RECORDS_PANE_BORDERS * 2;

// Derived — do not hand-edit.
export const RECORDS_WINDOW_MIN_HEIGHT =
  RECORDS_PADDING * 2 + RECORDS_PANE_BORDERS + RECORDS_FILTERS_HEIGHT + RECORDS_LIST_MIN_HEIGHT;

// Everything beside the list pane on its row: the detail pane's minimum, the
// gap, and the shell's padding.
export const RECORDS_LIST_SIBLING_MIN = RECORDS_PADDING * 2 + RECORDS_GAP + RECORDS_DETAIL_MIN_WIDTH;

// The saved width as the window opens: a missing or hand-edited value is the
// default, and any other is held to the bounds.
export function initialListWidth(saved: number | null): number {
  if (saved === null || !Number.isFinite(saved)) return RECORDS_LIST_WIDTH.default;
  return clampPaneWidth(saved, { available: null, siblingMin: 0, ...RECORDS_LIST_WIDTH });
}
