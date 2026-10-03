// Pane sizing: window-conventions.
// An adjustable pane's displayed width: the saved intent, held to the pane's own
// bounds and to what the live container leaves after every sibling's minimum.
export function clampPaneWidth(
  intent: number,
  bounds: { available: number | null; siblingMin: number; min: number; max: number },
): number {
  const { available, siblingMin, min, max } = bounds;
  const room = available === null ? max : available - siblingMin;
  const ceiling = Math.max(min, Math.min(max, room));
  return Math.max(min, Math.min(ceiling, Math.round(intent)));
}
