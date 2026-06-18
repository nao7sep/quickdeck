import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logWarn, serializeError } from "../services/logger";

// Non-dismissible halt shown when persisted state could not be loaded.
//
// When config.json or session.json fails to read or parse, the app must not
// fall through to the editor. Doing so would let the default in-memory state
// be autosaved over the user's existing files on the first edit. Instead the
// shell renders this screen until the user quits and repairs the data
// directory by hand.

type LoadErrorScreenProps = {
  error: string;
};

export function LoadErrorScreen({ error }: LoadErrorScreenProps) {
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
          <button type="button" className="primaryButton" onClick={quit}>
            Quit
          </button>
        </div>
      </div>
    </main>
  );
}
