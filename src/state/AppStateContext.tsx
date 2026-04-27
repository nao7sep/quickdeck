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
import { randomPaneColor } from "../utils/paneColors";
import {
  buildSessionState,
  countSnapshots,
  createSnapshot,
  createSnapshots,
  loadAppData,
  saveConfig,
  saveSession,
} from "../services/persistence";
import type {
  AppSettings,
  BlockingError,
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
  snapshotCount: number;
  snapshotJustSavedAt: number | null;
  setActivePaneId: (paneId: string) => void;
  updatePaneTitle: (paneId: string, title: string) => void;
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
  const [loaded, setLoaded] = useState(false);
  const [snapshotCount, setSnapshotCount] = useState(0);
  const [snapshotJustSavedAt, setSnapshotJustSavedAt] = useState<number | null>(null);
  const panesRef = useRef(panes);

  useEffect(() => {
    panesRef.current = panes;
  }, [panes]);

  const markUnsaved = useCallback(() => setSaveState("unsaved"), []);

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
      setSaveState("saving");
      try {
        const data = await loadAppData();
        if (canceled) {
          return;
        }

        setDataDir(data.dataDir);
        setSettings(normalizeSettings(data.config));

        try {
          const initialCount = await countSnapshots();
          if (!canceled) {
            setSnapshotCount(initialCount);
          }
        } catch {
          // Snapshot count is informational only; ignore failures.
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
      } catch (error) {
        if (!canceled) {
          setSaveState("error");
          showBlockingError("Could Not Load Data", String(error));
        }
      } finally {
        if (!canceled) {
          setLoaded(true);
        }
      }
    }

    void loadPersistedState();

    return () => {
      canceled = true;
    };
  }, [showBlockingError]);

  const updatePaneTitle = useCallback(
    (paneId: string, title: string) => {
      setPanes((current) =>
        current.map((pane) => (pane.id === paneId ? { ...pane, title } : pane)),
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
    setPanes((current) => {
      const existingHeaders = current.map((pane) => pane.headerColor);
      const pane = createDefaultPane(nanoid(), existingHeaders);
      setActivePaneId(pane.id);
      return [...current, pane];
    });
    markUnsaved();
  }, [markUnsaved]);

  const deletePane = useCallback(
    (paneId: string) => {
      const pane = panes.find((candidate) => candidate.id === paneId);
      if (!pane) {
        return;
      }

      if (panes.length === 1) {
        showToast("warning", "At least one pane must remain.");
        return;
      }

      if (pane.content.length > 0) {
        showToast("warning", "Only empty panes can be deleted.");
        return;
      }

      const deletedIndex = panes.findIndex((candidate) => candidate.id === paneId);
      const nextPanes = panes.filter((candidate) => candidate.id !== paneId);
      const fallbackActivePane = nextPanes[Math.max(0, deletedIndex - 1)] ?? nextPanes[0];

      setPanes(nextPanes);
      if (activePaneId === paneId) {
        setActivePaneId(fallbackActivePane.id);
      }
      markUnsaved();
    },
    [activePaneId, markUnsaved, panes, showToast],
  );

  const movePane = useCallback(
    (paneId: string, direction: -1 | 1) => {
      setPanes((current) => {
        const fromIndex = current.findIndex((pane) => pane.id === paneId);
        if (fromIndex < 0) {
          return current;
        }
        const toIndex = fromIndex + direction;
        if (toIndex < 0 || toIndex >= current.length) {
          return current;
        }

        const next = [...current];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        markUnsaved();
        return next;
      });
    },
    [markUnsaved],
  );

  const recordSnapshot = useCallback(
    (paneId: string, trigger: SnapshotTrigger, content: string) => {
      if (content.length === 0) {
        return;
      }

      void createSnapshot({ paneId, trigger, content })
        .then((result) => {
          if (result.inserted) {
            setSnapshotCount((current) => current + 1);
            setSnapshotJustSavedAt(Date.now());
          }
        })
        .catch((error) => {
          showToast("warning", `Snapshot was not saved: ${String(error)}`);
        });
    },
    [showToast],
  );

  const snapshotAllPanes = useCallback(
    async (trigger: SnapshotTrigger) => {
      const snapshots = panesRef.current
        .filter((pane) => pane.content.length > 0)
        .map((pane) => ({
          paneId: pane.id,
          trigger,
          content: pane.content,
        }));

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
    [],
  );

  const updateSettings = useCallback((nextSettings: AppSettings) => {
    setSettings(nextSettings);
    setSaveState("unsaved");
  }, []);

  const saveNow = useCallback(async () => {
    if (!loaded) {
      return;
    }

    setSaveState("saving");
    try {
      await Promise.all([
        saveConfig(settings),
        saveSession(buildSessionState(panes, activePaneId)),
      ]);
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      showBlockingError("Could Not Save Data", String(error));
    }
  }, [activePaneId, loaded, panes, settings, showBlockingError]);

  useEffect(() => {
    if (!loaded || saveState !== "unsaved") {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      void saveNow();
    }, Math.max(1, settings.autosaveDelaySeconds) * 1000);

    return () => window.clearTimeout(timeoutId);
  }, [loaded, saveNow, saveState, settings.autosaveDelaySeconds]);

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
      snapshotCount,
      snapshotJustSavedAt,
      setActivePaneId,
      updatePaneTitle,
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
      dataDir,
      deletePane,
      dismissBlockingError,
      dismissToast,
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

function normalizeSettings(settings: AppSettings | null): AppSettings {
  if (!settings) {
    return defaultSettings;
  }

  return {
    ...defaultSettings,
    ...settings,
    autosaveDelaySeconds: clampNumber(settings.autosaveDelaySeconds, 1, 60, defaultSettings.autosaveDelaySeconds),
    snapshotSearchPageSize: clampNumber(
      settings.snapshotSearchPageSize,
      5,
      200,
      defaultSettings.snapshotSearchPageSize,
    ),
    editorFontSize: clampNumber(settings.editorFontSize, 10, 32, defaultSettings.editorFontSize),
  };
}

function normalizePanes(panes: Pane[] | undefined): Pane[] {
  if (!Array.isArray(panes)) {
    return [];
  }

  const accumulatedHeaders: string[] = [];

  return panes
    .filter((pane) => typeof pane.id === "string" && pane.id.length > 0)
    .map((pane) => {
      const hasColors =
        typeof pane.headerColor === "string" &&
        /^#[0-9a-f]{6}$/i.test(pane.headerColor) &&
        typeof pane.backgroundColor === "string" &&
        /^#[0-9a-f]{6}$/i.test(pane.backgroundColor);

      const colors = hasColors
        ? { header: pane.headerColor, background: pane.backgroundColor }
        : randomPaneColor(accumulatedHeaders);

      accumulatedHeaders.push(colors.header);

      return {
        id: pane.id,
        title: typeof pane.title === "string" && pane.title.length > 0 ? pane.title : "New Buffer",
        content: typeof pane.content === "string" ? pane.content : "",
        headerColor: colors.header,
        backgroundColor: colors.background,
      };
    });
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}
