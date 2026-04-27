import type { AppSettings, Pane } from "../types";
import { randomPaneColor } from "../utils/paneColors";

export const defaultSettings: AppSettings = {
  autosaveDelaySeconds: 3,
  snapshotSearchPageSize: 25,
  topmost: false,
  editorFontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  editorFontSize: 14,
};

export function createDefaultPane(id: string, previousHeaderColor?: string | null): Pane {
  const colors = randomPaneColor(previousHeaderColor);
  return {
    id,
    title: "New Buffer",
    content: "",
    headerColor: colors.header,
    backgroundColor: colors.background,
  };
}
