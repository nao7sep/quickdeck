import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { loadCatalogue } from "../i18n/catalogues";
import { I18nProvider } from "../i18n/I18nContext";
import { formattingLocale, isLanguage, type Language } from "../i18n/languages";
import { logWarn, serializeError } from "../services/logger";
import { onPresentationChanged, recordsListWidth, recordsWindowSetup, type RecordsWindowSetup } from "../services/records";
import { isDisplayZone, resolveTimeZone, SYSTEM_ZONE } from "../utils/timeZone";
import { RecordsWindow } from "./RecordsWindow";
import { initialListWidth, RECORDS_LIST_WIDTH, RECORDS_WINDOW_MIN_HEIGHT, RECORDS_WINDOW_MIN_WIDTH } from "./recordsLayout";

type Setup = Omit<RecordsWindowSetup, "language"> & { language: Language };

// Required presentation settles before text appears; optional layout can arrive later.
export function RecordsApp() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [listWidth, setListWidth] = useState<number>(RECORDS_LIST_WIDTH.default);

  useEffect(() => {
    let cancelled = false;
    let stopListening: (() => void) | undefined;
    let highestRevision = -1;
    let generation = 0;
    const accept = async (next: RecordsWindowSetup) => {
      if (cancelled || next.revision <= highestRevision) return;
      highestRevision = next.revision;
      const requested = ++generation;
      const language = isLanguage(next.language) ? next.language : "en";
      const displayZone = isDisplayZone(next.displayZone) ? next.displayZone : SYSTEM_ZONE;
      try {
        await loadCatalogue(language);
        if (!cancelled && requested === generation) {
          setSetup({ ...next, language, displayZone });
        }
      } catch (error: unknown) {
        logWarn("catalogue load failed", { language, error: serializeError(error) });
        if (!cancelled && requested === generation) {
          setSetup((current) => current ?? { ...next, language: "en", displayZone });
        }
      }
    };
    void (async () => {
      try {
        const stop = await onPresentationChanged((next) => { void accept(next); });
        if (cancelled) { stop(); return; }
        stopListening = stop;
      } catch (error: unknown) {
        logWarn("records listener failed", { error: serializeError(error) });
        if (cancelled) return;
      }
      try {
        await accept(await recordsWindowSetup());
      } catch (error: unknown) {
        logWarn("records window setup failed", { error: serializeError(error) });
        // A newer event already owns presentation if the initial request fails.
        if (!cancelled && highestRevision < 0) {
          setSetup({ revision: -1, language: "en", systemLocale: null, displayZone: SYSTEM_ZONE, uiFontFamily: "" });
        }
      }
    })();
    void recordsListWidth().then(
      (width) => { if (!cancelled) setListWidth(initialListWidth(width)); },
      (error: unknown) => logWarn("records list width read failed", { error: serializeError(error) }),
    );
    return () => {
      cancelled = true;
      stopListening?.();
    };
  }, []);

  useEffect(() => {
    const family = setup?.uiFontFamily.trim();
    if (family) document.documentElement.style.setProperty("--font-ui", family);
    else document.documentElement.style.removeProperty("--font-ui");
  }, [setup?.uiFontFamily]);

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
    <I18nProvider
      language={setup.language}
      locale={formattingLocale(setup.language, setup.systemLocale)}
      timeZone={resolveTimeZone(setup.displayZone)}
    >
      <RecordsWindow initialListWidth={listWidth} />
    </I18nProvider>
  );
}
