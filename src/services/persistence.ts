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
  // Where a corrupt config.json was set aside; the app reports it to the user.
  configQuarantinedTo: string | null;
  state: StateFile | null;
  stateQuarantinedTo: string | null;
  panes: PanesFile | null;
  // Set when panes.json is present but unreadable: the pane surface halts
  // (file left in place) while config and state still load.
  panesError: string | null;
  dataDir: string;
  // Whether developer-only debug logging is on (resolved by the Rust core).
  debugEnabled: boolean;
};

export type SnapshotWriteInput = {
  paneId: string;
  trigger: SnapshotTrigger;
  content: string;
};

export type SnapshotWriteResult = {
  inserted: boolean;
  id: string | null;
};

export type SnapshotSearchRow = {
  id: string;
  createdAtUtc: string;
  content: string;
};

export type SnapshotSearchResult = {
  rows: SnapshotSearchRow[];
  hasMore: boolean;
};

export function buildStateFile(activePaneId: string, zoomLevel: number): StateFile {
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
      stateQuarantinedTo: null,
      panes: null,
      panesError: null,
      dataDir: "Browser preview",
      debugEnabled: import.meta.env.DEV,
    };
  }

  return invoke<LoadedAppData>("load_app_data");
}

export async function saveConfig(config: AppSettings): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("save_config", { config });
}

export async function saveState(state: StateFile): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("save_state", { state });
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

export async function searchSnapshots(
  query: string,
  limit: number,
  offset: number,
): Promise<SnapshotSearchResult> {
  if (!isTauri()) {
    return { rows: [], hasMore: false };
  }

  return invoke<SnapshotSearchResult>("search_snapshots", {
    query,
    limit,
    offset,
  });
}

export async function countSnapshots(): Promise<number> {
  if (!isTauri()) {
    return 0;
  }

  return invoke<number>("count_snapshots");
}
