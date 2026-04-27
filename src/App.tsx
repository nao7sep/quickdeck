import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  History,
  Info,
  Keyboard,
  Menu,
  Pin,
  Plus,
  Settings,
} from "lucide-react";
import { AboutModal } from "./components/AboutModal";
import { SnapshotSearchModal } from "./components/SnapshotSearchModal";
import { ErrorModal } from "./components/ErrorModal";
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
    updateSettings,
  } = useAppState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const menuWrapRef = useRef<HTMLDivElement | null>(null);

  const openMenuModal = useCallback((modal: OpenModal) => {
    setOpenModal(modal);
    setMenuOpen(false);
  }, []);

  const toggleTopmost = useCallback(() => {
    updateSettings({ ...settings, topmost: !settings.topmost });
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

  useEffect(() => {
    const appWindow = isTauri() ? getCurrentWindow() : null;
    let closeUnlisten: (() => void) | undefined;
    let closing = false;

    async function persistCloseState() {
      try {
        await snapshotAllPanes("app_close");
      } catch {
        // Session save still matters if insurance snapshots fail during shutdown.
      }
      await saveNow();
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
          await appWindow.destroy();
        }
      }).then((unlisten) => {
        closeUnlisten = unlisten;
      }).catch((error) => {
        showToast("warning", `Could not register close handler: ${String(error)}`);
      });
    }

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      closeUnlisten?.();
    };
  }, [saveNow, showToast, snapshotAllPanes]);

  return (
    <main className="appShell">
      <div className="paneDeck">
        {panes.map((pane) => (
          <PaneView pane={pane} key={pane.id} />
        ))}
      </div>
      <footer className="appStatusBar">
        <span className="appTitle">QuickDeck</span>
        <div className="statusBarRight">
          {settings.topmost ? (
            <span className="statusBadge statusBadge-topmost">
              <Pin size={11} />
              Topmost
            </span>
          ) : null}
          <span className={`statusBadge saveState saveState-${saveState}`}>{saveState}</span>
          <div className="menuWrap" ref={menuWrapRef}>
            <button className="statusMenuButton" type="button" aria-label="Open menu" onClick={() => setMenuOpen((open) => !open)}>
              <Menu size={15} />
            </button>
            {menuOpen ? (
              <div className="menuPanel menuPanelUp">
                <button type="button" onClick={addPane}>
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
