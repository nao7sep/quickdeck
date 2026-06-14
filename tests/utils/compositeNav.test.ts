import { describe, expect, it } from "vitest";
import { indexOfId, nextIndex, verticalTablistDirection } from "../../src/utils/compositeNav";

describe("nextIndex", () => {
  it("steps forward and backward one item at a time", () => {
    expect(nextIndex("next", 1, 4)).toBe(2);
    expect(nextIndex("prev", 2, 4)).toBe(1);
  });

  it("stops at the ends rather than wrapping", () => {
    expect(nextIndex("next", 3, 4)).toBe(3);
    expect(nextIndex("prev", 0, 4)).toBe(0);
  });

  it("enters at the first item on next and the last on prev when nothing is current", () => {
    expect(nextIndex("next", -1, 4)).toBe(0);
    expect(nextIndex("prev", -1, 4)).toBe(3);
  });

  it("jumps to the ends with first/last regardless of the current index", () => {
    expect(nextIndex("first", 2, 4)).toBe(0);
    expect(nextIndex("last", 1, 4)).toBe(3);
    expect(nextIndex("first", -1, 4)).toBe(0);
    expect(nextIndex("last", -1, 4)).toBe(3);
  });

  it("stays on the only item in a single-item set", () => {
    expect(nextIndex("next", 0, 1)).toBe(0);
    expect(nextIndex("prev", 0, 1)).toBe(0);
    expect(nextIndex("first", 0, 1)).toBe(0);
    expect(nextIndex("last", 0, 1)).toBe(0);
  });

  it("returns -1 for an empty set", () => {
    expect(nextIndex("next", -1, 0)).toBe(-1);
    expect(nextIndex("prev", -1, 0)).toBe(-1);
    expect(nextIndex("first", -1, 0)).toBe(-1);
    expect(nextIndex("last", -1, 0)).toBe(-1);
  });
});

describe("indexOfId", () => {
  const ids = ["a", "b", "c"];

  it("returns the index of a present id", () => {
    expect(indexOfId(ids, "b")).toBe(1);
  });

  it("returns -1 for a missing, null, or undefined id", () => {
    expect(indexOfId(ids, "missing")).toBe(-1);
    expect(indexOfId(ids, null)).toBe(-1);
    expect(indexOfId(ids, undefined)).toBe(-1);
  });
});

describe("verticalTablistDirection", () => {
  it("maps Down and Right to next and Up and Left to prev", () => {
    expect(verticalTablistDirection("ArrowDown")).toBe("next");
    expect(verticalTablistDirection("ArrowRight")).toBe("next");
    expect(verticalTablistDirection("ArrowUp")).toBe("prev");
    expect(verticalTablistDirection("ArrowLeft")).toBe("prev");
  });

  it("maps Home and End to first and last", () => {
    expect(verticalTablistDirection("Home")).toBe("first");
    expect(verticalTablistDirection("End")).toBe("last");
  });

  it("returns null for keys that are not navigation keys", () => {
    expect(verticalTablistDirection("Enter")).toBeNull();
    expect(verticalTablistDirection(" ")).toBeNull();
    expect(verticalTablistDirection("Escape")).toBeNull();
    expect(verticalTablistDirection("a")).toBeNull();
  });
});
