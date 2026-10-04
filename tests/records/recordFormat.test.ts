import { describe, expect, it } from "vitest";
import {
  cursorAfter,
  formatStoredTime,
  isEmptyStoredValue,
  knownLevel,
  mergeNewestPage,
  prettyJson,
} from "../../src/records/recordFormat";
import type { RecordSummary } from "../../src/services/records";

function record(id: number, time: string): RecordSummary {
  return { id, session: "s", time, level: "info", message: `line ${id}`, op: null };
}

describe("record format", () => {
  it("indents stored JSON and shows other text as it is", () => {
    expect(prettyJson('{"op":"save","ms":3}')).toBe('{\n  "op": "save",\n  "ms": 3\n}');
    expect(prettyJson("not json")).toBe("not json");
  });

  it("calls a stored value empty only when nothing is in it", () => {
    for (const empty of ["{}", "null", "[]", '""', '"  \\n "', "", "  \n", " { } "]) {
      expect(isEmptyStoredValue(empty), empty).toBe(true);
    }
    for (const filled of ['{"ms":3}', "[0]", '"x"', "0", "false", "not json"]) {
      expect(isEmptyStoredValue(filled), filled).toBe(false);
    }
  });

  it("names the four levels and leaves any other as stored", () => {
    expect(knownLevel("warn")).toBe("warn");
    expect(knownLevel("trace")).toBeNull();
    expect(knownLevel("toString")).toBeNull();
  });

  it("shows a time that does not parse as stored", () => {
    const format = new Intl.DateTimeFormat("en", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });
    expect(formatStoredTime("2026-10-02T08:01:00.000Z", format)).toBe("08:01");
    expect(formatStoredTime("yesterday", format)).toBe("yesterday");
  });

  it("starts the next page after the last row shown", () => {
    expect(cursorAfter([])).toBeNull();
    expect(cursorAfter([record(3, "b"), record(2, "a")])).toEqual({ time: "a", id: 2 });
  });

  it("joins the newest page with the rows shown, keeping the pages already read", () => {
    const shown = [record(5, "2026-10-02T08:05"), record(4, "2026-10-02T08:04"), record(1, "2026-10-02T08:01")];
    const page = { records: [record(6, "2026-10-02T08:06"), record(5, "2026-10-02T08:05")], more: true };

    const merged = mergeNewestPage(shown, false, page);

    expect(merged.records.map((row) => row.id)).toEqual([6, 5, 4, 1]);
    // Rows shown beyond the page's end keep the more flag the list already had.
    expect(merged.more).toBe(false);
  });

  it("takes the page's more flag when it reaches past everything shown", () => {
    const shown = [record(2, "2026-10-02T08:02")];
    const page = { records: [record(3, "2026-10-02T08:03"), record(2, "2026-10-02T08:02")], more: true };
    expect(mergeNewestPage(shown, false, page).more).toBe(true);
  });

  it("orders lines with the same time by id, newest first", () => {
    const merged = mergeNewestPage([record(1, "t")], false, { records: [record(2, "t")], more: false });
    expect(merged.records.map((row) => row.id)).toEqual([2, 1]);
  });
});
