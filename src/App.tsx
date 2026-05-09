import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  History,
  Info,
  Keyboard,
  Menu,
  Plus,
  Settings,
} from "lucide-react";
import { AboutModal } from "./components/AboutModal";
import { SnapshotSearchModal } from "./components/SnapshotSearchModal";
import { ErrorModal } from "./components/ErrorModal";
import { PaneSwitcher } from "./components/PaneSwitcher";
import { PaneView } from "./components/PaneView";
import { SettingsModal } from "./components/SettingsModal";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { ToastViewport } from "./components/ToastViewport";
import { matchesShortcut } from "./shortcuts";
import { useAppState } from "./state/AppStateContext";

type OpenModal = "settings" | "shortcuts" | "about" | "snapshots" | null;

export function App() {
  const {
    panes,
    activePaneId,
    blockingError,
    dismissBlockingError,
    saveState,
    settings,
    setActivePaneId,
    addPane,
    movePane,
    saveNow,
    showToast,
    snapshotAllPanes,
    snapshotCount,
    snapshotJustSavedAt,
    updateSettings,
  } = useAppState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [snapshotPulse, setSnapshotPulse] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);

  // Brief "snapshot saved" flash whenever the timestamp updates.
  useEffect(() => {
    if (snapshotJustSavedAt === null) {
      return undefined;
    }
    setSnapshotPulse(true);
    const timeoutId = window.setTimeout(() => setSnapshotPulse(false), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [snapshotJustSavedAt]);

  const openMenuModal = useCallback((modal: OpenModal) => {
    setOpenModal(modal);
    setMenuOpen(false);
  }, []);

  const toggleTopmost = useCallback(() => {
    updateSettings({ ...settings, topmost: !settings.topmost });
  }, [settings, updateSettings]);

  const toggleZen = useCallback(() => {
    updateSettings({ ...settings, zen: !settings.zen });
  }, [settings, updateSettings]);

  // Close the hamburger menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    function handleClickOutside(event: MouseEvent) {
      if (menuWrapRef.current && !menuWrapRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (openModal || blockingError) {
        return;
      }

      if (matchesShortcut(event, "addPane")) {
        event.preventDefault();
        addPane();
      }

      if (matchesShortcut(event, "focusPreviousPane")) {
        event.preventDefault();
        const index = panes.findIndex((pane) => pane.id === activePaneId);
        const previous = panes[Math.max(0, index - 1)];
        setActivePaneId(previous.id);
      }

      if (matchesShortcut(event, "focusNextPane")) {
        event.preventDefault();
        const index = panes.findIndex((pane) => pane.id === activePaneId);
        const next = panes[Math.min(panes.length - 1, index + 1)];
        setActivePaneId(next.id);
      }

      if (matchesShortcut(event, "movePaneLeft")) {
        event.preventDefault();
        movePane(activePaneId, -1);
      }

      if (matchesShortcut(event, "movePaneRight")) {
        event.preventDefault();
        movePane(activePaneId, 1);
      }

      if (matchesShortcut(event, "openSettings")) {
        event.preventDefault();
        openMenuModal("settings");
      }

      if (matchesShortcut(event, "openShortcuts")) {
        event.preventDefault();
        openMenuModal("shortcuts");
      }

      if (matchesShortcut(event, "toggleTopmost")) {
        event.preventDefault();
        toggleTopmost();
      }

      if (matchesShortcut(event, "toggleZen")) {
        event.preventDefault();
        toggleZen();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activePaneId,
    addPane,
    blockingError,
    movePane,
    openMenuModal,
    openModal,
    panes,
    setActivePaneId,
    settings,
    toggleTopmost,
    toggleZen,
    updateSettings,
  ]);

  useEffect(() => {
    if (!isTauri()) {
      return undefined;
    }

    const appWindow = getCurrentWindow();
    void appWindow.setAlwaysOnTop(settings.topmost).catch((error) => {
      showToast("warning", `Could not update always-on-top: ${String(error)}`);
    });

    return undefined;
  }, [settings.topmost, showToast]);

  // Keep latest persistence callbacks in refs so the close handler can be
  // registered exactly once on mount without re-attaching on every keystroke.
  const saveNowRef = useRef(saveNow);
  const snapshotAllPanesRef = useRef(snapshotAllPanes);
  const showToastRef = useRef(showToast);

  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  useEffect(() => {
    snapshotAllPanesRef.current = snapshotAllPanes;
  }, [snapshotAllPanes]);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    const appWindow = isTauri() ? getCurrentWindow() : null;
    let closeUnlisten: (() => void) | undefined;
    let closing = false;

    async function persistCloseState() {
      try {
        await snapshotAllPanesRef.current("app_close");
      } catch {
        // Session save still matters if insurance snapshots fail during shutdown.
      }
      try {
        await saveNowRef.current();
      } catch {
        // saveNow surfaces its own blocking error; swallow here so shutdown proceeds.
      }
    }

    function handleBeforeUnload() {
      void persistCloseState();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    if (appWindow) {
      void appWindow.onCloseRequested(async (event) => {
        if (closing) {
          return;
        }

        closing = true;
        event.preventDefault();

        try {
          await persistCloseState();
        } finally {
          try {
            await appWindow.destroy();
          } catch (error) {
            showToastRef.current("error", `Could not close window: ${String(error)}`);
            closing = false;
          }
        }
      }).then((unlisten) => {
        closeUnlisten = unlisten;
      }).catch((error) => {
        showToastRef.current("warning", `Could not register close handler: ${String(error)}`);
      });
    }

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      closeUnlisten?.();
    };
  }, []);

  const visiblePanes = settings.zen
    ? [panes.find((pane) => pane.id === activePaneId) ?? panes[0]]
    : panes;

  return (
    <main className="appShell">
      <div className="paneDeck">
        {visiblePanes.map((pane) => (
          <PaneView pane={pane} key={pane.id} />
        ))}
      </div>
      <footer className="appStatusBar">
        {settings.zen ? (
          <PaneSwitcher panes={panes} activePaneId={activePaneId} onSelect={setActivePaneId} />
        ) : null}
        <div className="statusBarRight">
          {!settings.zen ? (
            <>
              <span className="statusBadge statusBadge-info">
                {panes.length} {panes.length === 1 ? "pane" : "panes"}
              </span>
              <span className="statusBadge statusBadge-info">
                {snapshotCount.toLocaleString()} snapshots
              </span>
            </>
          ) : null}
          {snapshotPulse ? (
            <span className="statusBadge statusBadge-snapshot">Snapshot saved</span>
          ) : null}
          {settings.zen ? (
            <button
              type="button"
              className="statusBadge statusBadge-zen statusBadgeButton"
              title="Click to disable zen mode"
              onClick={toggleZen}
            >
              Zen
            </button>
          ) : null}
          {settings.topmost ? (
            <button
              type="button"
              className="statusBadge statusBadge-topmost statusBadgeButton"
              title="Click to disable always on top"
              onClick={toggleTopmost}
            >
              Topmost
            </button>
          ) : null}
          <span className={`statusBadge saveState saveState-${saveState}`}>{saveState}</span>
          <div className="menuWrap" ref={menuWrapRef}>
            <button className="statusMenuButton" type="button" aria-label="Open menu" onClick={() => setMenuOpen((open) => !open)}>
              <Menu size={18} />
            </button>
            {menuOpen ? (
              <div className="menuPanel menuPanelUp">
                <button type="button" onClick={() => { addPane(); setMenuOpen(false); }}>
                  <Plus size={16} />
                  Add Pane
                </button>
                <button type="button" onClick={() => openMenuModal("settings")}>
                  <Settings size={16} />
                  Settings
                </button>
                <button type="button" onClick={() => openMenuModal("shortcuts")}>
                  <Keyboard size={16} />
                  Shortcuts
                </button>
                <button type="button" onClick={() => openMenuModal("snapshots")}>
                  <History size={16} />
                  Snapshot Search
                </button>
                <button type="button" onClick={() => openMenuModal("about")}>
                  <Info size={16} />
                  About
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </footer>
      {openModal === "settings" ? <SettingsModal onClose={() => setOpenModal(null)} /> : null}
      {openModal === "shortcuts" ? <ShortcutsModal onClose={() => setOpenModal(null)} /> : null}
      {openModal === "about" ? <AboutModal onClose={() => setOpenModal(null)} /> : null}
      {openModal === "snapshots" ? <SnapshotSearchModal onClose={() => setOpenModal(null)} /> : null}
      {blockingError ? <ErrorModal error={blockingError} onClose={dismissBlockingError} /> : null}
      <ToastViewport />
    </main>
  );
}
