// @vitest-environment jsdom
import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryPages, type HistoryPage } from "../../src/components/HistoryPages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Page = HistoryPage<string, number>;
let root: Root | null = null;
let height = 100;
const observers = new Set<TestResizeObserver>();
class TestResizeObserver {
  readonly targets = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) { observers.add(this); }
  observe(target: Element) { this.targets.add(target); }
  disconnect() { observers.delete(this); }
}
const scrollIntoView = vi.fn();

beforeEach(() => {
  height = 100;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => height });
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
  observers.clear();
  vi.unstubAllGlobals();
});

function pages(count = 500): Page[] {
  return Array.from({ length: count }, (_, key) => ({
    key, cursor: key, count: 5, height: 100,
    rows: Array.from({ length: 5 }, (_, index) => `${key}-${index}`),
  }));
}

async function mount(initial = pages()) {
  const scrollRef = createRef<HTMLDivElement>();
  const onNeed = vi.fn<(page: Page) => void>();
  const onEvict = vi.fn<(keys: Set<number>) => void>();
  const onFocused = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  let current = initial;
  let revision = 0;
  let focusIndex: number | null = null;
  let attached = true;
  const render = async (options: { pages?: Page[]; focusIndex?: number | null; attached?: boolean; revision?: number } = {}) => {
    current = options.pages ?? current;
    revision = options.revision ?? revision;
    if ("focusIndex" in options) focusIndex = options.focusIndex!;
    attached = options.attached ?? attached;
    await act(async () => root?.render(
      <>
        <button id="outside">Outside</button>
        <div ref={attached ? scrollRef : undefined}>
          <HistoryPages
            pages={current}
            scrollRef={scrollRef}
            revision={revision}
            renderRow={(row, index) => <div key={row} tabIndex={-1} data-history-index={index}>{row}</div>}
            onNeed={(page) => onNeed(page)}
            onEvict={(keys) => onEvict(keys)}
            focusIndex={focusIndex}
            onFocused={() => onFocused()}
          />
        </div>
      </>,
    ));
  };
  await render();
  return { scrollRef, onNeed, onEvict, onFocused, render };
}

async function scrollTo(node: HTMLDivElement, top: number) {
  await act(async () => {
    node.scrollTop = top;
    node.dispatchEvent(new Event("scroll"));
  });
}

function mountedKeys(): number[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-history-page]"), (node) => Number(node.dataset.historyPage));
}

async function measure(node: Element, measuredHeight: number) {
  await act(async () => {
    for (const observer of [...observers]) {
      if (observer.targets.has(node)) observer.callback([
        { target: node, contentRect: { height: measuredHeight }, borderBoxSize: [] } as unknown as ResizeObserverEntry,
      ], observer as unknown as ResizeObserver);
    }
  });
}

