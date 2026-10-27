import { describe, expect, it } from "vitest";
import {
  nextSelectionIndex,
  selectionAfterRowsChange,
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

describe("selectionAfterRowsChange", () => {
  it("keeps the snapshot the user is reading when it survives the change", () => {
    expect(selectionAfterRowsChange(["a", "b", "c"], "b")).toBe("b");
  });

  it("falls back to the top when the selection is gone", () => {
    expect(selectionAfterRowsChange(["a", "b"], "z")).toBe("a");
  });

  it("starts at the top when nothing was selected", () => {
    expect(selectionAfterRowsChange(["a", "b"], null)).toBe("a");
  });

  it("selects nothing when the list is empty", () => {
    expect(selectionAfterRowsChange([], "a")).toBeNull();
  });
});
