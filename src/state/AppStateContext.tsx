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
  normalizePanes,
  normalizeSettings,
  normalizeZoomLevel,
  panesShapeIssues,
  settingsShapeIssues,
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
  quarantineCorruptConfig,
  quarantineCorruptPanes,
  saveConfig,
  savePanes,
  saveState as persistState,
} from "../services/persistence";
import { logError, logInfo, logWarn, serializeError, setDebugEnabled } from "../services/logger";
import { I18nProvider } from "../i18n/I18nContext";
import {
  effectiveLanguage,
  formattingLocale,
  isLanguage,
  type Language,
} from "../i18n/languages";
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
  // The webview zoom — session state (state.json), not a setting, so it rides
  // beside `settings` rather than inside it (persisted-store-separation).
  zoomLevel: number;
  saveState: SaveState;
  toasts: Toast[];
  blockingError: BlockingError | null;
  dataDir: string;
  loadStatus: LoadStatus;
  loadError: Message | null;
  loadErrorIsCorruptPanes: boolean;
  snapshotCount: number;
  snapshotJustSavedAt: number | null;
  setActivePaneId: (paneId: string) => void;
  updatePaneTitle: (paneId: string, title: string) => void;
  commitPaneTitle: (paneId: string) => void;
  updatePaneContent: (paneId: string, content: string) => void;
  addPane: () => void;
  deletePane: (paneId: string) => void;
  movePane: (paneId: string, direction: -1 | 1) => void;
  updateSettings: (settings: AppSettings) => void;
  setZoomLevel: (zoomLevel: number) => void;
  // The user-commanded reset behind the corrupt-panes halt screen: sets
  // panes.json aside and reloads (storage-path conventions — a halting store
  // is clearable from the surface that reported the failure).
  resetCorruptPanes: () => Promise<void>;
  saveNow: () => Promise<void>;
  recordSnapshot: (paneId: string, trigger: SnapshotTrigger, content: string) => void;
  snapshotAllPanes: (trigger: SnapshotTrigger) => Promise<void>;
  showToast: (owner: string, kind: ToastKind, message: Message) => void;
  dismissToast: (toastId: string) => void;
  showBlockingError: (title: Message, message: Message) => void;
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
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [blockingError, setBlockingError] = useState<BlockingError | null>(null);
  const [dataDir, setDataDir] = useState("");
  const [systemLanguage, setSystemLanguage] = useState<Language>("en");
  const [systemLocale, setSystemLocale] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<Message | null>(null);
  // True when the failure is specifically a corrupt panes.json — the one halt
  // whose screen offers the explicit set-aside reset.
  const [loadErrorIsCorruptPanes, setLoadErrorIsCorruptPanes] = useState(false);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [snapshotJustSavedAt, setSnapshotJustSavedAt] = useState<number | null>(null);
  const language = effectiveLanguage(settings.language, systemLanguage);
  const locale = formattingLocale(language, systemLocale);
  const translator = useMemo(() => createTranslator(language, locale), [language, locale]);
  const panesRef = useRef(panes);
  const activePaneIdRef = useRef(activePaneId);
  const zoomLevelRef = useRef(zoomLevel);
  // Monotonic counter bumped on every edit. saveNow snapshots the value at the
  // start of a save and only flips back to "saved" when the counter has not
  // moved during the save — keeps an edit from being lost in a save race.
  const dirtyCounterRef = useRef(0);

  useEffect(() => {
    panesRef.current = panes;
  }, [panes]);
  useEffect(() => { activePaneIdRef.current = activePaneId; }, [activePaneId]);
  useEffect(() => { zoomLevelRef.current = zoomLevel; }, [zoomLevel]);

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

  const showBlockingError = useCallback((title: Message, text: Message) => {
    setBlockingError({ title, message: text });
  }, []);

  const dismissBlockingError = useCallback(() => {
    setBlockingError(null);
  }, []);

  const canceledRef = useRef(false);

  const loadPersistedState = useCallback(async () => {
    try {
      const data = await loadAppData();
      if (canceledRef.current) {
        return;
      }

      // Adopt the authoritative debug gate before logging anything else.
      setDebugEnabled(data.debugEnabled);
      setDataDir(data.dataDir);

      // The language is settled before anything renders, including a halt
      // screen: the saved choice if config.json could be read, else System.
      const loadedSystemLanguage = isLanguage(data.systemLanguage) ? data.systemLanguage : "en";
      const loadedSettings = normalizeSettings(data.config);
      setSystemLanguage(loadedSystemLanguage);
      setSystemLocale(data.systemLocale);
      setSettings(loadedSettings);
      const loadTranslator = createTranslator(
        effectiveLanguage(loadedSettings.language, loadedSystemLanguage),
      );

      // panes.json carries the user's text: present-but-unreadable HALTS the
      // app (the file is left exactly in place; the error screen offers the
      // explicit set-aside reset) while config and state still loaded — each
      // store fails on its own branch (persisted-store-separation).
      if (data.panesError !== null) {
        logError("panes load failed", { error: data.panesError });
        setLoadErrorIsCorruptPanes(true);
        setLoadError(message("load.panesUnreadable"));
        setLoadStatus("failed");
        return;
      }

      // Check the version before this build's shape. A newer schema may be
      // intentionally different and must never be offered the corrupt-file reset.
      const panesVersion = (data.panes as { version?: unknown } | null)?.version;
      if (typeof panesVersion === "number" && panesVersion > 1) {
        logError("panes.json is from a newer build", { version: panesVersion });
        setLoadErrorIsCorruptPanes(false);
        setLoadError(message("load.panesNewer", { version: panesVersion }));
        setLoadStatus("failed");
        return;
      }

      if (data.panes !== null) {
        const paneIssues = panesShapeIssues(data.panes);
        if (paneIssues.length > 0) {
          logError("panes.json failed its shape check", { issues: paneIssues });
          setLoadErrorIsCorruptPanes(true);
          setLoadError(message("load.panesDamaged"));
          setLoadStatus("failed");
          return;
        }
      }

      // Valid JSON whose fields fail the shape check is corrupt too: set the
      // file aside BEFORE the first write-back, reseed from the normalized
      // reading, and report — flushing a coerced reading over the original
      // would destroy the user's bytes on a file that never looked corrupt
      // (storage-path conventions' shape-failure clause). Unknown keys are not
      // shape failures: they are dropped by the known-keys rebuild and logged.
      let configShapeQuarantinedTo: string | null = null;
      if (data.config !== null) {
        const issues = settingsShapeIssues(data.config);
        if (issues.length > 0) {
          configShapeQuarantinedTo = await quarantineCorruptConfig();
          logWarn("shape-failed config.json quarantined; reseeding normalized values", {
            issues,
            quarantinedTo: configShapeQuarantinedTo,
          });
        }
      }

      const effectiveSettings = loadedSettings;
      // Startup baseline: record the key effective configuration.
      logInfo("config loaded", {
        settings: effectiveSettings,
        hasState: data.state !== null,
        hasPanes: data.panes !== null,
        dataDir: data.dataDir,
      });

      if (data.configQuarantinedTo !== null || configShapeQuarantinedTo !== null) {
        showBlockingError(message("settingsReset.title"), message("settingsReset.body"));
      }

      // Materialize config.json on first run so the settings file exists on disk immediately,
      // not only after the first change (storage-path conventions, "Materializing settings on
      // first run"). data.config is null when the file is absent — either never created, or just
      // quarantined aside (which renames it away) — so this is create-if-absent (an existing
      // config is never overwritten), persisting the real normalized defaults through the normal
      // save_config path rather than a hand-built literal. Without this required
      // baseline, the app cannot truthfully call its current state saved or know
      // that later writes are safe, so a failure retains a halting authored result.
      if (!canceledRef.current && (data.config === null || configShapeQuarantinedTo !== null)) {
        try {
          await saveConfig(effectiveSettings);
        } catch (error) {
          logError("failed to create config.json on first run", {
            error: serializeError(error),
          });
          if (!canceledRef.current) {
            setSaveState("error");
            setLoadErrorIsCorruptPanes(false);
            setLoadError(message("load.configCreateFailed"));
            setLoadStatus("failed");
          }
          return;
        }
      }

      try {
        const initialCount = await countSnapshots();
        if (!canceledRef.current) {
          setSnapshotCount(initialCount);
        }
      } catch (error) {
        // Snapshot count is informational only — recover and continue — but a
        // failure here is still an unexpected error worth recording.
        logWarn("snapshot count failed", { error: serializeError(error) });
      }

      setZoomLevelState(normalizeZoomLevel(data.state?.zoomLevel));

      const defaultTitle = loadTranslator.t("pane.defaultTitle");
      const loadedPanes = normalizePanes(data.panes?.panes, defaultTitle);
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
    } catch (error) {
      if (!canceledRef.current) {
        // Halt: do not transition into a state where any write path can run.
        // The App shell renders a non-dismissible error screen for "failed",
        // so the user's existing files on disk are never overwritten by the
        // default in-memory state.
        logError("load failed", { error: serializeError(error) });
        setLoadErrorIsCorruptPanes(false);
        setLoadError(message("load.failed"));
        setLoadStatus("failed");
      }
    }
  }, [firstPane, showBlockingError]);

  useEffect(() => {
    canceledRef.current = false;
    void loadPersistedState();
    return () => {
      canceledRef.current = true;
    };
  }, [loadPersistedState]);

  // The reset the corrupt-panes halt screen offers: quarantine panes.json on
  // the user's command (the rename either lands or the error surfaces), then
  // reload — the absent store comes back as the default single pane.
  const resetCorruptPanes = useCallback(async () => {
    try {
      const quarantinedTo = await quarantineCorruptPanes();
      logInfo("corrupt panes.json set aside on user command", { quarantinedTo });
      setLoadErrorIsCorruptPanes(false);
      setLoadError(null);
      setLoadStatus("loading");
      await loadPersistedState();
    } catch (error) {
      logError("panes reset failed", { error: serializeError(error) });
      setLoadError(message("load.setAsideFailed"));
      setLoadStatus("failed");
    }
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
  // state.json. The title is not an identity field, so we normalize rather
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
          // logged incidents.
          showToast(`pane-delete:${paneId}`, "warning", message("toast.lastPane"));
          return;
        case "blocked-non-empty":
          showToast(`pane-delete:${paneId}`, "warning", message("toast.nonEmptyPane"));
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
      if (loadStatus !== "ready") {
        return;
      }

      const trimmed = multiline(content);
      if (trimmed.length === 0) {
        return;
      }

      void createSnapshot({ paneId, trigger, content: trimmed })
        .then((result) => {
          if (result.inserted) {
            setSnapshotCount((current) => current + 1);
            setSnapshotJustSavedAt(Date.now());
          }
        })
        .catch((error) => {
          logWarn("snapshot not saved", { trigger, error: serializeError(error) });
          showToast(`snapshot:${paneId}`, "warning", message("toast.snapshotFailed"));
        });
    },
    [loadStatus, showToast],
  );

  const snapshotAllPanes = useCallback(
    async (trigger: SnapshotTrigger) => {
      if (loadStatus !== "ready") {
        return;
      }

      const snapshots = panesRef.current
        .map((pane) => ({
          paneId: pane.id,
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
        setSnapshotCount((current) => current + insertedCount);
        setSnapshotJustSavedAt(Date.now());
      }
    },
    [loadStatus],
  );

  const updateSettings = useCallback((nextSettings: AppSettings) => {
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

  // Throws on failure. Each caller decides whether to surface a modal and/or
  // change control flow, since autosave and the close path want different
  // policies. No-ops unless load succeeded — see the LoadStatus comment in
  // types.ts.
  const saveNow = useCallback(async () => {
    if (loadStatus !== "ready") {
      return;
    }

    const dirtyAtStart = dirtyCounterRef.current;
    setSaveState("saving");
    try {
      await Promise.all([
        saveConfig(settings),
        persistState(buildStateFile(activePaneId, zoomLevel)),
        savePanes(buildPanesFile(panes)),
      ]);
      setSaveState(resolveSaveState(dirtyAtStart, dirtyCounterRef.current));
    } catch (error) {
      setSaveState("error");
      throw error;
    }
  }, [activePaneId, loadStatus, panes, settings, zoomLevel]);

  useEffect(() => {
    if (loadStatus !== "ready" || saveState !== "unsaved") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      saveNow().catch((error) => {
        logError("autosave failed", { error: serializeError(error) });
        showBlockingError(message("saveError.title"), message("saveError.autosave"));
      });
    }, Math.max(1, settings.autosaveDelaySeconds) * 1000);

    return () => window.clearTimeout(timeoutId);
  }, [loadStatus, saveNow, saveState, settings.autosaveDelaySeconds, showBlockingError]);

  const value = useMemo<AppStateContextValue>(
    () => ({
      panes,
      activePaneId,
      activePane,
      settings,
      language,
      zoomLevel,
      saveState,
      toasts,
      blockingError,
      dataDir,
      loadStatus,
      loadError,
      loadErrorIsCorruptPanes,
      snapshotCount,
      snapshotJustSavedAt,
      setActivePaneId,
      updatePaneTitle,
      commitPaneTitle,
      updatePaneContent,
      addPane,
      deletePane,
      movePane,
      updateSettings,
      setZoomLevel,
      resetCorruptPanes,
      saveNow,
      recordSnapshot,
      snapshotAllPanes,
      showToast,
      dismissToast,
      showBlockingError,
      dismissBlockingError,
    }),
    [
      activePane,
      activePaneId,
      addPane,
      blockingError,
      commitPaneTitle,
      dataDir,
      deletePane,
      dismissBlockingError,
      dismissToast,
      loadError,
      loadErrorIsCorruptPanes,
      loadStatus,
      movePane,
      language,
      panes,
      recordSnapshot,
      resetCorruptPanes,
      saveNow,
      saveState,
      setZoomLevel,
      settings,
      showBlockingError,
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
      <I18nProvider language={language} locale={locale}>
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
