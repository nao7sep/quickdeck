// When an edit makes text disappear, the pane keeps its text from just before as
// a snapshot: before a paste replaces selected text, and before one edit empties
// the pane or removes a large block of it. Small corrections while typing add
// none. Copy, cut, after-paste and quit snapshots are taken elsewhere; a snapshot
// equal to the pane's latest is skipped by the store, so a cut that also shrinks
// the pane is stored once.

// How many characters one edit must remove to count as a large block: more than
// a word or a short line retyped, less than a paragraph. Revisit if use shows
// the Snapshots window filling with noise or missing real losses.
export const LARGE_REMOVAL_CHARS = 100;

// A paste replaces text when something is selected as it lands.
export function pasteReplacesText(selectionStart: number, selectionEnd: number): boolean {
  return selectionEnd > selectionStart;
}

// Whether one edit from `before` to `after` empties the pane or shortens it by a
// large block. Length is enough: an edit that removes a block but keeps the
// length is a paste over a selection, which is kept before the paste.
export function removesLargeBlock(before: string, after: string): boolean {
  if (before.length === 0) return false;
  return after.length === 0 || before.length - after.length >= LARGE_REMOVAL_CHARS;
}
