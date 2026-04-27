import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { nanoid } from "nanoid";
import { createDefaultPane, defaultSettings } from "./defaults";
import type { AppSettings, Pane, SaveState, Toast, ToastKind } from "../types";

type AppStateContextValue = {
  panes: Pane[];
  activePaneId: string;
  activePane: Pane;
  settings: AppSettings;
  saveState: SaveState;
  toasts: Toast[];
  setActivePaneId: (paneId: string) => void;
  updatePaneTitle: (paneId: string, title: string) => void;
  updatePaneContent: (paneId: string, content: string) => void;
  addPane: () => void;
  duplicateActivePane: () => void;
  moveActivePane: (direction: -1 | 1) => void;
  deleteActivePane: () => void;
  updateSettings: (settings: AppSettings) => void;
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

  const updateSettings = useCallback((nextSettings: AppSettings) => {
    setSettings(nextSettings);
    setSaveState("unsaved");
  }, []);

  const value = useMemo<AppStateContextValue>(
    () => ({
      panes,
      activePaneId,
      activePane,
      settings,
      saveState,
      toasts,
      setActivePaneId,
      updatePaneTitle,
      updatePaneContent,
      addPane,
      duplicateActivePane,
      moveActivePane,
      deleteActivePane,
      updateSettings,
      showToast,
      dismissToast,
    }),
    [
      activePane,
      activePaneId,
      addPane,
      deleteActivePane,
      dismissToast,
      duplicateActivePane,
      moveActivePane,
      panes,
      saveState,
      settings,
      showToast,
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
