import { describe, expect, it } from "vitest";
import { createTranslator } from "../../src/i18n/translate";
import { formatSnapshotTimestamp } from "../../src/utils/snapshotTimestamp";

// Display is local time; pin a fixed, DST-free zone so the output is
// deterministic regardless of where the suite runs.
process.env.TZ = "Asia/Tokyo";

describe("formatSnapshotTimestamp", () => {
  it("shows a canonical ISO instant in local time, in the given locale's format", () => {
    // 03:15 UTC is 12:15 in Asia/Tokyo (+9).
    const instant = "2026-06-10T03:15:42.123Z";
    expect(formatSnapshotTimestamp(instant, createTranslator("en", "en-US").dateTime)).toBe(
      "Jun 10, 2026, 12:15 PM",
    );
    expect(formatSnapshotTimestamp(instant, createTranslator("ja").dateTime)).toBe("2026/06/10 12:15");
    expect(formatSnapshotTimestamp(instant, createTranslator("de").dateTime)).toBe("10.06.2026, 12:15");
  });

  it("passes an unparseable value through unchanged", () => {
    expect(formatSnapshotTimestamp("not-a-date", createTranslator("en").dateTime)).toBe("not-a-date");
  });
});
