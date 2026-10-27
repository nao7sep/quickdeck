// The snapshot list's pure decisions, kept out of the modal so they are
// directly testable: where an arrow key moves the cursor, and which snapshot is
// selected once the rows underneath it change.

// The navigation keys a listbox owns. Returns the index to move to, or null
// when the key is not one of them or the move would leave the list — the
// cursor stops at the ends rather than wrapping, so holding an arrow key
// settles instead of cycling.
export function nextSelectionIndex(
  currentIndex: number,
  key: string,
  count: number,
): number | null {
  if (count === 0) {
    return null;
  }

  const last = count - 1;
  // With nothing selected, the first move enters the list from the near end.
  const from = currentIndex < 0 ? -1 : currentIndex;

  let target: number;
  switch (key) {
    case "ArrowDown":
      target = from + 1;
      break;
    case "ArrowUp":
      target = from < 0 ? last : from - 1;
      break;
    case "Home":
      target = 0;
      break;
    case "End":
      target = last;
      break;
    default:
      return null;
  }

  const clamped = Math.min(last, Math.max(0, target));
  return clamped === currentIndex ? null : clamped;
}

// Which snapshot is selected after the rows change. The user is still reading
// the snapshot they picked, so it is kept whenever it survives the change;
// otherwise the list starts at the top, which is where a fresh search or a
// return to browsing should begin.
export function selectionAfterRowsChange(
  rowIds: ReadonlyArray<string>,
  previousSelectedId: string | null,
): string | null {
  if (rowIds.length === 0) {
    return null;
  }
  if (previousSelectedId !== null && rowIds.includes(previousSelectedId)) {
    return previousSelectedId;
  }
  return rowIds[0];
}

// The budget for a row's one-line excerpt. Well above what a row shows, per the
// text-cleanup conventions: the helper reads graphemes and CSS does the visual
// fitting, so this is a minimum rather than a measured width.
export const EXCERPT_GRAPHEMES = 120;
