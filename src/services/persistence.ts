import { message, type Message } from "../i18n/translate";
import type { ConfigSets } from "../state/normalize";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Pane, SnapshotTrigger } from "../types";

// Pure view/session state — its own store (state.json), whose unreadable copy
// takes defaults and is replaced by the next save, because every field is
// rebuildable by use. The Rust core records
// and checks every store's format version, so no file type here carries one.
export type StateFile = {
  activePaneId: string;
  // The webview zoom — a view adjustment, so it is state, never config
  // (persisted-store-separation conventions).
  zoomLevel: number;
  // The Records window's list width, which that window sends here when a drag
  // ends; absent until one does.
  recordsListWidth?: number;
};

// The panes' text and identity — the user's work product, its own store
// (panes.json) whose unreadable copy stops the launch and is left in place.
export type PanesFile = {
  panes: Pane[];
};

// A file the Rust core left exactly as it is: `newer` is the version a newer
// build recorded, or null when the file could not be read.
export type RefusedFile = {
  path: string;
  newer: number | null;
};

export type LoadedAppData = {
  config: Record<string, unknown> | null;
  state: StateFile | null;
  panes: PanesFile | null;
  // Every file the launch stops on. When any is listed, the app shows them and
  // nothing else; `config` is still given when it could be read, so the stop
  // speaks the saved language.
  refused: RefusedFile[];
  // Unreadable records or backup databases, off for this session.
  off: RefusedFile[];
  dataDir: string;
  // Whether developer-only debug logging is on (resolved by the Rust core).
  // The computer's language resolved to a supported tag, and its regional
  // locale for dates and numbers, both read by the Rust core at launch.
  systemLanguage: string;
  systemLocale: string | null;
};

export type SnapshotWriteInput = {
  paneId: string;
  // The pane's title when the copy was taken. A deleted pane cannot be asked for its
  // name later, so the copy carries it.
  paneTitle: string;
  trigger: SnapshotTrigger;
  content: string;
};

export type SnapshotWriteResult = {
  inserted: boolean;
  id: string | null;
};

export type SnapshotRow = {
  id: string;
  // Which pane the text was captured from, and what that pane was called at the time.
  // The title is empty when the pane had none.
  paneId: string;
  paneTitle: string;
  createdAtUtc: string;
  content: string;
};

export type SnapshotListResult = {
  rows: SnapshotRow[];
  hasMore: boolean;
};

export function buildStateFile(
  activePaneId: string,
  zoomLevel: number,
  recordsListWidth: number | null = null,
): StateFile {
  return {
    activePaneId,
    zoomLevel,
    ...(recordsListWidth === null ? {} : { recordsListWidth }),
  };
}

export function buildPanesFile(panes: Pane[]): PanesFile {
  return {
    panes,
  };
}

export async function loadAppData(): Promise<LoadedAppData> {
  if (!isTauri()) {
    return {
      config: null,
      state: null,
      panes: null,
      refused: [],
      off: [],
      dataDir: "Browser preview",
      systemLanguage: "en",
      systemLocale: null,
    };
  }

  return invoke<LoadedAppData>("load_app_data");
}

export type LaunchLanguage = {
  language: string;
  systemLanguage: string;
  systemLocale: string | null;
};

// The language the native menu speaks, read without touching the data folder,
// for a halt screen after a load that failed.
export async function launchLanguage(): Promise<LaunchLanguage> {
  if (!isTauri()) return { language: "en", systemLanguage: "en", systemLocale: null };
  return invoke<LaunchLanguage>("launch_language");
}

// The store a failed load stopped at, when the Rust core named one: the path is
// presentation data, and the failure's message stays diagnostic.
export function loadFailurePath(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("path" in error)) {
    return null;
  }
  return typeof error.path === "string" ? error.path : null;
}

// Named native refusal; diagnostic text is never presented as product copy.
export function saveFailureMessage(error: unknown): Message | null {
  if (typeof error !== "object" || error === null || !("path" in error) || !("newer" in error)) return null;
  return typeof error.path === "string" && typeof error.newer === "number"
    ? message("saveError.panesNewer", { path: error.path, version: error.newer }) : null;
}

// Rebuilds the native menu in the interface language (the Rust core built it in
// the saved language before the window was shown).
export async function applyLanguage(language: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("apply_language", { language });
}

