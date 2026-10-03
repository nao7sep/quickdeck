import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { loadCatalogue } from "../i18n/catalogues";
import { I18nProvider } from "../i18n/I18nContext";
import { formattingLocale, isLanguage, type Language } from "../i18n/languages";
import { logWarn, serializeError } from "../services/logger";
import { onLanguageChanged, recordsWindowSetup } from "../services/records";
import { RecordsWindow } from "./RecordsWindow";
import { initialListWidth, RECORDS_LIST_WIDTH, RECORDS_WINDOW_MIN_HEIGHT, RECORDS_WINDOW_MIN_WIDTH } from "./recordsLayout";

type Setup = { language: Language; systemLocale: string | null; listWidth: number };

// The Records window speaks the interface language from its first text and
// opens the list at its saved width, so nothing renders until both are known; it
// follows the language when Settings changes it in the main window.
export function RecordsApp() {
  const [setup, setSetup] = useState<Setup | null>(null);

  useEffect(() => {
    let cancelled = false;
    void recordsWindowSetup()
      .then(async (result) => {
        const language = isLanguage(result.language) ? result.language : "en";
        await loadCatalogue(language);
        if (!cancelled) {
          setSetup({ language, systemLocale: result.systemLocale, listWidth: initialListWidth(result.listWidth) });
        }
      })
      .catch((error: unknown) => {
        logWarn("records window setup failed", { error: serializeError(error) });
        if (!cancelled) setSetup({ language: "en", systemLocale: null, listWidth: RECORDS_LIST_WIDTH.default });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onLanguageChanged((tag) => {
        if (!isLanguage(tag)) return;
        void loadCatalogue(tag).then(
          () => setSetup((current) => (current === null ? current : { ...current, language: tag })),
          (error: unknown) => logWarn("catalogue load failed", { language: tag, error: serializeError(error) }),
        );
      }),
    [],
  );

  // The window minimum is the panes' minimums plus the chrome (window-conventions).
  useEffect(() => {
    if (!isTauri()) return;
    void getCurrentWindow()
      .setMinSize(new LogicalSize(RECORDS_WINDOW_MIN_WIDTH, RECORDS_WINDOW_MIN_HEIGHT))
      .catch((error: unknown) => logWarn("set window min size failed", { window: "records", error: serializeError(error) }));
  }, []);

  if (setup === null) {
    return <main className="recordsShell" aria-busy="true" />;
  }

  return (
    <I18nProvider language={setup.language} locale={formattingLocale(setup.language, setup.systemLocale)}>
      <RecordsWindow initialListWidth={setup.listWidth} />
    </I18nProvider>
  );
}
