import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { logWarn, serializeError } from "./logger";

// What the Records window reads from records.sqlite3 through the Rust core
// (src-tauri/src/records.rs): a filtered page of log lines, newest first, the
// launches that have records, and one line whole. A read writes no record of its
// own, so the live updates below cannot feed themselves.

export type RecordLevel = "debug" | "info" | "warn" | "error";

export const RECORD_LEVELS: readonly RecordLevel[] = ["error", "warn", "info", "debug"];

// What the level filter offers: a line's own level, or `attention`, every line
// at `warn` or `error`.
export type RecordLevelFilter = "attention" | RecordLevel;

export const RECORD_LEVEL_FILTERS: readonly RecordLevelFilter[] = ["attention", ...RECORD_LEVELS];

// Where the next page starts: the last line of the page before it.
export type RecordCursor = { time: string; id: number };

export type RecordsQuery = {
  // A launch, named by its session.
  session: string | null;
  level: RecordLevelFilter | null;
  search: string;
  after: RecordCursor | null;
};

export type RecordSummary = {
  id: number;
  session: string;
  time: string;
  // As stored; the window shows the four levels it knows.
  level: string;
  message: string;
  // The operation a boundary line names.
  op: string | null;
};

export type RecordsPage = { records: RecordSummary[]; more: boolean };

export type RecordDetail = {
  id: number;
  session: string;
  time: string;
  level: string;
  message: string;
  paneId: string | null;
  snapshotId: string | null;
  // The JSON text the line holds.
  fields: string;
};

export type RecordSources = { currentSession: string; sessions: string[] };

export type RecordsWindowSetup = {
  language: string;
  systemLocale: string | null;
  listWidth: number | null;
};

export async function openRecordsWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_records_window");
}

export function recordsWindowSetup(): Promise<RecordsWindowSetup> {
  return invoke<RecordsWindowSetup>("records_window_setup");
}

export function saveRecordsListWidth(width: number): Promise<void> {
  return invoke("save_records_list_width", { width });
}

export function readRecordsPage(query: RecordsQuery): Promise<RecordsPage> {
  return invoke<RecordsPage>("read_records_page", { query });
}

export function readRecordDetail(id: number): Promise<RecordDetail | null> {
  return invoke<RecordDetail | null>("read_record_detail", { id });
}

export function readRecordSources(): Promise<RecordSources> {
  return invoke<RecordSources>("read_record_sources");
}

// The event names the Rust core sends the window (src-tauri/src/records_window.rs).
const RECORDS_CHANGED_EVENT = "records-changed";
const LANGUAGE_EVENT = "records-language";

// Calls `listener` after each record the database stored. Returns the unsubscribe.
export function onRecordsChanged(listener: () => void): () => void {
  return subscribe(RECORDS_CHANGED_EVENT, listen(RECORDS_CHANGED_EVENT, () => listener()));
}

// Calls `listener` with the language tag when a saved change moves it.
export function onLanguageChanged(listener: (language: string) => void): () => void {
  return subscribe(LANGUAGE_EVENT, listen<string>(LANGUAGE_EVENT, (event) => listener(event.payload)));
}

// A listener registers asynchronously; one unsubscribed before that settles is
// removed as soon as it does.
function subscribe(event: string, registration: Promise<() => void>): () => void {
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void registration.then(
    (stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    },
    // The window then does not follow; with no listener, the record this
    // writes cannot signal it.
    (error) => logWarn("records listener failed", { event, error: serializeError(error) }),
  );
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
