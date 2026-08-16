import type { AppSettings, Pane } from "../types";
import { randomPaneColor } from "../utils/paneColors";

export const defaultSettings: AppSettings = {
  dark: false,
  zen: false,
  topmost: false,
  uiFontFamily: "",
  editorFontFamily: "monospace",
  editorFontSize: 14,
  editorLineHeight: 1.6,
  editorPadding: 14,
  editorBold: false,
  editorItalic: false,
  editorUnderline: false,
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
