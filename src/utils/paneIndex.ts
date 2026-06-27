/**
 * Clamp an arbitrary index into a list's valid range `[0, length - 1]`. The
 * focus-previous/next-pane shortcuts compute `currentIndex ± 1` and clamp so the
 * ends don't wrap or run off the array; a not-found active pane (`index === -1`)
 * lands on the first pane. Returns 0 for an empty list (defensive — panes are
 * never empty in practice).
 */
export function clampPaneIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}
