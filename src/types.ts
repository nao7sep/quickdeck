export type SnapshotTrigger = "copy" | "paste" | "cut" | "app_close";

export type Pane = {
  id: string;
  title: string;
  content: string;
  headerColor: string;
  backgroundColor: string;
};

export type SaveState = "saved" | "saving" | "unsaved" | "error";

// Tracks whether persisted data has been read off disk yet. Every write path
// gates on "ready" so a failed load can never overwrite the existing files
// with default state.
export type LoadStatus = "loading" | "ready" | "failed";

export type AppSettings = {
  zen: boolean;
  topmost: boolean;
  editorFontFamily: string;
  editorFontSize: number;
  autosaveDelaySeconds: number;
  snapshotSearchPageSize: number;
  zoomLevel: number;
};

export type ToastKind = "info" | "warning" | "error";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
};

export type BlockingError = {
  title: string;
  message: string;
};

export type TextCounts = {
  words: number;
  chars: number;
  xWeightedChars: number;
  xLimit: number;
  xValid: boolean;
};
