import { describe, it, expect } from "vitest";
import { backupTimestamp, toIsoSeconds } from "../../../src/services/backup/backupTime";

describe("backupTimestamp", () => {
  it("formats an instant as yyyymmdd-hhmmss-fff-utc in UTC", () => {
    const ms = Date.UTC(2026, 6, 1, 2, 22, 20, 123); // 2026-07-01T02:22:20.123Z
    expect(backupTimestamp(ms)).toBe("20260701-022220-123-utc");
  });

  it("zero-pads every field, including milliseconds", () => {
    const ms = Date.UTC(2026, 0, 5, 3, 4, 9, 7); // 2026-01-05T03:04:09.007Z
    expect(backupTimestamp(ms)).toBe("20260105-030409-007-utc");
  });
});

describe("toIsoSeconds", () => {
  it("truncates milliseconds to a whole-second Z timestamp", () => {
    const ms = Date.UTC(2026, 6, 1, 2, 22, 20) + 987;
    expect(toIsoSeconds(ms)).toBe("2026-07-01T02:22:20Z");
  });

  it("leaves an already-whole-second instant unchanged", () => {
    const ms = Date.UTC(2026, 6, 1, 2, 22, 20);
    expect(toIsoSeconds(ms)).toBe("2026-07-01T02:22:20Z");
  });
});
