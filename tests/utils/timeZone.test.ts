import { afterEach, describe, expect, it, vi } from "vitest";
import { isDisplayZone, resolveTimeZone, systemTimeZone, timeZones } from "../../src/utils/timeZone";
import { createTranslator } from "../../src/i18n/translate";

afterEach(() => vi.restoreAllMocks());

// timestamp-conventions, Time zones: System follows the computer, any other
// value is a zone from the platform's list.
describe("display zone", () => {
  it("resolves System to the computer's zone and keeps a chosen zone", () => {
    expect(resolveTimeZone("system")).toBe(systemTimeZone());
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("falls back to UTC when the platform cannot name the computer's zone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation((() => ({
      resolvedOptions: () => ({ timeZone: "" }),
    })) as unknown as typeof Intl.DateTimeFormat);
    expect(systemTimeZone()).toBe("UTC");
  });

  it("accepts System and the platform's zones, nothing typed", () => {
    expect(timeZones()).toContain("UTC");
    expect(isDisplayZone("system")).toBe(true);
    expect(isDisplayZone("Asia/Tokyo")).toBe(true);
    expect(isDisplayZone("JST")).toBe(false);
    expect(isDisplayZone("Mars/Olympus")).toBe(false);
    expect(isDisplayZone(9)).toBe(false);
  });

  it("formats shown times in the chosen zone", () => {
    const moment = new Date("2026-01-01T00:30:00Z");
    expect(createTranslator("en", "en-US", "UTC").dateTime(moment)).toContain("12:30");
    expect(createTranslator("en", "en-US", "Asia/Tokyo").dateTime(moment)).toContain("9:30");
  });
});
