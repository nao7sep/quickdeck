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
import { normalizePanes, normalizeSettings } from "./normalize";
import { appendPane, deletePane as deletePaneOp, reorderPane } from "./paneOps";
import { multiline, singleLine } from "../utils/textCleanup";
import { resolveSaveState } from "../utils/saveRace";
import {
  buildSessionState,
  countSnapshots,
  createSnapshot,
  createSnapshots,
  loadAppData,
  saveConfig,
  saveSession,
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
  saveState: SaveState;
  toasts: Toast[];
  blockingError: BlockingError | null;
  dataDir: string;
  loadStatus: LoadStatus;
  loadError: string | null;
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
  saveNow: () => Promise<void>;
  recordSnapshot: (paneId: string, trigger: SnapshotTrigger, content: string) => void;
  snapshotAllPanes: (trigger: SnapshotTrigger) => Promise<void>;
  showToast: (kind: ToastKind, message: string) => void;
  dismissToast: (toastId: string) => void;
  showBlockingError: (title: string, message: string) => void;
  dismissBlockingError: () => void;
};

const AppStateContext = createContext<AppStateContextValue | undefined>(undefined);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const firstPane = useMemo(() => createDefaultPane(nanoid()), []);
  const [panes, setPanes] = useState<Pane[]>([firstPane]);
  const [activePaneId, setActivePaneId] = useState(firstPane.id);
  const [settings, setSettings] = useState(defaultSettings);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [blockingError, setBlockingError] = useState<BlockingError | null>(null);
  const [dataDir, setDataDir] = useState("Loading...");
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
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
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
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

  useEffect(() => {
    let canceled = false;

    async function loadPersistedState() {
      try {
        const data = await loadAppData();
        if (canceled) {
          return;
        }

        // Adopt the authoritative debug gate before logging anything else.
        setDebugEnabled(data.debugEnabled);
        setDataDir(data.dataDir);
        const effectiveSettings = normalizeSettings(data.config);
        setSettings(effectiveSettings);
        // Startup baseline: record the key effective configuration.
        logInfo("config loaded", {
          settings: effectiveSettings,
          hasSession: data.session !== null,
          dataDir: data.dataDir,
        });

        try {
          const initialCount = await countSnapshots();
          if (!canceled) {
            setSnapshotCount(initialCount);
          }
        } catch (error) {
          // Snapshot count is informational only — recover and continue — but a
          // failure here is still an unexpected error worth recording.
          logWarn("snapshot count failed", { error: serializeError(error) });
        }

        const loadedPanes = normalizePanes(data.session?.panes);
        if (loadedPanes.length > 0) {
          setPanes(loadedPanes);
          const loadedActivePane = loadedPanes.some((pane) => pane.id === data.session?.activePaneId)
            ? data.session?.activePaneId
            : loadedPanes[0].id;
          setActivePaneId(loadedActivePane ?? loadedPanes[0].id);
        }

        setSaveState("saved");
        setLoadStatus("ready");
      } catch (error) {
        if (!canceled) {
          // Halt: do not transition into a state where any write path can run.
          // The App shell renders a non-dismissible error screen for "failed",
          // so the user's existing files on disk are never overwritten by the
          // default in-memory state.
          logError("load failed", { error: serializeError(error) });
          setLoadError(String(error));
          setLoadStatus("failed");
        }
      }
    }

    void loadPersistedState();

    return () => {
      canceled = true;
    };
  }, []);

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
          showToast("warning", `Snapshot was not saved: ${String(error)}`);
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
        saveSession(buildSessionState(panes, activePaneId)),
      ]);
      setSaveState(resolveSaveState(dirtyAtStart, dirtyCounterRef.current));
    } catch (error) {
      setSaveState("error");
      throw error;
    }
  }, [activePaneId, loadStatus, panes, settings]);

  useEffect(() => {
    if (loadStatus !== "ready" || saveState !== "unsaved") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      saveNow().catch((error) => {
        logError("autosave failed", { error: serializeError(error) });
        showBlockingError("Could Not Save Data", String(error));
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
      saveState,
      toasts,
      blockingError,
      dataDir,
      loadStatus,
      loadError,
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
      loadStatus,
      movePane,
      panes,
      recordSnapshot,
      saveNow,
      saveState,
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
