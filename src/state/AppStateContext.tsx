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
  buildSessionState,
  createSnapshot,
  createSnapshots,
  loadAppData,
  saveConfig,
  saveSession,
} from "../services/persistence";
import type { AppSettings, Pane, SaveState, SnapshotTrigger, Toast, ToastKind } from "../types";

type AppStateContextValue = {
  panes: Pane[];
  activePaneId: string;
  activePane: Pane;
  settings: AppSettings;
  saveState: SaveState;
  toasts: Toast[];
  dataDir: string;
  setActivePaneId: (paneId: string) => void;
  updatePaneTitle: (paneId: string, title: string) => void;
  updatePaneContent: (paneId: string, content: string) => void;
  addPane: () => void;
  duplicateActivePane: () => void;
  moveActivePane: (direction: -1 | 1) => void;
  deleteActivePane: () => void;
  clearActivePane: () => void;
  updateSettings: (settings: AppSettings) => void;
  saveNow: () => Promise<void>;
  recordSnapshot: (paneId: string, trigger: SnapshotTrigger, content: string) => void;
  snapshotAllPanes: (trigger: SnapshotTrigger) => Promise<void>;
  showToast: (kind: ToastKind, message: string) => void;
  dismissToast: (toastId: string) => void;
};

const AppStateContext = createContext<AppStateContextValue | undefined>(undefined);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const firstPane = useMemo(() => createDefaultPane(nanoid()), []);
  const [panes, setPanes] = useState<Pane[]>([firstPane]);
  const [activePaneId, setActivePaneId] = useState(firstPane.id);
  const [settings, setSettings] = useState(defaultSettings);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dataDir, setDataDir] = useState("Loading...");
  const [loaded, setLoaded] = useState(false);
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
          showToast("error", `Could not load app data: ${String(error)}`);
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
  }, [showToast]);

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
    const pane: Pane = {
      id: nanoid(),
      title: `Buffer ${panes.length + 1}`,
      content: "",
    };
    setPanes((current) => [...current, pane]);
    setActivePaneId(pane.id);
    markUnsaved();
  }, [markUnsaved, panes.length]);

  const duplicateActivePane = useCallback(() => {
    const pane: Pane = {
      id: nanoid(),
      title: `${activePane.title || "Buffer"} copy`,
      content: activePane.content,
    };
    setPanes((current) => {
      const activeIndex = current.findIndex((candidate) => candidate.id === activePane.id);
      const next = [...current];
      next.splice(activeIndex + 1, 0, pane);
      return next;
    });
    setActivePaneId(pane.id);
    markUnsaved();
  }, [activePane, markUnsaved]);

  const moveActivePane = useCallback(
    (direction: -1 | 1) => {
      setPanes((current) => {
        const index = current.findIndex((pane) => pane.id === activePaneId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
          return current;
        }
        const next = [...current];
        const [pane] = next.splice(index, 1);
        next.splice(nextIndex, 0, pane);
        markUnsaved();
        return next;
      });
    },
    [activePaneId, markUnsaved],
  );

  const deleteActivePane = useCallback(() => {
    if (panes.length === 1) {
      showToast("warning", "At least one pane must remain.");
      return;
    }
    if (activePane.content.length > 0) {
      showToast("warning", "Only empty panes can be deleted.");
      return;
    }

    const activeIndex = panes.findIndex((pane) => pane.id === activePane.id);
    const nextPanes = panes.filter((pane) => pane.id !== activePane.id);
    const nextActive = nextPanes[Math.max(0, activeIndex - 1)] ?? nextPanes[0];

    setPanes(nextPanes);
    setActivePaneId(nextActive.id);
    markUnsaved();
  }, [activePane, markUnsaved, panes, showToast]);

  const recordSnapshot = useCallback(
    (paneId: string, trigger: SnapshotTrigger, content: string) => {
      if (content.length === 0) {
        return;
      }

      void createSnapshot({ paneId, trigger, content }).catch((error) => {
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

      await createSnapshots(snapshots);
    },
    [],
  );

  const clearActivePane = useCallback(() => {
    if (activePane.content.length === 0) {
      return;
    }

    recordSnapshot(activePane.id, "clear", activePane.content);
    setPanes((current) =>
      current.map((pane) => (pane.id === activePane.id ? { ...pane, content: "" } : pane)),
    );
    markUnsaved();
  }, [activePane, markUnsaved, recordSnapshot]);

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
      showToast("error", `Could not save app data: ${String(error)}`);
    }
  }, [activePaneId, loaded, panes, settings, showToast]);

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
      dataDir,
      setActivePaneId,
      updatePaneTitle,
      updatePaneContent,
      addPane,
      duplicateActivePane,
      moveActivePane,
      deleteActivePane,
      clearActivePane,
      updateSettings,
      saveNow,
      recordSnapshot,
      snapshotAllPanes,
      showToast,
      dismissToast,
    }),
    [
      activePane,
      activePaneId,
      addPane,
      clearActivePane,
      dataDir,
      deleteActivePane,
      dismissToast,
      duplicateActivePane,
      moveActivePane,
      panes,
      recordSnapshot,
      saveNow,
      saveState,
      settings,
      showToast,
      snapshotAllPanes,
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
    opacity: clampNumber(settings.opacity, 0.45, 1, defaultSettings.opacity),
    editorFontSize: clampNumber(settings.editorFontSize, 10, 32, defaultSettings.editorFontSize),
  };
}

function normalizePanes(panes: Pane[] | undefined): Pane[] {
  if (!Array.isArray(panes)) {
    return [];
  }

  return panes
    .filter((pane) => typeof pane.id === "string" && pane.id.length > 0)
    .map((pane, index) => ({
      id: pane.id,
      title: typeof pane.title === "string" && pane.title.length > 0 ? pane.title : `Buffer ${index + 1}`,
      content: typeof pane.content === "string" ? pane.content : "",
    }));
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}
