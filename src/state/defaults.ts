import type { AppSettings, Pane } from "../types";
import { randomPaneColor } from "../utils/paneColors";

export const defaultSettings: AppSettings = {
  zen: false,
  topmost: false,
  editorFontFamily: "monospace",
  editorFontSize: 14,
  autosaveDelaySeconds: 3,
  snapshotSearchPageSize: 25,
};

export function createDefaultPane(id: string, existingHeaders: ReadonlyArray<string> = []): Pane {
  const colors = randomPaneColor(existingHeaders);
  return {
    id,
    title: "New Buffer",
    content: "",
    headerColor: colors.header,
    backgroundColor: colors.background,
  };
}
