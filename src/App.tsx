import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  History,
  Info,
  Keyboard,
  Menu as MenuIcon,
  Minus,
  Plus,
  Settings,
} from "lucide-react";
import { AboutModal } from "./components/AboutModal";
import { SnapshotSearchModal } from "./components/SnapshotSearchModal";
import { ErrorModal } from "./components/ErrorModal";
import { LoadErrorScreen } from "./components/LoadErrorScreen";
import { Menu, MenuItem } from "./components/Menu";
import { PaneSwitcher } from "./components/PaneSwitcher";
import { PaneView } from "./components/PaneView";
import { SettingsModal } from "./components/SettingsModal";
import { ShortcutsModal } from "./components/ShortcutsModal";
import { ToastViewport } from "./components/ToastViewport";
import { matchesShortcut } from "./shortcuts";
import { isComposingEvent } from "./hooks/useComposing";
import { logError, logWarn, serializeError } from "./services/logger";
import { useAppState } from "./state/AppStateContext";
import { computeWindowMinHeight, computeWindowMinWidth } from "./utils/layoutMetrics";
import { clampPaneIndex } from "./utils/paneIndex";
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
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [snapshotPulse, setSnapshotPulse] = useState(false);

  // Brief "snapshot saved" flash whenever the timestamp updates.
  useEffect(() => {
    if (snapshotJustSavedAt === null) {
      return undefined;
    }
    setSnapshotPulse(true);
    const timeoutId = window.setTimeout(() => setSnapshotPulse(false), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [snapshotJustSavedAt]);

  // The just-in-case data backup is now a write-through store owned entirely by
  // the Rust core (see src-tauri/src/backup_store.rs): every managed-text save
  // records its bytes strictly after the atomic rename lands. There is no startup
  // scan and no frontend backup edge — the old startup-scan ZIP engine is retired.

  const openMenuModal = useCallback((modal: OpenModal) => {
    setOpenModal(modal);
  }, []);

  const toggleDark = useCallback(() => {
    updateSettings({ ...settings, dark: !settings.dark });
  }, [settings, updateSettings]);

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

  // Apply the dark theme by toggling a class on the document root, which flips
  // the CSS custom-property tokens defined in styles.css. Also sync the native
  // window theme so the OS title bar (and the window backing shown briefly while
  // resizing) matches, rather than staying light.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.dark);
    if (isTauri()) {
      getCurrentWindow()
        .setTheme(settings.dark ? "dark" : "light")
        .catch((error) => logWarn("set window theme failed", { dark: settings.dark, error: serializeError(error) }));
    }
  }, [settings.dark]);

  // Apply zoom level to the Tauri webview whenever it changes.
  useEffect(() => {
    if (!isTauri()) return undefined;
    getCurrentWebview()
      .setZoom(settings.zoomLevel)
      .catch((error) => logWarn("set zoom failed", { zoomLevel: settings.zoomLevel, error: serializeError(error) }));
  }, [settings.zoomLevel]);

  // Apply the configured UI font by overriding the `--font-ui` CSS variable on :root; blank reverts
  // to the styles.css default. The string is handed to CSS verbatim (engine-resolved); the pane
  // editor keeps its own editorFontFamily.
  useEffect(() => {
    const family = settings.uiFontFamily.trim();
    if (family) document.documentElement.style.setProperty("--font-ui", family);
    else document.documentElement.style.removeProperty("--font-ui");
  }, [settings.uiFontFamily]);

  // Keep the window minimum tracking the live pane count. QuickDeck has no
  // splitter — panes are equal-stretch flex siblings whose count changes via
  // Add / Delete — so the width floor must grow with the panes (and collapse to
  // one pane in zen mode). The floor is DERIVED in layoutMetrics, the single
  // source of truth shared with the per-pane CSS minimums; tauri.conf.json's
  // static minWidth/minHeight only have to cover the very first single-pane
  // frame before this runs.
  useEffect(() => {
    if (!isTauri()) return undefined;
    const minWidth = computeWindowMinWidth(panes.length, settings.zen);
    const minHeight = computeWindowMinHeight();
    getCurrentWindow()
      .setMinSize(new LogicalSize(minWidth, minHeight))
      .catch((error) =>
        logWarn("set window min size failed", {
          paneCount: panes.length,
          zen: settings.zen,
          minWidth,
          minHeight,
          error: serializeError(error),
        }),
      );
    return undefined;
  }, [panes.length, settings.zen]);

  // Zoom keyboard shortcuts — separate effect with its own document listener so
  // they work even when a modal is open (zoom should always be accessible).
  const zoomLevelRef = useRef(settings.zoomLevel);
  useEffect(() => { zoomLevelRef.current = settings.zoomLevel; }, [settings.zoomLevel]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Zoom is window chrome and stays global even while a modal is open; the
      // modal key handlers (Escape/Tab) never overlap the zoom keys.
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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (loadStatus !== "ready" || openModal || blockingError) {
        return;
      }

      // A command accelerator is a chord the IME passes straight through, so while a pane field is
      // mid-composition the chord belongs to the pending candidate: stand down and let the user
      // finish, rather than firing on a not-yet-committed candidate (text-input-ime-conventions).
      if (isComposingEvent(event)) {
        return;
      }

      if (matchesShortcut(event, "addPane")) {
        event.preventDefault();
        addPane();
      }

      if (matchesShortcut(event, "focusPreviousPane")) {
        event.preventDefault();
        const index = panes.findIndex((pane) => pane.id === activePaneId);
        const previous = panes[clampPaneIndex(index - 1, panes.length)];
        setActivePaneId(previous.id);
      }

      if (matchesShortcut(event, "focusNextPane")) {
        event.preventDefault();
        const index = panes.findIndex((pane) => pane.id === activePaneId);
        const next = panes[clampPaneIndex(index + 1, panes.length)];
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

      if (matchesShortcut(event, "toggleDark")) {
        event.preventDefault();
        toggleDark();
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
    toggleDark,
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
      logWarn("set always-on-top failed", { topmost: settings.topmost, error: serializeError(error) });
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

    // The clean-shutdown line itself is logged Rust-side on RunEvent (see
    // lib.rs): a frontend log here would be a fire-and-forget IPC racing the
    // window teardown, so it could not be relied on to persist. The failure
    // paths below only log when the close is aborted, in which case the window
    // stays open and the forward has time to land.
    async function persistCloseState(): Promise<boolean> {
      try {
        await snapshotAllPanesRef.current("app_close");
      } catch (error) {
        // Insurance snapshots are best-effort; proceed to the real save, but
        // record that the close-time snapshot did not land.
        logWarn("close snapshot failed", { error: serializeError(error) });
      }
      try {
        await saveNowRef.current();
        return true;
      } catch (error) {
        logError("save on close failed", { error: serializeError(error) });
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
          logError("close window failed", { error: serializeError(error) });
          showToastRef.current("error", `Could not close window: ${String(error)}`);
        } finally {
          closeInFlight = false;
        }
      }).then((unlisten) => {
        closeUnlisten = unlisten;
      }).catch((error) => {
        logWarn("register close handler failed", { error: serializeError(error) });
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
              <span className="statusBadge statusBadge-panes">
                {panes.length} {panes.length === 1 ? "pane" : "panes"}
              </span>
              <span className="statusBadge statusBadge-snapshots">
                {snapshotCount.toLocaleString()} snapshots
              </span>
            </>
          ) : null}
          {snapshotPulse ? (
            <span className="statusBadge statusBadge-snapshot">Snapshot saved</span>
          ) : null}
          <button
            type="button"
            className="statusBadge statusBadgeButton statusThemeToggle"
            title={settings.dark ? "Switch to light theme" : "Switch to dark theme"}
            aria-pressed={settings.dark}
            onClick={toggleDark}
          >
            {settings.dark ? "Dark" : "Light"}
          </button>
          {settings.zen ? (
            <button
              type="button"
              className="statusBadge statusBadge-zen statusBadgeButton"
              title="Click to disable zen mode"
              aria-pressed={settings.zen}
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
              aria-pressed={settings.topmost}
              onClick={toggleTopmost}
            >
              Topmost
            </button>
          ) : null}
          <span className={`statusBadge saveState saveState-${saveState}`}>{saveState}</span>
          <Menu
            label="App menu"
            panelClassName="menuPanelUp"
            trigger={(triggerProps) => (
              <button className="statusMenuButton" type="button" aria-label="Open menu" {...triggerProps}>
                <MenuIcon size={18} />
              </button>
            )}
          >
            <MenuItem onSelect={() => addPane()}>
              <Plus size={16} />
              Add Pane
            </MenuItem>
            <MenuItem onSelect={() => openMenuModal("settings")}>
              <Settings size={16} />
              Settings
            </MenuItem>
            <div className="menuDivider" />
            {/* A contained zoom stepper, skipped by the menu's arrow navigation:
                its buttons are tabIndex=-1 and are driven by pointer plus the
                global zoom shortcuts, not promoted into menu items. */}
            <div className="menuZoomRow">
              <span>Zoom</span>
              <div className="menuZoomControls">
                <button
                  type="button"
                  className="menuZoomButton"
                  tabIndex={-1}
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
                    tabIndex={-1}
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
                  tabIndex={-1}
                  onClick={() => updateSettings({ ...settings, zoomLevel: stepZoomIn(settings.zoomLevel) })}
                  disabled={stepZoomIn(settings.zoomLevel) === settings.zoomLevel}
                  title="Zoom in"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
            <div className="menuDivider" />
            <MenuItem onSelect={() => openMenuModal("shortcuts")}>
              <Keyboard size={16} />
              Shortcuts
            </MenuItem>
            <MenuItem onSelect={() => openMenuModal("snapshots")}>
              <History size={16} />
              Snapshot Search
            </MenuItem>
            <MenuItem onSelect={() => openMenuModal("about")}>
              <Info size={16} />
              About
            </MenuItem>
          </Menu>
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
