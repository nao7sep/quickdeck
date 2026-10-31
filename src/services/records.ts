import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { logWarn, serializeError } from "./logger";

// What the Records window reads from records.sqlite3 through the Rust core
// (src-tauri/src/records.rs): a filtered page of log lines, newest first, the
// launches that have records, and one line whole. A read writes no record of its
// own, so the live updates below cannot feed themselves.

export type RecordLevel = "debug" | "info" | "warn" | "error";

export const RECORD_LEVELS: readonly RecordLevel[] = ["error", "warn", "info", "debug"];

// What the level filter offers: a line's own level, or `warningsAndErrors`, every line
// at `warn` or `error`.
export type RecordLevelFilter = "warningsAndErrors" | RecordLevel;

export const RECORD_LEVEL_FILTERS: readonly RecordLevelFilter[] = ["warningsAndErrors", ...RECORD_LEVELS];

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
  displayZone: string;
  uiFontFamily: string;
};

export async function openRecordsWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_records_window");
}

// Asks the core for the current presentation, which it sends as an event.
export function requestPresentation(): Promise<void> {
  return invoke("records_window_setup");
}

export function recordsListWidth(): Promise<number | null> {
  return invoke<number | null>("records_list_width");
}

// The main window owns state.json, so the Records window sends it the width a
// drag ended at, and the main window's next state save writes it. A message
// between the two pages; the core neither sends nor hears it.
const RECORDS_LIST_WIDTH_MESSAGE = "records-list-width";

export function sendRecordsListWidth(width: number): Promise<void> {
  return emitTo("main", RECORDS_LIST_WIDTH_MESSAGE, width);
}

// Calls `listener` with each width the Records window sends. Returns the unsubscribe.
export function onRecordsListWidth(listener: (width: number) => void): () => void {
  return subscribe(RECORDS_LIST_WIDTH_MESSAGE, listen<number>(RECORDS_LIST_WIDTH_MESSAGE, (event) => listener(event.payload)));
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
const PRESENTATION_EVENT = "records-presentation";

// Calls `listener` after each record the database stored. Returns the unsubscribe.
export function onRecordsChanged(listener: () => void): () => void {
  return subscribe(RECORDS_CHANGED_EVENT, listen(RECORDS_CHANGED_EVENT, () => listener()));
}

// Resolves only once registration is active, so the presentation request can follow it.
export function onPresentationChanged(listener: (presentation: RecordsWindowSetup) => void): Promise<() => void> {
  return listen<RecordsWindowSetup>(PRESENTATION_EVENT, (event) => listener(event.payload));
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
