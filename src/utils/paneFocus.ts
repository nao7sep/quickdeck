// Decides whether a pane that has just become active should pull keyboard focus
// into its editor textarea.
//
// A pane auto-focuses its editor when it becomes active so that switching panes
// with Cmd/Ctrl+Arrow — or clicking a pane's body — lands the caret ready to
// type. But that pull must respect the never-steal-focus rule from the
// composite-control conventions: when focus currently lives on a control
// *outside* the pane deck — most importantly the zen-mode pane switcher in the
// status bar, a follows-focus tablist that moves focus to its own tab on every
// arrow key — the pane must not yank focus away, or the switcher could only ever
// be arrowed once before focus jumped into the editor behind it.
//
// Pure with respect to the passed-in nodes (mirrors focusTrap.ts): given the
// current focus, the editor, this pane's title input, and the pane deck, it
// decides whether the editor should take focus. The caller does the focusing.
export function shouldPullEditorFocus(
  activeElement: Element | null,
  editor: HTMLElement,
  title: HTMLElement | null,
  deck: HTMLElement | null,
): boolean {
  // Already where we want it, or the user is renaming this very pane — leave it.
  if (activeElement === editor || (title !== null && activeElement === title)) {
    return false;
  }

  // Focus is nowhere: the initial mount, or it fell to the body when the
  // previously focused pane unmounted during a zen pane switch. Safe to claim.
  if (activeElement === null || activeElement === document.body) {
    return true;
  }

  // Focus is already inside the editing surface — a pane-to-pane move within the
  // deck (Cmd/Ctrl+Arrow from another pane's editor, or a click on this pane's
  // body). Follow it into this pane.
  if (deck !== null && deck.contains(activeElement)) {
    return true;
  }

  // Focus lives on an out-of-deck control (the zen pane switcher, the app menu,
  // a status-bar button). Adopt the active state silently; do not steal focus.
  return false;
}
