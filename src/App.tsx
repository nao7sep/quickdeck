import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Info,
  Keyboard,
  Menu,
  Plus,
  Settings,
} from "lucide-react";
import { AboutModal } from "./components/AboutModal";
import { ErrorModal } from "./components/ErrorModal";
import { PaneView } from "./components/PaneView";
import { SettingsModal } from "./components/SettingsModal";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { ToastViewport } from "./components/ToastViewport";
import { matchesShortcut } from "./shortcuts";
import { useAppState } from "./state/AppStateContext";

type OpenModal = "settings" | "shortcuts" | "about" | null;

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
        <h1 className="appTitle">QuickDeck</h1>
        <div className="headerStatus">
          <span>{settings.topmost ? "Topmost" : "Normal"}</span>
          <span>{Math.round(settings.opacity * 100)}%</span>
          <span className={`saveState saveState-${saveState}`}>{saveState}</span>
        </div>
        <div className="menuWrap">
          <button className="iconButton" type="button" aria-label="Open menu" onClick={() => setMenuOpen((open) => !open)}>
            <Menu size={18} />
          </button>
          {menuOpen ? (
            <div className="menuPanel">
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
              <button type="button" onClick={() => openMenuModal("about")}>
                <Info size={16} />
                About
              </button>
            </div>
          ) : null}
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
      {blockingError ? <ErrorModal error={blockingError} onClose={dismissBlockingError} /> : null}
      <ToastViewport />
    </main>
  );
}
