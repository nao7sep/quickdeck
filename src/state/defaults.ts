import type { AppSettings, Pane } from "../types";
import { randomPaneColor } from "../utils/paneColors";

export const defaultSettings: AppSettings = {
  language: "system",
  theme: "system",
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

// `title` is the localized default name for a new pane; once created it is the
// user's own text and keeps whatever language it was created in.
export function createDefaultPane(
  id: string,
  title: string,
  existingHeaders: ReadonlyArray<string> = [],
): Pane {
  const colors = randomPaneColor(existingHeaders);
  return {
    id,
    title,
    content: "",
    headerColor: colors.header,
    backgroundColor: colors.background,
  };
}
