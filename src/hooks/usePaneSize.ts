import { useEffect, useRef, useState, type RefObject } from "react";
import { clampPaneWidth } from "../utils/paneWidth";

// An adjustable pane's DISPLAYED width, derived from its saved INTENT and the
// live width of the container the panes share (window-conventions). Before the
// container has measured, the intent is held to the pane's own bounds, so the
// pane never renders wider than them even for a frame.
export function usePaneSize<E extends HTMLElement = HTMLDivElement>(
  intent: number,
  bounds: { siblingMin: number; min: number; max: number },
): { containerRef: RefObject<E | null>; displayed: number } {
  const containerRef = useRef<E | null>(null);
  const [available, setAvailable] = useState<number | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const measure = () => setAvailable(element.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  return { containerRef, displayed: clampPaneWidth(intent, { available, ...bounds }) };
}
