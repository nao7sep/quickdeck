import type { PointerEvent as ReactPointerEvent } from "react";

// The vertical drag handle between an adjustable pane and the pane beside it
// (the Records window's list and detail panes). It owns only the pointer
// gesture: it streams the new width (start width plus the horizontal delta, held
// to the pane's own bounds) while dragging and reports the final width on
// release. The parent owns the width, shows it clamped to the live window, and
// saves it on `onCommit` only (window-conventions).
//
// Keyboard resize is not offered: the width is saved, so this is a one-time
// setup gesture rather than a frequent interaction.
export function PaneSplitter({
  label,
  width,
  min,
  max,
  onResize,
  onCommit,
}: {
  label: string;
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
}) {
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;

    const move = (moveEvent: PointerEvent) => {
      latest = Math.max(min, Math.min(max, Math.round(startWidth + (moveEvent.clientX - startX))));
      onResize(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      onCommit(latest);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // The resize cursor and no text selection anywhere for the drag.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div
      className="paneSplitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onPointerDown}
    >
      <span className="paneSplitterGrip" aria-hidden="true" />
    </div>
  );
}
