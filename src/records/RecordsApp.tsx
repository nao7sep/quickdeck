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

  // The setup and every later language change load a catalogue, and loads can
  // settle in any order. Each step runs after the one before, so the last
  // language asked for is the one shown: a change that arrives while the setup
  // is still loading follows it rather than being lost to it.
  useEffect(() => {
    let cancelled = false;
    const setupRequest = recordsWindowSetup();
    let steps: Promise<void> = (async () => {
      try {
        const result = await setupRequest;
        const language = isLanguage(result.language) ? result.language : "en";
        await loadCatalogue(language);
        if (!cancelled) {
          setSetup({ language, systemLocale: result.systemLocale, listWidth: initialListWidth(result.listWidth) });
        }
      } catch (error: unknown) {
        logWarn("records window setup failed", { error: serializeError(error) });
        if (!cancelled) setSetup({ language: "en", systemLocale: null, listWidth: RECORDS_LIST_WIDTH.default });
      }
    })();
    const stopListening = onLanguageChanged((tag) => {
      if (!isLanguage(tag)) return;
      steps = steps.then(() =>
        loadCatalogue(tag).then(
          () => {
            if (!cancelled) setSetup((current) => (current === null ? current : { ...current, language: tag }));
          },
          (error: unknown) => logWarn("catalogue load failed", { language: tag, error: serializeError(error) }),
        ),
      );
    });
    return () => {
      cancelled = true;
      stopListening();
    };
  }, []);

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
