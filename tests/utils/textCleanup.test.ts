import { describe, expect, it } from "vitest";
import { multiline, singleLine, truncate } from "../../src/utils/textCleanup";

// These cover the behaviors quickdeck relies on: singleLine for the pane title
// (committed on blur) and multiline for snapshot bodies (the trimSnapshotContent
// replacement). The full algorithm contract lives in the convention's verified
// reference; here we pin the cases that gate this app's call sites.

describe("singleLine (pane title on commit)", () => {
  it("trims the ends", () => {
    expect(singleLine("  hello  ")).toBe("hello");
  });

  it("flattens a pasted multi-line value into one line (default)", () => {
    // The defect this fixes: a pasted multi-line title must not leak \r/\n into
    // state.json.
    expect(singleLine("first line\nsecond line")).toBe("first line second line");
    expect(singleLine("a\r\nb")).toBe("a b");
    expect(singleLine("aaa\n \n\nbbb")).toBe("aaa bbb");
  });

  it("preserves interior horizontal spacing typed within a line", () => {
    expect(singleLine("a    b")).toBe("a    b");
  });

  it("treats a lone full-width space (U+3000) as trimmable whitespace", () => {
    // Japanese titles lean on U+3000; the built-in trim must count it.
    expect(singleLine("　hello　")).toBe("hello");
    expect(singleLine("　")).toBe("");
  });

  it("collapses to empty when the value is all whitespace", () => {
    expect(singleLine("\n\n  \n")).toBe("");
  });
});

describe("multiline (snapshot body — trimSnapshotContent replacement)", () => {
  it("returns empty for empty or whitespace-only content", () => {
    expect(multiline("")).toBe("");
    expect(multiline("   ")).toBe("");
    expect(multiline("\n\n")).toBe("");
    expect(multiline("  \n\t\n ")).toBe("");
  });

  it("drops edge blank lines but preserves interior blanks", () => {
    expect(multiline("\n\nhello\nworld\n\n")).toBe("hello\nworld");
    // The deliberate interior section break stays — collapseBlankLines is off.
    expect(multiline("a\n\nb")).toBe("a\n\nb");
    expect(multiline("a\n\n\nb")).toBe("a\n\n\nb");
  });

  it("now trims per-line trailing whitespace (the new behavior vs the old helper)", () => {
    // Old trimSnapshotContent left trailing whitespace on kept lines; the
    // canonical multiline default trims it.
    expect(multiline("  hello  ")).toBe("  hello");
    expect(multiline("a  \nb\t")).toBe("a\nb");
    // Leading indentation on a kept line is preserved.
    expect(multiline("  \n\tx\n  ")).toBe("\tx");
  });

  it("normalizes CRLF and CR line endings to LF", () => {
    expect(multiline("a\r\nb")).toBe("a\nb");
    expect(multiline("a\rb")).toBe("a\nb");
  });
});

// The snapshot list's one-line excerpt. The convention names these three as the
// cases worth pinning per app: the minimum-length contract, `truncated` honesty
// on an all-whitespace tail, and grapheme safety at an emoji boundary.
describe("truncate (snapshot row excerpt)", () => {
  it("reports a cut only when visible text follows it", () => {
    expect(truncate("hello world", 5)).toEqual({ text: "hello", truncated: true });
    expect(truncate("hello", 5)).toEqual({ text: "hello", truncated: false });
    expect(truncate("hello   ", 5)).toEqual({ text: "hello", truncated: false });
  });

  it("renders a multiline body on one line", () => {
    expect(truncate("a\nb\nc", 10)).toEqual({ text: "a b c", truncated: false });
    expect(truncate("  padded  ", 3)).toEqual({ text: "pad", truncated: true });
  });

  it("never splits an emoji or a combining sequence", () => {
    expect(truncate("\u{1F600}x", 1)).toEqual({ text: "\u{1F600}", truncated: true });
    expect(truncate("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}x", 1)).toEqual({
      text: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
      truncated: true,
    });
    expect(truncate("éllo", 2)).toEqual({ text: "él", truncated: true });
  });

  it("guards an empty body and a non-positive budget", () => {
    expect(truncate("", 5)).toEqual({ text: "", truncated: false });
    expect(truncate("   ", 5)).toEqual({ text: "", truncated: false });
    expect(truncate("hello", 0)).toEqual({ text: "", truncated: false });
  });
});
