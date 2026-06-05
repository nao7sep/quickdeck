import type { AppSettings, Pane } from "../types";
import { randomPaneColor } from "../utils/paneColors";
import { ZOOM_DEFAULT } from "../utils/zoom";

export const defaultSettings: AppSettings = {
  dark: false,
  zen: false,
  topmost: false,
  editorFontFamily: "monospace",
  editorFontSize: 14,
  autosaveDelaySeconds: 3,
  snapshotSearchPageSize: 25,
  zoomLevel: ZOOM_DEFAULT,
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
