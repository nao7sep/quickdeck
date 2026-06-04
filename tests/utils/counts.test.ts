import { describe, expect, it } from "vitest";
import { getTextCounts } from "../../src/utils/counts";

describe("getTextCounts", () => {
  it("reports zero words and chars for an empty string", () => {
    const counts = getTextCounts("");
    expect(counts.words).toBe(0);
    expect(counts.chars).toBe(0);
    expect(counts.xWeightedChars).toBe(0);
    expect(counts.xLimit).toBe(280);
  });

  it("treats whitespace-only text as zero words but counts its chars", () => {
    const counts = getTextCounts("  \n ");
    expect(counts.words).toBe(0);
    expect(counts.chars).toBe(4);
  });

  it("splits words on any run of whitespace", () => {
    expect(getTextCounts("hello").words).toBe(1);
    expect(getTextCounts("one two   three\nfour\tfive").words).toBe(5);
  });

  it("counts surrounding whitespace as chars but not as words", () => {
    const counts = getTextCounts(" hi ");
    expect(counts.chars).toBe(4);
    expect(counts.words).toBe(1);
  });

  it("counts code points, so an astral emoji is a single char", () => {
    // "😀" is two UTF-16 units; Array.from collapses it to one code point.
    expect(getTextCounts("😀").chars).toBe(1);
  });

  it("flags text over the X weighted limit as invalid", () => {
    const long = "a".repeat(281);
    const counts = getTextCounts(long);
    expect(counts.xWeightedChars).toBe(281);
    expect(counts.xValid).toBe(false);
  });

  it("treats a short tweet as valid", () => {
    expect(getTextCounts("a short post").xValid).toBe(true);
  });
});
