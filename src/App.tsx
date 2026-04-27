import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronsLeft,
  ChevronsRight,
  CopyPlus,
  Eraser,
  Eye,
  EyeOff,
  Info,
  Keyboard,
  Menu,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { AboutModal } from "./components/AboutModal";
import { ErrorModal } from "./components/ErrorModal";
import { PaneView } from "./components/PaneView";
import { SettingsModal } from "./components/SettingsModal";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { SnapshotSearchModal } from "./components/SnapshotSearchModal";
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
    clearActivePane,
    deleteActivePane,
    duplicateActivePane,
    moveActivePane,
    saveNow,
    showToast,
    snapshotAllPanes,
    updateSettings,
  } = useAppState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  const openMenuModal = useCallback((modal: OpenModal) => {
    setOpenModal(modal);
    setMenuOpen(false);
  }, []);

  const toggleTopmost = useCallback(() => {
    updateSettings({ ...settings, topmost: !settings.topmost });
  }, [settings, updateSettings]);

  const adjustOpacity = useCallback(
    (delta: number) => {
      updateSettings({
        ...settings,
        opacity: Math.min(1, Math.max(0.45, Number((settings.opacity + delta).toFixed(2)))),
      });
    },
    [settings, updateSettings],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (openModal || blockingError) {
        return;
      }

      if (matchesShortcut(event, "addPane")) {
        event.preventDefault();
        addPane();
      }

      if (matchesShortcut(event, "duplicatePane")) {
        event.preventDefault();
        duplicateActivePane();
      }

      if (matchesShortcut(event, "clearPane")) {
        event.preventDefault();
        clearActivePane();
      }

      if (matchesShortcut(event, "deletePane")) {
        event.preventDefault();
        deleteActivePane();
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
        moveActivePane(-1);
      }

      if (matchesShortcut(event, "movePaneRight")) {
        event.preventDefault();
        moveActivePane(1);
      }

      if (matchesShortcut(event, "openSnapshotSearch")) {
        event.preventDefault();
        openMenuModal("snapshots");
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

      if (matchesShortcut(event, "increaseOpacity")) {
        event.preventDefault();
        adjustOpacity(0.05);
      }

      if (matchesShortcut(event, "decreaseOpacity")) {
        event.preventDefault();
        adjustOpacity(-0.05);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activePaneId,
    addPane,
    adjustOpacity,
    blockingError,
    clearActivePane,
    deleteActivePane,
    duplicateActivePane,
    moveActivePane,
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
    <main className="appShell" style={{ opacity: settings.opacity }}>
      <header className="appHeader">
        <div className="menuWrap">
          <button className="iconTextButton" type="button" onClick={() => setMenuOpen((open) => !open)}>
            <Menu size={18} />
            <span>QuickDeck</span>
          </button>
          {menuOpen ? (
            <div className="menuPanel">
              <button type="button" onClick={addPane}>
                <Plus size={16} />
                Add Pane
              </button>
              <button type="button" onClick={duplicateActivePane}>
                <CopyPlus size={16} />
                Duplicate Pane
              </button>
              <button type="button" onClick={clearActivePane}>
                <Eraser size={16} />
                Clear Pane
              </button>
              <button type="button" onClick={deleteActivePane}>
                <Trash2 size={16} />
                Delete Empty Pane
              </button>
              <button type="button" onClick={() => moveActivePane(-1)}>
                <ChevronsLeft size={16} />
                Move Pane Left
              </button>
              <button type="button" onClick={() => moveActivePane(1)}>
                <ChevronsRight size={16} />
                Move Pane Right
              </button>
              <button type="button" onClick={() => openMenuModal("snapshots")}>
                <Search size={16} />
                Snapshot Search
              </button>
              <button type="button" onClick={toggleTopmost}>
                {settings.topmost ? <PinOff size={16} /> : <Pin size={16} />}
                {settings.topmost ? "Disable Topmost" : "Enable Topmost"}
              </button>
              <button type="button" onClick={() => adjustOpacity(0.05)}>
                <Eye size={16} />
                Increase Opacity
              </button>
              <button type="button" onClick={() => adjustOpacity(-0.05)}>
                <EyeOff size={16} />
                Decrease Opacity
              </button>
              <button type="button" onClick={() => openMenuModal("settings")}>
                <Settings size={16} />
                Settings
              </button>
              <button type="button" onClick={() => openMenuModal("shortcuts")}>
                <Keyboard size={16} />
                Shortcuts
              </button>
              <button type="button" onClick={() => openMenuModal("about")}>
                <Info size={16} />
                About
              </button>
            </div>
          ) : null}
        </div>
        <div className="headerStatus">
          <span>{settings.topmost ? "Topmost" : "Normal"}</span>
          <span>{Math.round(settings.opacity * 100)}%</span>
          <span className={`saveState saveState-${saveState}`}>{saveState}</span>
        </div>
      </header>
      <div className="paneDeck">
        {panes.map((pane) => (
          <PaneView pane={pane} key={pane.id} />
        ))}
      </div>
      {openModal === "settings" ? <SettingsModal onClose={() => setOpenModal(null)} /> : null}
      {openModal === "shortcuts" ? <ShortcutsModal onClose={() => setOpenModal(null)} /> : null}
      {openModal === "about" ? <AboutModal onClose={() => setOpenModal(null)} /> : null}
      {openModal === "snapshots" ? <SnapshotSearchModal onClose={() => setOpenModal(null)} /> : null}
      {blockingError ? <ErrorModal error={blockingError} onClose={dismissBlockingError} /> : null}
      <ToastViewport />
    </main>
  );
}