describe("HistoryPages", () => {
  it("keeps hundreds of pages to a bounded DOM and retained-key set with contiguous spacers", async () => {
    const original = pages();
    const { scrollRef, onEvict, render } = await mount(original);
    expect(mountedKeys()).toEqual([0, 1]);
    expect(document.querySelectorAll("[data-history-index]")).toHaveLength(10);
    let keep = onEvict.mock.calls.at(-1)![0];
    expect([...keep]).toEqual([0, 1]);
    const cached = original.map((page) => keep.has(page.key) ? page : { ...page, rows: null });
    await render({ pages: cached, revision: 1 });
    await scrollTo(scrollRef.current!, 25000);
    expect(mountedKeys()).toEqual([249, 250, 251]);
    keep = onEvict.mock.calls.at(-1)![0];
    expect(keep.size).toBe(3);
    const history = scrollRef.current!.firstElementChild!;
    // The two distant runs are two spacers, independent of their page counts.
    expect(history.children).toHaveLength(5);
    expect([...history.children].every((node) => node.getAttribute("role") === "presentation")).toBe(true);
    const spacers = [...history.children].filter((node) => !node.hasAttribute("data-history-page"));
    expect(spacers.map((node) => (node as HTMLElement).style.height)).toEqual(["24900px", "24800px"]);
  });

  it("requests missing deep pages and does not repeat because callback identities change", async () => {
    const missing = pages().map((page) => ({ ...page, rows: null }));
    const { scrollRef, onNeed, render } = await mount(missing);
    onNeed.mockClear();
    await scrollTo(scrollRef.current!, 25000);
    expect(onNeed.mock.calls.map(([page]) => page.cursor)).toEqual([249, 250, 251]);
    await render();
    expect(onNeed).toHaveBeenCalledTimes(3);
    await render({ revision: 1 });
    expect(onNeed).toHaveBeenCalledTimes(6);
  });

  it("pins the currently focused page until focus leaves the list", async () => {
    const { scrollRef, onEvict } = await mount();
    const row = document.querySelector<HTMLElement>('[data-history-index="0"]')!;
    await act(async () => row.focus());
    await scrollTo(scrollRef.current!, 25000);
    expect(mountedKeys()).toEqual([0, 249, 250, 251]);
    expect(document.activeElement).toBe(row);
    expect(onEvict.mock.calls.at(-1)![0].has(0)).toBe(true);
    await act(async () => document.getElementById("outside")!.focus());
    expect(mountedKeys()).toEqual([249, 250, 251]);
    expect(onEvict.mock.calls.at(-1)![0].has(0)).toBe(false);
  });

  it("refetches a pending keyboard destination before focusing its logical row index", async () => {
    const original = pages(100);
    const missing = original.map((page) => page.key === 90 ? { ...page, rows: null } : page);
    const { scrollRef, onNeed, onFocused, render } = await mount(missing);
    await render({ focusIndex: 452 });
    expect(onNeed.mock.calls.some(([page]) => page.key === 90)).toBe(true);
    expect(scrollRef.current!.scrollTop).toBe(9040);
    expect(mountedKeys()).toContain(90);
    expect(onFocused).not.toHaveBeenCalled();
    await render({ pages: original, revision: 1 });
    const row = document.querySelector<HTMLElement>('[data-history-index="452"]')!;
    expect(document.activeElement).toBe(row);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(onFocused).toHaveBeenCalledOnce();
    await render();
    expect(onFocused).toHaveBeenCalledOnce();
  });

  it("keeps logical indices across unloaded pages and never steals focus without a destination", async () => {
    const original = pages(100).map((page) => page.key < 50 ? { ...page, rows: null } : page);
    const { scrollRef, onFocused } = await mount(original);
    const outside = document.getElementById("outside")!;
    await act(async () => outside.focus());
    await scrollTo(scrollRef.current!, 5000);
    expect(document.querySelector('[data-history-index="250"]')?.textContent).toBe("50-0");
    expect(document.activeElement).toBe(outside);
    expect(onFocused).not.toHaveBeenCalled();
  });

  it("measures positive heights and compensates changes above the viewport", async () => {
    const original = pages(100);
    const { scrollRef } = await mount(original);
    await scrollTo(scrollRef.current!, 150);
    const above = document.querySelector('[data-history-page="0"]')!;
    expect(scrollRef.current!.style.overflowAnchor).toBe("none");
    await measure(above, 160);
    expect(original[0].height).toBe(160);
    expect(scrollRef.current!.scrollTop).toBe(210);
    await measure(above, 0);
    expect(original[0].height).toBe(160);
    const below = document.querySelector('[data-history-page="2"]')!;
    await measure(below, 140);
    expect(original[2].height).toBe(140);
    expect(scrollRef.current!.scrollTop).toBe(210);
    const wrapper = above as HTMLElement;
    expect(wrapper.style.display).toBe("grid");
    expect(wrapper.style.gap).toBe("2px");
  });

  it("observes viewport resizing and a ref attached after the loading frame", async () => {
    const { scrollRef, render } = await mount();
    await render({ attached: false });
    await render({ attached: true });
    await scrollTo(scrollRef.current!, 2000);
    expect(mountedKeys()).toEqual([19, 20, 21]);
    height = 200;
    await measure(scrollRef.current!, 200);
    expect(mountedKeys()).toEqual([18, 19, 20, 21, 22, 23]);
  });

  it("uses a viewport estimate until layout has a positive height", async () => {
    height = 0;
    await mount();
    expect(mountedKeys()).toHaveLength(12);
  });
  it("repeats cache eviction for an offscreen append even when visible keys stay the same", async () => {
    const original = pages(100);
    const { onEvict, render } = await mount(original);
    onEvict.mockClear();
    const appended = [...original, { key: 100, cursor: 100, count: 1, height: 20, rows: ["appended"] }];
    await render({ pages: appended });
    expect(onEvict).toHaveBeenCalledOnce();
    expect([...onEvict.mock.calls[0][0]]).toEqual([0, 1]);
    await render();
    expect(onEvict).toHaveBeenCalledOnce();
  });

  it("keeps short content mounted when an external scroll position exceeds its height", async () => {
    const { scrollRef } = await mount(pages(1));
    await scrollTo(scrollRef.current!, 800);
    expect(mountedKeys()).toEqual([0]);
    expect(document.querySelectorAll("[data-history-index]")).toHaveLength(5);
  });

  it("unpins a row blurred without a new focus target", async () => {
    const { scrollRef } = await mount();
    const row = document.querySelector<HTMLElement>('[data-history-index="0"]')!;
    await act(async () => row.focus());
    await scrollTo(scrollRef.current!, 25000);
    expect(mountedKeys()).toContain(0);
    await act(async () => row.blur());
    expect(mountedKeys()).not.toContain(0);
  });

});
