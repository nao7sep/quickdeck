import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logWarn, serializeError } from "../services/logger";

// Non-dismissible halt shown when persisted state could not be loaded.
//
// When config.json or state.json fails to read or parse, the app must not
// fall through to the editor. Doing so would let the default in-memory state
// be autosaved over the user's existing files on the first edit. Instead the
// shell renders this screen until the user quits and repairs the data
// directory by hand.

type LoadErrorScreenProps = {
  error: string;
  // Present only for the corrupt-panes halt: the user-commanded reset that
  // sets the unreadable file aside (preserving its bytes) and starts fresh —
  // a halting store must be clearable from the surface that reported the
  // failure (storage-path conventions).
  onSetAsideAndReset?: () => void;
};

export function LoadErrorScreen({ error, onSetAsideAndReset }: LoadErrorScreenProps) {
  function quit() {
    if (isTauri()) {
      void getCurrentWindow()
        .destroy()
        .catch((error) => {
          // If destroy fails the user can still force-quit from the OS; there is
          // no safe in-app fallback that wouldn't risk a write. Record it so the
          // failed quit is not silent.
          logWarn("quit destroy failed", { error: serializeError(error) });
        });
    } else {
      window.close();
    }
  }

  return (
    <main className="loadErrorShell">
      <div className="loadErrorPanel">
        <h1 className="loadErrorTitle">QuickDeck couldn't load saved data</h1>
        <p className="loadErrorMessage">{error}</p>
        <p className="loadErrorHint">
          To protect your existing data, QuickDeck will not save changes in this
          state. Your files live in the app's data folder (<code>~/.quickdeck</code>{" "}
          by default, or <code>QUICKDECK_HOME</code> if set). Quit the app,
          repair or move the affected file, then relaunch.
        </p>
        <div className="loadErrorActions">
          {onSetAsideAndReset && (
            <button type="button" className="secondaryButton" onClick={onSetAsideAndReset}>
              Set the file aside and start fresh
            </button>
          )}
          <button type="button" className="primaryButton" onClick={quit}>
            Quit
          </button>
        </div>
      </div>
    </main>
  );
}
