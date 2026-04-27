import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppSettings, Pane, SnapshotTrigger } from "../types";

export type SessionState = {
  version: 1;
  panes: Pane[];
  activePaneId: string;
  updatedAtUtc: string;
};

export type LoadedAppData = {
  config: AppSettings | null;
  session: SessionState | null;
  dataDir: string;
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
  paneId: string;
  createdAtUtc: string;
  content: string;
};

export type SnapshotSearchResult = {
  rows: SnapshotSearchRow[];
  hasMore: boolean;
};

export function buildSessionState(panes: Pane[], activePaneId: string): SessionState {
  return {
    version: 1,
    panes,
    activePaneId,
    updatedAtUtc: new Date().toISOString(),
  };
}

export async function loadAppData(): Promise<LoadedAppData> {
  if (!isTauri()) {
    return {
      config: null,
      session: null,
      dataDir: "Browser preview",
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

export async function saveSession(session: SessionState): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("save_session", { session });
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
    paneId: null,
  });
}

export async function countSnapshots(): Promise<number> {
  if (!isTauri()) {
    return 0;
  }

  return invoke<number>("count_snapshots");
}
