import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { nanoid } from "nanoid";
import { createDefaultPane, defaultSettings } from "./defaults";
import {
  readSettingsSets,
  normalizeZoomLevel,
  settingsBySet,
  settingsShapeIssues,
  storedSettingsSets,
  unreadSets,
} from "./normalize";
import { ZOOM_DEFAULT } from "../utils/zoom";
import { toastLifetimeMs } from "../utils/toastPolicy";
import { appendPane, deletePane as deletePaneOp, reorderPane } from "./paneOps";
import { multiline, singleLine } from "../utils/textCleanup";
import { resolveSaveState } from "../utils/saveRace";
import {
  buildPanesFile,
  buildStateFile,
  countSnapshots,
  createSnapshot,
  createSnapshots,
  loadAppData,
  loadFailurePath,
  launchLanguage,
  saveConfig,
  savePanes,
  saveFailureMessage,
  saveState as persistState,
  type RefusedFile,
} from "../services/persistence";
import { onRecordsListWidth } from "../services/records";
import { isTauri } from "@tauri-apps/api/core";
import { logError, logInfo, logWarn, serializeError } from "../services/logger";
import { resolveTimeZone } from "../utils/timeZone";
import { I18nProvider } from "../i18n/I18nContext";
import {
  effectiveLanguage,
  formattingLocale,
  isLanguage,
  type Language,
} from "../i18n/languages";
import { loadCatalogue } from "../i18n/catalogues";
import { createTranslator, message, type Message } from "../i18n/translate";
import type {
  AppSettings,
  BlockingError,
  LoadStatus,
  Pane,
  SaveState,
  SnapshotTrigger,
  Toast,
  ToastKind,
} from "../types";

type AppStateContextValue = {
  panes: Pane[];
  activePaneId: string;
  activePane: Pane;
  settings: AppSettings;
  // The interface language: the saved choice, with System resolved to the
  // computer's language.
  language: Language;
  // The computer's language, which Settings shows as System's current value.
  systemLanguage: Language;
  // The webview zoom — session state (state.json), not a setting, so it rides
  // beside `settings` rather than inside it (persisted-store-separation).
  zoomLevel: number;
  saveState: SaveState;
  toasts: Toast[];
  blockingError: BlockingError | null;
  loadStatus: LoadStatus;
  loadError: Message | null;
  // The file a halt names, resolved by the Rust core; null when the load
  // stopped before reaching a store.
  loadErrorPath: string | null;
  // Every file the launch stopped on, which the stop screen lists.
  loadRefused: RefusedFile[];
  snapshotCount: number;
  snapshotJustSavedAt: number | null;
  refreshSnapshotCount: () => void;
  setActivePaneId: (paneId: string) => void;
  updatePaneTitle: (paneId: string, title: string) => void;
  commitPaneTitle: (paneId: string) => void;
  updatePaneContent: (paneId: string, content: string) => void;
  addPane: () => void;
  deletePane: (paneId: string) => void;
  movePane: (paneId: string, direction: -1 | 1) => void;
  updateSettings: (settings: AppSettings) => void;
  setZoomLevel: (zoomLevel: number) => void;
  saveNow: () => Promise<boolean>;
  recordSnapshot: (paneId: string, trigger: SnapshotTrigger, content: string) => void;
  snapshotAllPanes: (trigger: SnapshotTrigger) => Promise<void>;
  showToast: (owner: string, kind: ToastKind, message: Message) => void;
  dismissToast: (toastId: string) => void;
  // A later success of the same operation clears its outstanding result.
  clearToast: (owner: string) => void;
  showBlockingError: (title: Message, message: Message, details?: Message[]) => void;
  dismissBlockingError: () => void;
};

const AppStateContext = createContext<AppStateContextValue | undefined>(undefined);

