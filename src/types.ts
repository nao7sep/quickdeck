export type SnapshotTrigger = "copy" | "paste" | "cut" | "clear" | "app_close";

export type Pane = {
  id: string;
  title: string;
  content: string;
};

export type SaveState = "saved" | "saving" | "unsaved" | "error";

export type AppSettings = {
  autosaveDelaySeconds: number;
  snapshotSearchPageSize: number;
  topmost: boolean;
  opacity: number;
  editorFontFamily: string;
  editorFontSize: number;
};

export type ToastKind = "info" | "warning" | "error";

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
};

export type TextCounts = {
  words: number;
  chars: number;
  xWeightedChars: number;
  xLimit: number;
};
