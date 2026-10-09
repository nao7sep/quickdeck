import { describe, expect, it } from "vitest";
import {
  LARGE_REMOVAL_CHARS,
  pasteReplacesText,
  removesLargeBlock,
} from "../../src/utils/snapshotBoundaries";

describe("pasteReplacesText", () => {
  it("is true only when text is selected", () => {
    expect(pasteReplacesText(2, 5)).toBe(true);
    expect(pasteReplacesText(3, 3)).toBe(false);
  });
});

describe("removesLargeBlock", () => {
  const block = "x".repeat(LARGE_REMOVAL_CHARS);

  it("is true when an edit empties the pane", () => {
    expect(removesLargeBlock("a", "")).toBe(true);
  });

  it("is false for an already empty pane", () => {
    expect(removesLargeBlock("", "")).toBe(false);
    expect(removesLargeBlock("", "typed")).toBe(false);
  });

  it("is true from the threshold up", () => {
    expect(removesLargeBlock(`keep ${block}`, "keep ")).toBe(true);
    expect(removesLargeBlock(`keep ${block}`, `keep ${block.slice(1)}`)).toBe(false);
  });

  it("is false while typing adds text", () => {
    expect(removesLargeBlock("abc", "abcd")).toBe(false);
  });
});