export function AppStateProvider({ children }: { children: ReactNode }) {
  // Titled once the language is known at load; nothing renders before then.
  const firstPane = useMemo(() => createDefaultPane(nanoid(), ""), []);
  const [panes, setPanes] = useState<Pane[]>([firstPane]);
  const [activePaneId, setActivePaneId] = useState(firstPane.id);
  const [settings, setSettings] = useState(defaultSettings);
  const [zoomLevel, setZoomLevelState] = useState(ZOOM_DEFAULT);
  // The Records window's list width, which this window's state save writes.
  const [recordsListWidth, setRecordsListWidth] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [blockingError, setBlockingError] = useState<BlockingError | null>(null);
  const [systemLanguage, setSystemLanguage] = useState<Language>("en");
  const [systemLocale, setSystemLocale] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<Message | null>(null);
  const [loadErrorPath, setLoadErrorPath] = useState<string | null>(null);
  const [loadRefused, setLoadRefused] = useState<RefusedFile[]>([]);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const snapshotCountRequestRef = useRef(0);
  const [snapshotJustSavedAt, setSnapshotJustSavedAt] = useState<number | null>(null);
  // The interface shows a language once its catalogue has loaded, so a saved
  // change takes effect when the catalogue is ready.
  const [language, setLanguage] = useState<Language>("en");
  const chosenLanguage = effectiveLanguage(settings.language, systemLanguage);
  const locale = formattingLocale(language, systemLocale);
  const timeZone = resolveTimeZone(settings.displayZone);
  const translator = useMemo(() => createTranslator(language, locale, timeZone), [language, locale, timeZone]);
  const panesRef = useRef(panes);
  // Monotonic counter bumped on every edit. saveNow snapshots the value at the
  // start of a save and only flips back to "saved" when the counter has not
  // moved during the save — keeps an edit from being lost in a save race.
  const dirtyCounterRef = useRef(0);
  // The sets config.json held that this build could not read, saved back as
  // they were until the user changes that setting.
  const unreadSetsRef = useRef<Record<string, unknown>>({});
  const settingsRef = useRef(settings);

  useEffect(() => {
    panesRef.current = panes;
  }, [panes]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const markUnsaved = useCallback(() => {
    dirtyCounterRef.current += 1;
    setSaveState("unsaved");
  }, []);

  const activePane = useMemo(() => {
    return panes.find((pane) => pane.id === activePaneId) ?? panes[0];
  }, [activePaneId, panes]);

  const showToast = useCallback((owner: string, kind: ToastKind, text: Message) => {
    const id = nanoid();
    setToasts((current) => [
      ...current.filter((toast) => toast.owner !== owner),
      { id, owner, kind, message: text },
    ]);
    const lifetime = toastLifetimeMs(kind);
    if (lifetime !== null) {
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, lifetime);
    }
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  const clearToast = useCallback((owner: string) => {
    setToasts((current) => current.filter((toast) => toast.owner !== owner));
  }, []);

  const showBlockingError = useCallback((title: Message, text: Message, details?: Message[]) => {
    setBlockingError({ title, message: text, ...(details?.length ? { details } : {}) });
  }, []);

  const dismissBlockingError = useCallback(() => {
    setBlockingError(null);
  }, []);

  const canceledRef = useRef(false);
  // A newer load supersedes an older one: its result is the one reported.
  const loadGenerationRef = useRef(0);

  // Mutations refresh the authoritative count; older reads cannot replace a
  // later read issued after another committed mutation.
  const refreshSnapshotCount = useCallback(() => {
    const request = ++snapshotCountRequestRef.current;
    void countSnapshots()
      .then((count) => {
        if (!canceledRef.current && request === snapshotCountRequestRef.current) {
          setSnapshotCount(count);
        }
      })
      .catch((error) => logWarn("snapshot count not read", { error: serializeError(error) }));
  }, []);

  const loadPersistedState = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const current = () => !canceledRef.current && generation === loadGenerationRef.current;
    try {
      const data = await loadAppData();
      if (!current()) return;

      // The language is settled before anything renders, including a halt
      // screen: the saved choice if config.json could be read, else System.
      const loadedSystemLanguage = isLanguage(data.systemLanguage) ? data.systemLanguage : "en";
      const loadedSettings = readSettingsSets(data.config);
      const loadedLanguage = effectiveLanguage(loadedSettings.language, loadedSystemLanguage);
      await loadCatalogue(loadedLanguage);
      if (!current()) return;
      setSystemLanguage(loadedSystemLanguage);
      setSystemLocale(data.systemLocale);
      setSettings(loadedSettings);
      setLanguage(loadedLanguage);
      const loadTranslator = createTranslator(loadedLanguage);

      // A newer or unreadable file the launch needs stops it: every one is
      // named, left exactly as it is, and nothing is written (store-recovery
      // conventions, What a refused file does).
      if (data.refused.length > 0) {
        logError("launch stopped on refused files", { files: data.refused });
        setLoadRefused(data.refused);
        setLoadError(null);
        setLoadErrorPath(null);
        setLoadStatus("failed");
        return;
      }

      for (const issue of data.config === null ? [] : settingsShapeIssues(data.config)) {
        logWarn("config set read as its built-in", { issue });
      }

      const effectiveSettings = loadedSettings;
      unreadSetsRef.current = unreadSets(data.config);
      // Startup baseline: record the key effective configuration.
      logInfo("config loaded", {
        settings: effectiveSettings,
        hasState: data.state !== null,
        hasPanes: data.panes !== null,
        dataDir: data.dataDir,
      });

      // An unreadable records or backup database is left untouched and off for
      // the session; the app runs and says so once.
      if (data.off.length > 0) {
        showBlockingError(
          message("storeOff.title"),
          message("storeOff.body"),
          data.off.map((file) => message(
            file.path.endsWith("records.sqlite3") ? "storeOff.records" : "storeOff.backups",
            { path: file.path },
          )),
        );
      }

      let countLate = false;
      try {
        const initialCount = await countSnapshots();
        if (current()) {
          setSnapshotCount(initialCount);
        }
      } catch (error) {
        // Snapshot count is informational only — recover and continue — but a
        // failure here is still an unexpected error worth recording. It is
        // read again once the app is ready, so it does not stay at 0.
        logWarn("snapshot count failed", { error: serializeError(error) });
        countLate = true;
      }

      if (!current()) return;
      setZoomLevelState(normalizeZoomLevel(data.state?.zoomLevel));
      setRecordsListWidth(typeof data.state?.recordsListWidth === "number" ? data.state.recordsListWidth : null);

      const defaultTitle = loadTranslator.t("pane.defaultTitle");
      const loadedPanes = data.panes?.panes ?? [];
      if (loadedPanes.length === 0) {
        setPanes([{ ...firstPane, title: defaultTitle }]);
      } else {
        setPanes(loadedPanes);
        const loadedActivePane = loadedPanes.some((pane) => pane.id === data.state?.activePaneId)
          ? data.state?.activePaneId
          : loadedPanes[0].id;
        setActivePaneId(loadedActivePane ?? loadedPanes[0].id);
      }

      setSaveState("saved");
      setLoadStatus("ready");
      if (countLate) refreshSnapshotCount();
    } catch (error) {
      // The halt screen speaks the language the native menu does, as on every
      // other halt; English stays when even that cannot be had.
      if (current()) {
        try {
          const launch = await launchLanguage();
          const launchSystem = isLanguage(launch.systemLanguage) ? launch.systemLanguage : "en";
          const launchChosen = isLanguage(launch.language) ? launch.language : launchSystem;
          await loadCatalogue(launchChosen);
          if (current()) {
            setSystemLanguage(launchSystem);
            setSystemLocale(launch.systemLocale);
            setSettings((prior) => ({ ...prior, language: launchChosen }));
            setLanguage(launchChosen);
          }
        } catch (languageError) {
          logWarn("halt screen language unavailable", { error: serializeError(languageError) });
        }
      }
      if (current()) {
        // Halt: do not transition into a state where any write path can run.
        // The App shell renders a non-dismissible error screen for "failed",
        // so the user's existing files on disk are never overwritten by the
        // default in-memory state.
        logError("load failed", { error: serializeError(error) });
        setLoadError(message("load.failed"));
        setLoadErrorPath(loadFailurePath(error));
        setLoadStatus("failed");
      }
    }
  }, [firstPane, refreshSnapshotCount, showBlockingError]);

  useEffect(() => {
    if (chosenLanguage === language) return undefined;
    let current = true;
    loadCatalogue(chosenLanguage).then(
      () => {
        if (current) setLanguage(chosenLanguage);
      },
      (error) => logError("catalogue load failed", { language: chosenLanguage, error: serializeError(error) }),
    );
    return () => {
      current = false;
    };
  }, [chosenLanguage, language]);

  useEffect(() => {
    canceledRef.current = false;
    void loadPersistedState();
    return () => {
      canceledRef.current = true;
      loadGenerationRef.current += 1;
    };
  }, [loadPersistedState]);

  const updatePaneTitle = useCallback(
    (paneId: string, title: string) => {
      setPanes((current) =>
        current.map((pane) => (pane.id === paneId ? { ...pane, title } : pane)),
      );
      markUnsaved();
    },
    [markUnsaved],
  );

  // Commit-time cleanup for the pane title: the input stores its value verbatim
  // while the user types (never cleaned mid-edit), then this runs on blur to
  // single-line it — so a pasted multi-line value can't leak \r/\n into
  // panes.json. The title is not an identity field, so we normalize rather
  // than validate. Decide whether anything changes before touching state (the
  // updater must stay pure under StrictMode's double-invoke), and only mark
  // unsaved when cleanup actually changes the value, so a blur over an
  // already-clean title doesn't spuriously dirty the document.
  const commitPaneTitle = useCallback(
    (paneId: string) => {
      const pane = panesRef.current.find((candidate) => candidate.id === paneId);
      if (!pane) {
        return;
      }
      const cleaned = singleLine(pane.title);
      if (cleaned === pane.title) {
        return;
      }
      setPanes((current) =>
        current.map((candidate) =>
          candidate.id === paneId ? { ...candidate, title: cleaned } : candidate,
        ),
      );
      markUnsaved();
    },
    [markUnsaved],
  );

  const updatePaneContent = useCallback(
    (paneId: string, content: string) => {
      setPanes((current) =>
        current.map((pane) => (pane.id === paneId ? { ...pane, content } : pane)),
      );
      markUnsaved();
    },
    [markUnsaved],
  );

  const addPane = useCallback(() => {
    const paneId = nanoid();
    const title = translator.t("pane.defaultTitle");
    setPanes((current) => appendPane(current, paneId, title));
    setActivePaneId(paneId);
    markUnsaved();
    logInfo("pane added", { paneId });
  }, [markUnsaved, translator]);

  const deletePane = useCallback(
    (paneId: string) => {
      const outcome = deletePaneOp(panes, paneId, activePaneId);

      switch (outcome.kind) {
        case "not-found":
          return;
        case "blocked-last":
          // Expected, anticipated outcomes surfaced to the user as toasts — not
          // logged incidents. The messages do not name a pane, so the owner is the
          // operation: a later blocked delete of any pane supersedes the notice
          // instead of stacking copies nobody can tell apart.
          showToast("pane-delete", "warning", message("toast.lastPane"));
          return;
        case "blocked-non-empty":
          showToast("pane-delete", "warning", message("toast.nonEmptyPane"));
          return;
        case "deleted":
          setPanes(outcome.panes);
          setActivePaneId(outcome.nextActivePaneId);
          markUnsaved();
          logInfo("pane deleted", { paneId });
          return;
      }
    },
    [activePaneId, markUnsaved, panes, showToast],
  );

  const movePane = useCallback(
    (paneId: string, direction: -1 | 1) => {
      // Decide and emit side effects outside the state updater: updaters must be
      // pure (StrictMode double-invokes them in development), so logging or
      // marking-dirty inside one would fire twice per move.
      const next = reorderPane(panes, paneId, direction);
      if (next === panes) {
        return;
      }
      setPanes(next);
      markUnsaved();
      logInfo("pane moved", { paneId, direction });
    },
    [markUnsaved, panes],
  );

  const recordSnapshot = useCallback(
    (paneId: string, trigger: SnapshotTrigger, content: string) => {
      const paneTitle = panesRef.current.find((pane) => pane.id === paneId)?.title ?? "";
      if (loadStatus !== "ready") {
        return;
      }

      const trimmed = multiline(content);
      if (trimmed.length === 0) {
        return;
      }

      void createSnapshot({ paneId, paneTitle, trigger, content: trimmed })
        .then((result) => {
          if (result.inserted) {
            refreshSnapshotCount();
            setSnapshotJustSavedAt(Date.now());
          }
        })
        .catch((error) => {
          logWarn("snapshot not saved", { paneId, trigger, error: serializeError(error) });
          // One owner for every pane: the message cannot say which pane failed.
          showToast("snapshot", "warning", message("toast.snapshotFailed"));
        });
    },
    [loadStatus, refreshSnapshotCount, showToast],
  );

  const snapshotAllPanes = useCallback(
    async (trigger: SnapshotTrigger) => {
      if (loadStatus !== "ready") {
        return;
      }

      const snapshots = panesRef.current
        .map((pane) => ({
          paneId: pane.id,
          paneTitle: pane.title,
          trigger,
          content: multiline(pane.content),
        }))
        .filter((snapshot) => snapshot.content.length > 0);

      if (snapshots.length === 0) {
        return;
      }

      const results = await createSnapshots(snapshots);
      const insertedCount = results.filter((result) => result.inserted).length;
      if (insertedCount > 0) {
        refreshSnapshotCount();
        setSnapshotJustSavedAt(Date.now());
      }
    },
    [loadStatus, refreshSnapshotCount],
  );

  const updateSettings = useCallback((nextSettings: AppSettings) => {
    // A setting the user changes replaces the unread set it ran on.
    const before = settingsBySet(settingsRef.current);
    const after = settingsBySet(nextSettings);
    for (const key of Object.keys(after) as (keyof typeof after)[]) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) delete unreadSetsRef.current[key];
    }
    setSettings(nextSettings);
    dirtyCounterRef.current += 1;
    setSaveState("unsaved");
    logInfo("settings updated", { settings: nextSettings });
  }, []);

  // A view adjustment, not a setting: zoom persists through the session save
  // (state.json), never the config channel. Deliberately not logged per change —
  // a held zoom shortcut would spam the log with view churn.
  const setZoomLevel = useCallback(
    (nextZoomLevel: number) => {
      setZoomLevelState(nextZoomLevel);
      markUnsaved();
    },
    [markUnsaved],
  );

  // A view adjustment like zoom: the width the Records window sends goes into
  // the next state save.
  useEffect(() => {
    if (!isTauri()) return undefined;
    return onRecordsListWidth((width) => {
      setRecordsListWidth(width);
      markUnsaved();
    });
  }, [markUnsaved]);

  // Rejects on failure. Each caller decides whether to surface a modal and/or
  // change control flow, since autosave and the close path want different
  // policies. No-ops unless load succeeded — see the LoadStatus comment in
  // types.ts.
  const savedInputRevision = dirtyCounterRef.current;
  const saveNow = useCallback(async () => {
    if (loadStatus !== "ready") return true;
    // The closure's payload and revision come from the same render. An edit
    // admitted before its next render cannot certify an older payload.
    if (savedInputRevision !== dirtyCounterRef.current) return false;

    const dirtyAtStart = savedInputRevision;
    setSaveState("saving");
    try {
      // Every save sends every stored set; the write queue keeps only the newest
      // pending payload per file, and the core writes nothing when it equals the file.
      await Promise.all([
        saveConfig({ ...unreadSetsRef.current, ...storedSettingsSets(settings) }),
        savePanes(buildPanesFile(panes)),
      ]);
      // View state is optional: admit it after required writes, and retain its
      // per-file queue through settlement without making it a quit condition.
      void persistState(buildStateFile(activePaneId, zoomLevel, recordsListWidth)).catch((error) => {
        logWarn("view state save failed", { error: serializeError(error) });
      });
      const result = resolveSaveState(dirtyAtStart, dirtyCounterRef.current);
      setSaveState(result);
      return result === "saved";
    } catch (error) {
      setSaveState("error");
      throw error;
    }
  }, [activePaneId, loadStatus, panes, recordsListWidth, savedInputRevision, settings, zoomLevel]);

  useEffect(() => {
    if (loadStatus !== "ready" || saveState !== "unsaved") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      saveNow().catch((error) => {
        logError("autosave failed", { error: serializeError(error) });
        showBlockingError(message("saveError.title"), saveFailureMessage(error) ?? message("saveError.autosave"));
      });
    }, settings.autosaveDelaySeconds * 1000);

    return () => window.clearTimeout(timeoutId);
  }, [loadStatus, saveNow, saveState, settings.autosaveDelaySeconds, showBlockingError]);

  const value = useMemo<AppStateContextValue>(
    () => ({
      panes,
      activePaneId,
      activePane,
      settings,
      language,
      systemLanguage,
      zoomLevel,
      saveState,
      toasts,
      blockingError,
      loadStatus,
      loadError,
      loadErrorPath,
      loadRefused,
      snapshotCount,
      snapshotJustSavedAt,
      refreshSnapshotCount,
      setActivePaneId,
      updatePaneTitle,
      commitPaneTitle,
      updatePaneContent,
      addPane,
      deletePane,
      movePane,
      updateSettings,
      setZoomLevel,
      saveNow,
      recordSnapshot,
      snapshotAllPanes,
      showToast,
      dismissToast,
      clearToast,
      showBlockingError,
      dismissBlockingError,
    }),
    [
      activePane,
      activePaneId,
      addPane,
      blockingError,
      clearToast,
      commitPaneTitle,
      deletePane,
      dismissBlockingError,
      dismissToast,
      loadError,
      loadErrorPath,
      loadRefused,
      loadStatus,
      movePane,
      language,
      systemLanguage,
      panes,
      recordSnapshot,
      saveNow,
      saveState,
      setZoomLevel,
      settings,
      showBlockingError,
      refreshSnapshotCount,
      showToast,
      snapshotAllPanes,
      snapshotCount,
      snapshotJustSavedAt,
      toasts,
      updatePaneContent,
      updatePaneTitle,
      updateSettings,
      zoomLevel,
    ],
  );

  return (
    <AppStateContext.Provider value={value}>
      <I18nProvider language={language} locale={locale} timeZone={timeZone}>
        {children}
      </I18nProvider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return value;
}
