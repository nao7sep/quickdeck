import { describe, expect, it } from "vitest";
import {
  cursorAfter,
  formatStoredTime,
  isEmptyStoredValue,
  knownLevel,
  pageReachesRecord,
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

  it("requires a refresh to reach the prior newest row, including timestamp ties", () => {
    const anchor = record(100, "t");
    expect(pageReachesRecord({ records: [record(300, "t"), record(201, "t")], more: true }, anchor)).toBe(false);
    expect(pageReachesRecord({ records: [record(200, "t"), anchor], more: true }, anchor)).toBe(true);
    expect(pageReachesRecord({ records: [record(99, "t")], more: true }, anchor)).toBe(true);
    expect(pageReachesRecord({ records: [record(300, "t")], more: false }, anchor)).toBe(true);
    expect(pageReachesRecord({ records: [record(300, "t")], more: true }, null)).toBe(true);
  });
});
