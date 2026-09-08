import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  handlePassiveScrollKey,
  passiveScrollRegionProps,
  planPassiveScrollTop,
} from "../../src/utils/passiveScroll";

describe("planPassiveScrollTop", () => {
  const base = {
    shiftKey: false,
    scrollTop: 100,
    scrollHeight: 1_000,
    clientHeight: 200,
  };

  it("moves by a line or viewport and clamps at the boundaries", () => {
    expect(planPassiveScrollTop({ ...base, key: "ArrowDown" })).toBe(140);
    expect(planPassiveScrollTop({ ...base, key: "PageDown" })).toBe(300);
    expect(planPassiveScrollTop({ ...base, key: "Home" })).toBe(0);
    expect(planPassiveScrollTop({ ...base, key: "End" })).toBe(800);
    expect(
      planPassiveScrollTop({ ...base, key: "PageDown", scrollTop: 750 }),
    ).toBe(800);
  });

  it("uses Space and Shift+Space for opposite page directions", () => {
    expect(planPassiveScrollTop({ ...base, key: " " })).toBe(300);
    expect(planPassiveScrollTop({ ...base, key: " ", shiftKey: true })).toBe(0);
  });

  it("ignores unrelated keys and regions without overflow", () => {
    expect(planPassiveScrollTop({ ...base, key: "Enter" })).toBeNull();
    expect(
      planPassiveScrollTop({
        ...base,
        key: "PageDown",
        scrollHeight: 200,
      }),
    ).toBeNull();
  });
});

describe("handlePassiveScrollKey", () => {
  function event(
    owner: HTMLElement,
    target: EventTarget = owner,
    overrides: {
      defaultPrevented?: boolean;
      metaKey?: boolean;
      ctrlKey?: boolean;
      altKey?: boolean;
      isComposing?: boolean;
    } = {},
  ): ReactKeyboardEvent<HTMLElement> {
    return {
      key: "PageDown",
      shiftKey: false,
      metaKey: overrides.metaKey ?? false,
      ctrlKey: overrides.ctrlKey ?? false,
      altKey: overrides.altKey ?? false,
      defaultPrevented: overrides.defaultPrevented ?? false,
      target,
      currentTarget: owner,
      nativeEvent: { isComposing: overrides.isComposing ?? false },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as ReactKeyboardEvent<HTMLElement>;
  }

  it("scrolls and contains a key handled by the focused owner", () => {
    const owner = {
      scrollTop: 100,
      scrollHeight: 1_000,
      clientHeight: 200,
    } as HTMLElement;
    const key = event(owner);

    handlePassiveScrollKey(key);

    expect(owner.scrollTop).toBe(300);
    expect(key.preventDefault).toHaveBeenCalledOnce();
    expect(key.stopPropagation).toHaveBeenCalledOnce();
  });

  it("stands down when a descendant owns the key", () => {
    const owner = {
      scrollTop: 100,
      scrollHeight: 1_000,
      clientHeight: 200,
    } as HTMLElement;
    const key = event(owner, {} as EventTarget);

    handlePassiveScrollKey(key);

    expect(owner.scrollTop).toBe(100);
    expect(key.preventDefault).not.toHaveBeenCalled();
    expect(key.stopPropagation).not.toHaveBeenCalled();
  });

  it.each([
    { defaultPrevented: true },
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
    { isComposing: true },
  ])("stands down for already-owned, modified, or composing input: %o", (overrides) => {
    const owner = {
      scrollTop: 100,
      scrollHeight: 1_000,
      clientHeight: 200,
    } as HTMLElement;
    const key = event(owner, owner, overrides);

    handlePassiveScrollKey(key);

    expect(owner.scrollTop).toBe(100);
    expect(key.preventDefault).not.toHaveBeenCalled();
    expect(key.stopPropagation).not.toHaveBeenCalled();
  });
});

describe("passiveScrollRegionProps", () => {
  it("creates one labelled, reachable passive owner", () => {
    const props = passiveScrollRegionProps("History");

    expect(props).toMatchObject({
      "aria-label": "History",
      "data-passive-scroll-region": "",
      role: "region",
      tabIndex: 0,
      onKeyDown: handlePassiveScrollKey,
    });
  });
});