// Shares the committed display zone and UI font with an open Records window.
export async function applyDisplayPreferences(zone: string, uiFontFamily: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("apply_display_preferences", { zone, uiFontFamily });
}

// The OS appearance, which Settings shows as System's current value.
export async function systemTheme(): Promise<"light" | "dark"> {
  if (!isTauri()) {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return (await invoke<string>("system_theme")) === "dark" ? "dark" : "light";
}

// Snapshot mutations all matter, so each keeps its place until physical settlement.
function makeWriteQueue() {
  let queue: Promise<unknown> = Promise.resolve();
  return <R>(command: string, payload?: Record<string, unknown>): Promise<R> => {
    // The returned rejection belongs to the caller; only queue advancement
    // consumes it. A caller timeout does not release this ordering claim.
    const write = queue.catch(() => {}).then(() => invoke<R>(command, payload));
    queue = write;
    return write;
  };
}

// File saves replace the whole file. While one write settles, retain only the
// newest pending payload; its shared promise covers every superseded caller.
// Caller deadlines never release the active write's ownership of the file.
function makeReplacementWriteQueue() {
  type Write = {
    command: string;
    payload: Record<string, unknown> | undefined;
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  };
  let active = false;
  let pending: Write | null = null;

  async function run(write: Write): Promise<void> {
    try {
      write.resolve(await invoke(write.command, write.payload));
    } catch (error) {
      write.reject(error);
    } finally {
      const next = pending;
      pending = null;
      if (next) {
        void run(next);
      } else {
        active = false;
      }
    }
  }

  return <R>(command: string, payload?: Record<string, unknown>): Promise<R> => {
    if (pending) {
      pending.command = command;
      pending.payload = payload;
      return pending.promise as Promise<R>;
    }

    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((resolveWrite, rejectWrite) => {
      resolve = resolveWrite;
      reject = rejectWrite;
    });
    const write: Write = { command, payload, promise, resolve, reject };
    if (active) {
      pending = write;
    } else {
      active = true;
      void run(write);
    }
    return promise as Promise<R>;
  };
}

const enqueueConfigWrite = makeReplacementWriteQueue();
const enqueueStateWrite = makeReplacementWriteQueue();
const enqueuePanesWrite = makeReplacementWriteQueue();
// Pre/post-edit captures and deletion share submission order through physical
// settlement. Native workers serialize the connection but can dispatch out of
// order; letting them overtake changes latest-text dedup or repopulates deletion.
const enqueueSnapshotMutation = makeWriteQueue();

// Sends every set config.json should hold: those that differ from their
// built-ins, and any the load could not read, as they were.
export async function saveConfig(config: Partial<ConfigSets> & Record<string, unknown>): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await enqueueConfigWrite<void>("save_config", { config });
}

export async function saveState(state: StateFile): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await enqueueStateWrite<void>("save_state", { state });
}

export async function savePanes(panes: PanesFile): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await enqueuePanesWrite<void>("save_panes", { panes });
}

export async function createSnapshot(input: SnapshotWriteInput): Promise<SnapshotWriteResult> {
  if (!isTauri()) {
    return { inserted: false, id: null };
  }

  return enqueueSnapshotMutation<SnapshotWriteResult>("create_snapshot", input);
}

export async function createSnapshots(inputs: SnapshotWriteInput[]): Promise<SnapshotWriteResult[]> {
  if (!isTauri()) {
    return [];
  }

  return enqueueSnapshotMutation<SnapshotWriteResult[]>("create_snapshots", { snapshots: inputs });
}

// A blank query lists the whole store newest-first; terms narrow that list.
export async function listSnapshots(
  query: string,
  limit: number,
  offset: number,
): Promise<SnapshotListResult> {
  if (!isTauri()) {
    return { rows: [], hasMore: false };
  }

  return invoke<SnapshotListResult>("list_snapshots", {
    query,
    limit,
    offset,
  });
}

export async function deleteSnapshot(id: string): Promise<boolean> {
  if (!isTauri()) {
    return false;
  }

  return enqueueSnapshotMutation<boolean>("delete_snapshot", { id });
}

export async function deleteAllSnapshots(): Promise<number> {
  if (!isTauri()) {
    return 0;
  }

  return enqueueSnapshotMutation<number>("delete_all_snapshots");
}

export async function countSnapshots(): Promise<number> {
  if (!isTauri()) {
    return 0;
  }

  return invoke<number>("count_snapshots");
}
