import { describe, expect, it } from "vitest";
import {
  nextSelectionIndex,
} from "../../src/utils/snapshotSelection";

describe("nextSelectionIndex", () => {
  it("moves the cursor one row at a time", () => {
    expect(nextSelectionIndex(0, "ArrowDown", 3)).toBe(1);
    expect(nextSelectionIndex(2, "ArrowUp", 3)).toBe(1);
  });

  it("stops at the ends instead of wrapping", () => {
    expect(nextSelectionIndex(2, "ArrowDown", 3)).toBeNull();
    expect(nextSelectionIndex(0, "ArrowUp", 3)).toBeNull();
  });

  it("jumps to either end", () => {
    expect(nextSelectionIndex(1, "Home", 3)).toBe(0);
    expect(nextSelectionIndex(1, "End", 3)).toBe(2);
  });

  it("enters the list from the near end when nothing is selected", () => {
    expect(nextSelectionIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextSelectionIndex(-1, "ArrowUp", 3)).toBe(2);
  });

  it("ignores keys the list does not own, and an empty list", () => {
    expect(nextSelectionIndex(0, "Enter", 3)).toBeNull();
    expect(nextSelectionIndex(0, "a", 3)).toBeNull();
    expect(nextSelectionIndex(-1, "ArrowDown", 0)).toBeNull();
  });
});
