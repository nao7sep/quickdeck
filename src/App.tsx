import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  History,
  Info,
  Keyboard,
  Menu,
  Minus,
  Plus,
  Settings,
} from "lucide-react";
import { AboutModal } from "./components/AboutModal";
import { SnapshotSearchModal } from "./components/SnapshotSearchModal";
import { ErrorModal } from "./components/ErrorModal";
import { LoadErrorScreen } from "./components/LoadErrorScreen";
import { PaneSwitcher } from "./components/PaneSwitcher";
import { PaneView } from "./components/PaneView";
import { SettingsModal } from "./components/SettingsModal";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { ToastViewport } from "./components/ToastViewport";
import { matchesShortcut } from "./shortcuts";
import { useAppState } from "./state/AppStateContext";
import { isZoomIn, isZoomOut, isZoomReset, stepZoomIn, stepZoomOut, ZOOM_DEFAULT } from "./utils/zoom";

type OpenModal = "settings" | "shortcuts" | "about" | "snapshots" | null;

export function App() {
  const {
    panes,
    activePaneId,
    blockingError,
    dismissBlockingError,
    loadError,
    loadStatus,
    saveState,
    settings,
    setActivePaneId,
    addPane,
    movePane,
    saveNow,
    showBlockingError,
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

  // Keep latest settings in a ref so the zoom keyboard effect below can read
  // the current value without re-registering on every settings change.
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  // Apply zoom level to the Tauri webview whenever it changes.
  useEffect(() => {
    if (!isTauri()) return undefined;
    getCurrentWebview()
      .setZoom(settings.zoomLevel)
      .catch((e) => console.warn("[zoom] Failed to set zoom:", e));
  }, [settings.zoomLevel]);

  // Zoom keyboard shortcuts — separate effect with its own document listener so
  // they work even when a modal is open (zoom should always be accessible).
  const zoomLevelRef = useRef(settings.zoomLevel);
  useEffect(() => { zoomLevelRef.current = settings.zoomLevel; }, [settings.zoomLevel]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isZoomIn(e)) {
        e.preventDefault();
        updateSettings({ ...settingsRef.current, zoomLevel: stepZoomIn(zoomLevelRef.current) });
      } else if (isZoomOut(e)) {
        e.preventDefault();
        updateSettings({ ...settingsRef.current, zoomLevel: stepZoomOut(zoomLevelRef.current) });
      } else if (isZoomReset(e)) {
        e.preventDefault();
        updateSettings({ ...settingsRef.current, zoomLevel: ZOOM_DEFAULT });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [updateSettings]);

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
      if (loadStatus !== "ready" || openModal || blockingError) {
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
    loadStatus,
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
  const showBlockingErrorRef = useRef(showBlockingError);

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
    showBlockingErrorRef.current = showBlockingError;
  }, [showBlockingError]);

  useEffect(() => {
    const appWindow = isTauri() ? getCurrentWindow() : null;
    let closeUnlisten: (() => void) | undefined;
    let closeInFlight = false;

    async function persistCloseState(): Promise<boolean> {
      try {
        await snapshotAllPanesRef.current("app_close");
      } catch {
        // Insurance snapshots are best-effort; proceed to the real save.
      }
      try {
        await saveNowRef.current();
        return true;
      } catch (error) {
        showBlockingErrorRef.current("Could Not Save Data", String(error));
        return false;
      }
    }

    function handleBeforeUnload() {
      void persistCloseState();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    if (appWindow) {
      void appWindow.onCloseRequested(async (event) => {
        // We own the close lifecycle on every invocation. preventDefault must
        // run before the in-flight guard, otherwise a second close request
        // arriving during a slow save would let Tauri tear the window down
        // mid-write.
        event.preventDefault();
        if (closeInFlight) {
          return;
        }
        closeInFlight = true;
        try {
          const saved = await persistCloseState();
          if (!saved) {
            // The blocking-error modal is now visible. Leave the window open
            // so the user can fix the underlying problem and try closing
            // again; finally resets the flag.
            return;
          }
          await appWindow.destroy();
        } catch (error) {
          showToastRef.current("error", `Could not close window: ${String(error)}`);
        } finally {
          closeInFlight = false;
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

  if (loadStatus === "failed") {
    return <LoadErrorScreen error={loadError ?? "Unknown error while loading saved data."} />;
  }

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
                <div className="menuDivider" />
                <div className="menuZoomRow">
                  <span>Zoom</span>
                  <div className="menuZoomControls">
                    <button
                      type="button"
                      className="menuZoomButton"
                      onClick={() => updateSettings({ ...settings, zoomLevel: stepZoomOut(settings.zoomLevel) })}
                      disabled={stepZoomOut(settings.zoomLevel) === settings.zoomLevel}
                      title="Zoom out"
                    >
                      <Minus size={12} />
                    </button>
                    {settings.zoomLevel !== ZOOM_DEFAULT ? (
                      <button
                        type="button"
                        className="menuZoomLabel menuZoomLabelClickable"
                        onClick={() => updateSettings({ ...settings, zoomLevel: ZOOM_DEFAULT })}
                        title="Reset to 100%"
                      >
                        {Math.round(settings.zoomLevel * 100)}%
                      </button>
                    ) : (
                      <span className="menuZoomLabel">
                        {Math.round(settings.zoomLevel * 100)}%
                      </span>
                    )}
                    <button
                      type="button"
                      className="menuZoomButton"
                      onClick={() => updateSettings({ ...settings, zoomLevel: stepZoomIn(settings.zoomLevel) })}
                      disabled={stepZoomIn(settings.zoomLevel) === settings.zoomLevel}
                      title="Zoom in"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
                <div className="menuDivider" />
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
