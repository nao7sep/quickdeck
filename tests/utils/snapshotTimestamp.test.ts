import { describe, expect, it } from "vitest";
import { formatSnapshotTimestamp } from "../../src/utils/snapshotTimestamp";

// Display is local time; pin a fixed, DST-free zone so the output is
// deterministic regardless of where the suite runs.
process.env.TZ = "Asia/Tokyo";

describe("formatSnapshotTimestamp", () => {
  it("converts a canonical ISO instant to local yyyy-mm-dd HH:mm", () => {
    // 03:15 UTC is 12:15 in Asia/Tokyo (+9).
    expect(formatSnapshotTimestamp("2026-06-10T03:15:42.123Z")).toBe("2026-06-10 12:15");
  });

  it("zero-pads single-digit month, day, hour, and minute", () => {
    // 2026-01-02T00:04:00Z is 09:04 in Tokyo, same day.
    expect(formatSnapshotTimestamp("2026-01-02T00:04:00.000Z")).toBe("2026-01-02 09:04");
  });

  it("passes an unparseable value through unchanged", () => {
    expect(formatSnapshotTimestamp("not-a-date")).toBe("not-a-date");
  });
});
