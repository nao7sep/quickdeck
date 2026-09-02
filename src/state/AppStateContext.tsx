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
  // The webview zoom — session state (state.json), not a setting, so it rides
  // beside `settings` rather than inside it (persisted-store-separation).
  zoomLevel: number;
  saveState: SaveState;
  toasts: Toast[];
  blockingError: BlockingError | null;
  dataDir: string;
  loadStatus: LoadStatus;
  loadError: string | null;
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
  showToast: (kind: ToastKind, message: string) => void;
  dismissToast: (toastId: string) => void;
  showBlockingError: (title: string, message: string) => void;
  dismissBlockingError: () => void;
};

const AppStateContext = createContext<AppStateContextValue | undefined>(undefined);

export function paneReadFailureMessage(): string {
  return "Your pane text file (panes.json) could not be read and has been left exactly where it is. Check that the data folder is available and that QuickDeck has access, then try again. Diagnostic details are in the log.";
}

export function paneShapeFailureMessage(): string {
  return "Your pane text file (panes.json) is damaged and has been left exactly where it is. Diagnostic details are in the log.";
}

export function settingsResetMessage(): string {
  return "A settings file was unreadable, so QuickDeck preserved it and started with defaults for it. The preserved copy's location is recorded in the log. Your pane text is untouched.";
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const firstPane = useMemo(() => createDefaultPane(nanoid()), []);
  const [panes, setPanes] = useState<Pane[]>([firstPane]);
  const [activePaneId, setActivePaneId] = useState(firstPane.id);
  const [settings, setSettings] = useState(defaultSettings);
  const [zoomLevel, setZoomLevelState] = useState(ZOOM_DEFAULT);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [blockingError, setBlockingError] = useState<BlockingError | null>(null);
  const [dataDir, setDataDir] = useState("Loading...");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  // True when the failure is specifically a corrupt panes.json — the one halt
  // whose screen offers the explicit set-aside reset.
  const [loadErrorIsCorruptPanes, setLoadErrorIsCorruptPanes] = useState(false);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [snapshotJustSavedAt, setSnapshotJustSavedAt] = useState<number | null>(null);
  const panesRef = useRef(panes);
  // Monotonic counter bumped on every edit. saveNow snapshots the value at the
  // start of a save and only flips back to "saved" when the counter has not
  // moved during the save — keeps an edit from being lost in a save race.
  const dirtyCounterRef = useRef(0);

  useEffect(() => {
    panesRef.current = panes;
  }, [panes]);

  const markUnsaved = useCallback(() => {
    dirtyCounterRef.current += 1;
    setSaveState("unsaved");
  }, []);

  const activePane = useMemo(() => {
    return panes.find((pane) => pane.id === activePaneId) ?? panes[0];
  }, [activePaneId, panes]);

  const showToast = useCallback((kind: ToastKind, message: string) => {
    const id = nanoid();
    setToasts((current) => [...current, { id, kind, message }]);
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

  const showBlockingError = useCallback((title: string, message: string) => {
    setBlockingError({ title, message });
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

      // panes.json carries the user's text: present-but-unreadable HALTS the
      // app (the file is left exactly in place; the error screen offers the
      // explicit set-aside reset) while config and state still loaded — each
      // store fails on its own branch (persisted-store-separation).
      if (data.panesError !== null) {
        logError("panes load failed", { error: data.panesError });
        setLoadErrorIsCorruptPanes(true);
        setLoadError(paneReadFailureMessage());
        setLoadStatus("failed");
        return;
      }

      // Check the version before this build's shape. A newer schema may be
      // intentionally different and must never be offered the corrupt-file reset.
      const panesVersion = (data.panes as { version?: unknown } | null)?.version;
      if (typeof panesVersion === "number" && panesVersion > 1) {
        logError("panes.json is from a newer build", { version: panesVersion });
        setLoadErrorIsCorruptPanes(false);
        setLoadError(
          `Your pane text file (panes.json) was written by a newer version of QuickDeck (format ${panesVersion}) and has been left exactly in place. Update QuickDeck to open it.`,
        );
        setLoadStatus("failed");
        return;
      }

      if (data.panes !== null) {
        const paneIssues = panesShapeIssues(data.panes);
        if (paneIssues.length > 0) {
          logError("panes.json failed its shape check", { issues: paneIssues });
          setLoadErrorIsCorruptPanes(true);
          setLoadError(paneShapeFailureMessage());
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

      const effectiveSettings = normalizeSettings(data.config);
      setSettings(effectiveSettings);
      // Startup baseline: record the key effective configuration.
      logInfo("config loaded", {
        settings: effectiveSettings,
        hasState: data.state !== null,
        hasPanes: data.panes !== null,
        dataDir: data.dataDir,
      });

      if (data.configQuarantinedTo !== null || configShapeQuarantinedTo !== null) {
        showBlockingError(
          "A Settings File Was Reset",
          settingsResetMessage(),
        );
      }

      // Materialize config.json on first run so the settings file exists on disk immediately,
      // not only after the first change (storage-path conventions, "Materializing settings on
      // first run"). data.config is null when the file is absent — either never created, or just
      // quarantined aside (which renames it away) — so this is create-if-absent (an existing
      // config is never overwritten), persisting the real normalized defaults through the normal
      // save_config path rather than a hand-built literal. A write failure is logged, not fatal.
      if (!canceledRef.current && (data.config === null || configShapeQuarantinedTo !== null)) {
        try {
          await saveConfig(effectiveSettings);
        } catch (error) {
          logWarn("failed to create config.json on first run", { error: serializeError(error) });
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

      const loadedPanes = normalizePanes(data.panes?.panes);
      if (loadedPanes.length > 0) {
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
        setLoadError("QuickDeck could not read its saved data. The diagnostic details are in the log.");
        setLoadStatus("failed");
      }
    }
  }, [showBlockingError]);

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
      setLoadError("The damaged pane file could not be set aside. Your existing files were not changed.");
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
    setPanes((current) => appendPane(current, paneId));
    setActivePaneId(paneId);
    markUnsaved();
    logInfo("pane added", { paneId });
  }, [markUnsaved]);

  const deletePane = useCallback(
    (paneId: string) => {
      const outcome = deletePaneOp(panes, paneId, activePaneId);

      switch (outcome.kind) {
        case "not-found":
          return;
        case "blocked-last":
          // Expected, anticipated outcomes surfaced to the user as toasts — not
          // logged incidents.
          showToast("warning", "At least one pane must remain.");
          return;
        case "blocked-non-empty":
          showToast("warning", "Only empty panes can be deleted.");
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
          showToast("warning", "The snapshot wasn’t saved. Your pane content is still open.");
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
        showBlockingError(
          "QuickDeck couldn't save your data",
          "Your latest changes remain open. Free some storage or restore access to the data folder, then try again.",
        );
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

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const value = useContext(AppStateContext);
  if (!value) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return value;
}
