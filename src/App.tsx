import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronsLeft,
  ChevronsRight,
  CopyPlus,
  Eraser,
  Info,
  Keyboard,
  Menu,
  Plus,
  Search,
  Settings,
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
    duplicateActivePane,
    moveActivePane,
    saveNow,
    snapshotAllPanes,
    updateSettings,
  } = useAppState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (openModal || blockingError) {
        return;
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

      if (matchesShortcut(event, "toggleTopmost")) {
        event.preventDefault();
        updateSettings({ ...settings, topmost: !settings.topmost });
      }

      if (matchesShortcut(event, "increaseOpacity")) {
        event.preventDefault();
        updateSettings({ ...settings, opacity: Math.min(1, Number((settings.opacity + 0.05).toFixed(2))) });
      }

      if (matchesShortcut(event, "decreaseOpacity")) {
        event.preventDefault();
        updateSettings({ ...settings, opacity: Math.max(0.45, Number((settings.opacity - 0.05).toFixed(2))) });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePaneId, blockingError, openModal, panes, setActivePaneId, settings, updateSettings]);

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
      });
    }

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      closeUnlisten?.();
    };
  }, [saveNow, snapshotAllPanes]);

  function openMenuModal(modal: OpenModal) {
    setOpenModal(modal);
    setMenuOpen(false);
  }

  return (
    <main className="appShell">
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
      <div className="paneDeck" style={{ opacity: settings.opacity }}>
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
