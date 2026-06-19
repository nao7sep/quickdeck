// Pure pane-array transforms behind the add / delete / reorder actions.
//
// The React provider owns the state and the side effects (toasts, marking
// unsaved); these functions only decide the next pane list and which pane
// should be active. Keeping them pure makes the editor's core invariants —
// "at least one pane always remains", "only empty panes delete", reorder bounds
// — testable without React.

import type { Pane } from "../types";
import { createDefaultPane } from "./defaults";
import { multiline } from "../utils/textCleanup";

// Appends a new pane whose header color is chosen to stay distinct from every
// existing pane header. The caller supplies the id (generated outside so the
// caller can also focus the new pane).
export function appendPane(panes: Pane[], newPaneId: string): Pane[] {
  const existingHeaders = panes.map((pane) => pane.headerColor);
  return [...panes, createDefaultPane(newPaneId, existingHeaders)];
}

// Moves the pane one slot in the given direction. Returns the same array
// reference (not a copy) when the move is a no-op — pane not found or already
// at the edge — so the caller can skip marking the document unsaved.
export function reorderPane(panes: Pane[], paneId: string, direction: -1 | 1): Pane[] {
  const fromIndex = panes.findIndex((pane) => pane.id === paneId);
  if (fromIndex < 0) {
    return panes;
  }
  const toIndex = fromIndex + direction;
  if (toIndex < 0 || toIndex >= panes.length) {
    return panes;
  }

  const next = [...panes];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export type DeletePaneOutcome =
  | { kind: "not-found" }
  | { kind: "blocked-last" }
  | { kind: "blocked-non-empty" }
  | { kind: "deleted"; panes: Pane[]; nextActivePaneId: string };

// Decides whether a pane may be deleted and, if so, the resulting pane list and
// active pane. Deletion is refused for the final pane and for any pane whose
// trimmed content is non-empty. When the active pane is the one removed, focus
// falls back to the previous pane (or the first remaining pane).
export function deletePane(panes: Pane[], paneId: string, activePaneId: string): DeletePaneOutcome {
  const pane = panes.find((candidate) => candidate.id === paneId);
  if (!pane) {
    return { kind: "not-found" };
  }

  if (panes.length === 1) {
    return { kind: "blocked-last" };
  }

  if (multiline(pane.content).length > 0) {
    return { kind: "blocked-non-empty" };
  }

  const deletedIndex = panes.findIndex((candidate) => candidate.id === paneId);
  const nextPanes = panes.filter((candidate) => candidate.id !== paneId);
  const fallbackActivePane = nextPanes[Math.max(0, deletedIndex - 1)] ?? nextPanes[0];
  const nextActivePaneId = activePaneId === paneId ? fallbackActivePane.id : activePaneId;

  return { kind: "deleted", panes: nextPanes, nextActivePaneId };
}
