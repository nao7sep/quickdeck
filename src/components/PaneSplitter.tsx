import { useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

// How far one arrow key moves the splitter.
export const SPLITTER_KEY_STEP = 16;

// The width a key moves the splitter to, or null for a key it does not handle:
// Left and Right by one step, Home and End to the pane's bounds.
export function keyedWidth(key: string, width: number, min: number, max: number): number | null {
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  switch (key) {
    case "ArrowLeft":
      return clamp(width - SPLITTER_KEY_STEP);
    case "ArrowRight":
      return clamp(width + SPLITTER_KEY_STEP);
    case "Home":
      return min;
    case "End":
      return max;
    default:
      return null;
  }
}

// The vertical drag handle between an adjustable pane and the pane beside it
// (the Records window's list and detail panes). It owns the pointer gesture and
// the keyboard: it streams the new width (held to the pane's own bounds) while
// dragging or while keys move it, and reports the final width once, on pointer
// release, key release or blur. The parent owns the width, shows it clamped to
// the live window, and saves it on `onCommit` only (window-conventions).
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
  // A keyed width not yet committed.
  const keyed = useRef<number | null>(null);

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

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const next = keyedWidth(event.key, keyed.current ?? width, min, max);
    if (next === null) return;
    event.preventDefault();
    keyed.current = next;
    onResize(next);
  }

  function commitKeyed() {
    if (keyed.current === null) return;
    const latest = keyed.current;
    keyed.current = null;
    onCommit(latest);
  }

  return (
    <div
      className="paneSplitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onKeyUp={commitKeyed}
      onBlur={commitKeyed}
    >
      <span className="paneSplitterGrip" aria-hidden="true" />
    </div>
  );
}
