import type { AppSettings, Pane } from "../types";

export const defaultSettings: AppSettings = {
  autosaveDelaySeconds: 3,
  snapshotSearchPageSize: 25,
  topmost: false,
  opacity: 1,
  editorFontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  editorFontSize: 14,
};

export function createDefaultPane(id: string): Pane {
  return {
    id,
    title: "new buffer",
    content: "",
  };
}
