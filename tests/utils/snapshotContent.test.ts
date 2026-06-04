import { describe, expect, it } from "vitest";
import { trimSnapshotContent } from "../../src/utils/snapshotContent";

describe("trimSnapshotContent", () => {
  it("returns empty for empty or whitespace-only content", () => {
    expect(trimSnapshotContent("")).toBe("");
    expect(trimSnapshotContent("   ")).toBe("");
    expect(trimSnapshotContent("\n\n")).toBe("");
    expect(trimSnapshotContent("  \n\t\n ")).toBe("");
  });

  it("strips leading and trailing blank lines but keeps interior blanks", () => {
    expect(trimSnapshotContent("\n\nhello\nworld\n\n")).toBe("hello\nworld");
    expect(trimSnapshotContent("a\n\nb")).toBe("a\n\nb");
  });

  it("does not trim within a kept line", () => {
    expect(trimSnapshotContent("  hello  ")).toBe("  hello  ");
    expect(trimSnapshotContent("  \n\tx\n  ")).toBe("\tx");
  });

  it("normalizes CRLF and CR line endings to LF", () => {
    expect(trimSnapshotContent("a\r\nb")).toBe("a\nb");
    expect(trimSnapshotContent("a\rb")).toBe("a\nb");
  });
});
