import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppSettings, Pane, SnapshotTrigger } from "../types";

// Pure view/session state — its own store (state.json), quarantined-then-reset
// on corruption because every field is rebuildable by use.
export type StateFile = {
  version: 1;
  activePaneId: string;
  // The webview zoom — a view adjustment, so it is state, never config
  // (persisted-store-separation conventions).
  zoomLevel: number;
  updatedAtUtc: string;
};

// The panes' text and identity — the user's work product, its own store
// (panes.json) that HALTS on corruption rather than quarantining.
export type PanesFile = {
  version: 1;
  panes: Pane[];
  updatedAtUtc: string;
};

export type LoadedAppData = {
  config: AppSettings | null;
  // Where a corrupt config.json was set aside; retained for diagnostics while
  // the app presents authored recovery copy.
  configQuarantinedTo: string | null;
  state: StateFile | null;
  panes: PanesFile | null;
  // Set when panes.json is present but unreadable: the pane surface halts
  // (file left in place) while config and state still load.
  panesError: string | null;
  dataDir: string;
  // Whether developer-only debug logging is on (resolved by the Rust core).
  debugEnabled: boolean;
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
  // The title is empty for a copy taken before titles were recorded.
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
): StateFile {
  return {
    version: 1,
    activePaneId,
    zoomLevel,
    updatedAtUtc: new Date().toISOString(),
  };
}

export function buildPanesFile(panes: Pane[]): PanesFile {
  return {
    version: 1,
    panes,
    updatedAtUtc: new Date().toISOString(),
  };
}

export async function loadAppData(): Promise<LoadedAppData> {
  if (!isTauri()) {
    return {
      config: null,
      configQuarantinedTo: null,
      state: null,
      panes: null,
      panesError: null,
      dataDir: "Browser preview",
      debugEnabled: import.meta.env.DEV,
      systemLanguage: "en",
      systemLocale: null,
    };
  }

  return invoke<LoadedAppData>("load_app_data");
}

// Rebuilds the native menu in the interface language (the Rust core built it in
// the saved language before the window was shown).
export async function applyLanguage(language: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("apply_language", { language });
}

export async function saveConfig(config: AppSettings): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("save_config", { config });
}

let stateWriteQueue: Promise<void> = Promise.resolve();

export async function saveState(state: StateFile): Promise<void> {
  if (!isTauri()) {
    return;
  }

  const write = stateWriteQueue.catch(() => {}).then(() => invoke<void>("save_state", { state }));
  stateWriteQueue = write;
  await write;
}

export async function savePanes(panes: PanesFile): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("save_panes", { panes });
}

// The user-commanded reset behind the corrupt-panes halt: the Rust core sets
// panes.json aside to its `.invalid` name and returns where it went.
export async function quarantineCorruptPanes(): Promise<string> {
  return invoke<string>("quarantine_corrupt_panes");
}

// The shape-failure branch for config.json: valid JSON whose fields fail the
// shape check is corrupt too, so the load path sets it aside before reseeding
// (storage-path conventions).
export async function quarantineCorruptConfig(): Promise<string> {
  return invoke<string>("quarantine_corrupt_config");
}

export async function createSnapshot(input: SnapshotWriteInput): Promise<SnapshotWriteResult> {
  if (!isTauri()) {
    return { inserted: false, id: null };
  }

  return invoke<SnapshotWriteResult>("create_snapshot", input);
}

export async function createSnapshots(inputs: SnapshotWriteInput[]): Promise<SnapshotWriteResult[]> {
  if (!isTauri()) {
    return [];
  }

  return invoke<SnapshotWriteResult[]>("create_snapshots", { snapshots: inputs });
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

  return invoke<boolean>("delete_snapshot", { id });
}

export async function deleteAllSnapshots(): Promise<number> {
  if (!isTauri()) {
    return 0;
  }

  return invoke<number>("delete_all_snapshots");
}

export async function countSnapshots(): Promise<number> {
  if (!isTauri()) {
    return 0;
  }

  return invoke<number>("count_snapshots");
}
