import type { MessageKey } from "../i18n/catalogues";
import type { RecordCursor, RecordLevel, RecordLevelFilter, RecordsPage, RecordSummary } from "../services/records";

// A stored instant in the reader's time zone and format; one that does not
// parse is shown as stored.
export function formatStoredTime(raw: string, format: Intl.DateTimeFormat): string {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : format.format(date);
}

// Stored JSON, indented for reading; text that is not JSON is shown as it is.
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

// A stored value with nothing in it: blank text, or JSON that is null, an empty
// object or array, or a string of only whitespace. Its block is left out.
export function isEmptyStoredValue(text: string): boolean {
  if (text.trim() === "") return true;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return false;
  }
  if (value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

export const LEVEL_LABELS: Record<RecordLevel, MessageKey> = {
  error: "records.levelError",
  warn: "records.levelWarn",
  info: "records.levelInfo",
  debug: "records.levelDebug",
};

export const LEVEL_FILTER_LABELS: Record<RecordLevelFilter, MessageKey> = {
  attention: "records.levelAttention",
  ...LEVEL_LABELS,
};

// A stored level the window knows, or null for one written by hand or by an
// older build, which is then shown as stored.
export function knownLevel(level: string): RecordLevel | null {
  return Object.hasOwn(LEVEL_LABELS, level) ? (level as RecordLevel) : null;
}

// The page after the last record shown.
export function cursorAfter(records: readonly RecordSummary[]): RecordCursor | null {
  const last = records.at(-1);
  return last === undefined ? null : { time: last.time, id: last.id };
}

// The order the list shows records in, newest first; the database pages them
// the same way.
function newestFirst(a: RecordSummary, b: RecordSummary): number {
  if (a.time !== b.time) return a.time < b.time ? 1 : -1;
  return b.id - a.id;
}

// The newest page read again, joined with the rows already shown: a row in both
// takes the page's copy, and the rows shown beyond the page stay, so the pages
// already read are kept and a page read out of order loses nothing.
export function mergeNewestPage(
  shown: readonly RecordSummary[],
  shownMore: boolean,
  page: RecordsPage,
): { records: RecordSummary[]; more: boolean } {
  const byId = new Map(shown.map((record) => [record.id, record]));
  for (const record of page.records) byId.set(record.id, record);
  const records = [...byId.values()].sort(newestFirst);
  const last = page.records.at(-1);
  const beyond = last !== undefined && shown.some((record) => newestFirst(record, last) > 0);
  return { records, more: beyond ? shownMore : page.more };
}
