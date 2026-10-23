import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

export type HistoryPage<T, C> = {
  key: number;
  cursor: C;
  count: number;
  height: number;
  rows: T[] | null;
};

type Props<T, C> = {
  pages: HistoryPage<T, C>[];
  scrollRef: RefObject<HTMLDivElement | null>;
  renderRow: (row: T, index: number) => ReactNode;
  onNeed: (page: HistoryPage<T, C>) => void;
  // The parent retains these pages and drops cached rows in all other pages.
  onEvict: (keys: Set<number>) => void;
  revision: number;
  focusIndex: number | null;
  onFocused: () => void;
};

function sameKeys(left: Set<number> | null, right: Set<number>): boolean {
  return left !== null && left.size === right.size && [...right].every((key) => left.has(key));
}

// Data, cursors and request lifetimes belong to the caller. This viewport keeps
// only nearby pages mounted, plus the pages needed to preserve keyboard focus.
export function HistoryPages<T, C>({
  pages, scrollRef, renderRow, onNeed, onEvict, revision, focusIndex, onFocused,
}: Props<T, C>) {
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [focusedPage, setFocusedPage] = useState<number | null>(null);
  const [, measured] = useState(0);
  const wrappers = useRef(new Map<number, HTMLDivElement>());
  const retainedBefore = useRef<{ pages: HistoryPage<T, C>[]; revision: number; keys: Set<number> } | null>(null);
  const attachedScroll = useRef<HTMLDivElement | null>(null);
  const requestedBefore = useRef<{ pages: HistoryPage<T, C>[]; revision: number; keys: Set<number> } | null>(null);
  const completedFocus = useRef<number | null>(null);

  let offset = 0;
  let index = 0;
  const layout = pages.map((page) => {
    const item = { page, top: offset, index };
    offset += page.height;
    index += page.count;
    return item;
  });
  const target = focusIndex === null ? undefined : layout.find(
    (item) => focusIndex >= item.index && focusIndex < item.index + item.page.count,
  );
  const visibleTop = Math.min(viewport.top, Math.max(0, offset - viewport.height));
  const retained = new Set(layout.filter(({ page, top }) => (
    top + page.height > visibleTop - viewport.height && top < visibleTop + 2 * viewport.height
  ) || page.key === focusedPage || page === target?.page).map(({ page }) => page.key));

  // The scroll node can first appear after the parent's loading frame. Rebind
  // after every commit rather than treating a stable ref object as a stable node.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    attachedScroll.current = scroll;
    if (scroll === null) return;
    const updateViewport = () => {
      const next = { top: scroll.scrollTop, height: scroll.clientHeight || 600 };
      setViewport((current) => current.top === next.top && current.height === next.height ? current : next);
    };
    const pin = (element: EventTarget | null) => {
      const wrapper = element instanceof Element && scroll.contains(element)
        ? element.closest<HTMLElement>("[data-history-page]") : null;
      const key = wrapper === null ? null : Number(wrapper.dataset.historyPage);
      setFocusedPage((current) => current === key ? current : key);
    };
    const focusIn = (event: FocusEvent) => pin(event.target);
    const focusOut = (event: FocusEvent) => pin(event.relatedTarget);
    const anchor = scroll.style.overflowAnchor;
    scroll.style.overflowAnchor = "none";
    scroll.addEventListener("scroll", updateViewport);
    scroll.addEventListener("focusin", focusIn);
    scroll.addEventListener("focusout", focusOut);
    window.addEventListener("resize", updateViewport);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        if (entry.target === scroll) continue;
        const key = Number((entry.target as HTMLElement).dataset.historyPage);
        const item = layout.find(({ page }) => page.key === key);
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (item === undefined || item.page.rows === null || height <= 0 || height === item.page.height) continue;
        // Read offsets from the current page heights: several measurements may
        // settle in one notification, and earlier entries can shift later ones.
        let top = 0;
        for (const page of pages) {
          if (page.key === key) break;
          top += page.height;
        }
        if (top + item.page.height <= scroll.scrollTop) scroll.scrollTop += height - item.page.height;
        item.page.height = height;
        changed = true;
      }
      if (changed) measured((value) => value + 1);
      updateViewport();
    });
    observer?.observe(scroll);
    for (const wrapper of wrappers.current.values()) observer?.observe(wrapper);
    updateViewport();
    pin(document.activeElement);
    return () => {
      observer?.disconnect();
      scroll.removeEventListener("scroll", updateViewport);
      scroll.removeEventListener("focusin", focusIn);
      scroll.removeEventListener("focusout", focusOut);
      window.removeEventListener("resize", updateViewport);
      scroll.style.overflowAnchor = anchor;
    };
  });

  // A parent's host ref can attach after this child's first layout effect.
  useEffect(() => {
    if (scrollRef.current !== attachedScroll.current) measured((value) => value + 1);
  });

  useLayoutEffect(() => {
    const previous = requestedBefore.current;
    if (previous === null || previous.pages !== pages || previous.revision !== revision || !sameKeys(previous.keys, retained)) {
      requestedBefore.current = { pages, revision, keys: retained };
      // A pending keyboard destination takes precedence over nearby cache misses.
      if (target?.page.rows === null) onNeed(target.page);
      for (const { page } of layout) {
        if (retained.has(page.key) && page.rows === null && page !== target?.page) onNeed(page);
      }
    }
    const evicted = retainedBefore.current;
    if (evicted === null || evicted.pages !== pages || evicted.revision !== revision || !sameKeys(evicted.keys, retained)) {
      retainedBefore.current = { pages, revision, keys: retained };
      onEvict(new Set(retained));
    }
  });

  useLayoutEffect(() => {
    if (focusIndex === null) {
      completedFocus.current = null;
      return;
    }
    const scroll = scrollRef.current;
    if (scroll === null || target === undefined || completedFocus.current === focusIndex) return;
    const height = scroll.clientHeight || 600;
    if (target.top + target.page.height <= scroll.scrollTop || target.top >= scroll.scrollTop + height) {
      scroll.scrollTop = target.top + (focusIndex - target.index) * target.page.height / target.page.count;
      setViewport({ top: scroll.scrollTop, height });
    }
    const row = scroll.querySelector<HTMLElement>(`[data-history-index="${focusIndex}"]`);
    if (row === null) return;
    row.focus({ preventScroll: true });
    if (document.activeElement !== row) return;
    completedFocus.current = focusIndex;
    row.scrollIntoView?.({ block: "nearest" });
    onFocused();
  });

  const children: ReactNode[] = [];
  let spacerHeight = 0;
  let spacerKey = 0;
  const addSpacer = () => {
    if (spacerHeight <= 0) return;
    children.push(<div key={`spacer-${spacerKey}`} role="presentation" style={{ height: spacerHeight }} />);
    spacerHeight = 0;
  };
  for (const { page, index: firstIndex } of layout) {
    if (!retained.has(page.key)) {
      if (spacerHeight === 0) spacerKey = page.key;
      spacerHeight += page.height;
      continue;
    }
    addSpacer();
    children.push(
      <div
        key={page.key}
        role="presentation"
        data-history-page={page.key}
        ref={(node) => { if (node === null) wrappers.current.delete(page.key); else wrappers.current.set(page.key, node); }}
        style={{ display: "grid", gap: 2, paddingBottom: 2, boxSizing: "border-box", ...(page.rows === null ? { height: page.height } : {}) }}
      >
        {page.rows?.map((row, rowIndex) => renderRow(row, firstIndex + rowIndex))}
      </div>,
    );
  }
  addSpacer();
  return <div role="presentation" style={{ display: "block" }}>{children}</div>;
}
