import { useEffect, useState } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  CopyPlus,
  Info,
  Keyboard,
  Menu,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { AboutModal } from "./components/AboutModal";
import { PaneView } from "./components/PaneView";
import { SettingsModal } from "./components/SettingsModal";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { SnapshotSearchModal } from "./components/SnapshotSearchModal";
import { ToastViewport } from "./components/ToastViewport";
import { useAppState } from "./state/AppStateContext";

type OpenModal = "settings" | "shortcuts" | "about" | "snapshots" | null;

export function App() {
  const {
    panes,
    activePaneId,
    saveState,
    settings,
    setActivePaneId,
    addPane,
    duplicateActivePane,
    moveActivePane,
    updateSettings,
  } = useAppState();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openModal, setOpenModal] = useState<OpenModal>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const commandOrControl = event.metaKey || event.ctrlKey;
      if (!commandOrControl) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const index = panes.findIndex((pane) => pane.id === activePaneId);
        const previous = panes[Math.max(0, index - 1)];
        setActivePaneId(previous.id);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        const index = panes.findIndex((pane) => pane.id === activePaneId);
        const next = panes[Math.min(panes.length - 1, index + 1)];
        setActivePaneId(next.id);
      }

      if (event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        updateSettings({ ...settings, topmost: !settings.topmost });
      }

      if (event.shiftKey && event.key === "ArrowUp") {
        event.preventDefault();
        updateSettings({ ...settings, opacity: Math.min(1, Number((settings.opacity + 0.05).toFixed(2))) });
      }

      if (event.shiftKey && event.key === "ArrowDown") {
        event.preventDefault();
        updateSettings({ ...settings, opacity: Math.max(0.45, Number((settings.opacity - 0.05).toFixed(2))) });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePaneId, panes, setActivePaneId, settings, updateSettings]);

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
      <ToastViewport />
    </main>
  );
}
