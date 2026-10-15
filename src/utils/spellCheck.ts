// WebKit re-checks spelling around the caret after each keystroke, walking the
// text box's layout, and in a pane of a few megabytes that froze the window: a
// sample of the frozen web content process spent every main-thread sample in
// Editor::markMisspellingsAfterTypingToWord. A pane holding more than this many
// characters drops spell checking until it shrinks again. A first guess, to
// revisit if large panes still freeze or lose spell checking too early.
export const SPELL_CHECK_MAX_CHARS = 200_000;

export function spellCheckFits(text: string): boolean {
  return text.length <= SPELL_CHECK_MAX_CHARS;
}
