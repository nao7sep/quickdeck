import type { LanguagePreference } from "./i18n/languages";
import type { Message } from "./i18n/translate";

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

// The saved appearance choice. System follows the OS appearance.
export type ThemePreference = "system" | "light" | "dark";

export type AppSettings = {
  language: LanguagePreference;
  theme: ThemePreference;
  zen: boolean;
  topmost: boolean;
  // UI (chrome) font family. Family only; blank = the built-in default stack (the styles.css
  // --font-ui variable). Distinct from editorFontFamily, which is the pane editor's content font.
  uiFontFamily: string;
  // The pane editor's content font — the surface the user writes in, so it carries the full
  // per-app-chrome-conventions content-font set: family, size, line-height, padding, and the
  // weight/slant/underline decorations.
  editorFontFamily: string;
  editorFontSize: number;
  editorLineHeight: number;
  editorPadding: number;
  editorBold: boolean;
  editorItalic: boolean;
  editorUnderline: boolean;
  autosaveDelaySeconds: number;
  snapshotSearchPageSize: number;
};

export type ToastKind = "info" | "warning" | "error";

export type Toast = {
  id: string;
  owner: string;
  kind: ToastKind;
  message: Message;
};

export type BlockingError = {
  title: Message;
  message: Message;
};

export type TextCounts = {
  words: number;
  chars: number;
  xWeightedChars: number;
  xLimit: number;
  xValid: boolean;
};
