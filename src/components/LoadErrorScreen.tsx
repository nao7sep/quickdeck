import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../i18n/I18nContext";
import type { Message } from "../i18n/translate";
import { logWarn, serializeError } from "../services/logger";

// Non-dismissible halt shown when persisted state could not be prepared.
//
// When config.json or state.json fails to read or parse, the app must not
// fall through to the editor. Doing so would let the default in-memory state
// be autosaved over the user's existing files on the first edit. Instead the
// shell renders this screen until the user quits and repairs the data
// directory by hand.

type LoadErrorScreenProps = {
  error: Message;
  // Present only for the corrupt-panes halt: the user-commanded reset that
  // sets the unreadable file aside (preserving its bytes) and starts fresh —
  // a halting store must be clearable from the surface that reported the
  // failure (storage-path conventions).
  onSetAsideAndReset?: () => void;
};

export function LoadErrorScreen({ error, onSetAsideAndReset }: LoadErrorScreenProps) {
  const { t, rich, text } = useI18n();
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
        <h1 className="loadErrorTitle">{t("load.title")}</h1>
        <p className="loadErrorMessage">{text(error)}</p>
        <p className="loadErrorHint">
          {rich("load.hint", {
            dataDir: <code>~/.quickdeck</code>,
            envVar: <code>QUICKDECK_HOME</code>,
          })}
        </p>
        <div className="loadErrorActions">
          {onSetAsideAndReset && (
            <button type="button" className="secondaryButton" onClick={onSetAsideAndReset}>
              {t("load.setAside")}
            </button>
          )}
          <button type="button" className="primaryButton" onClick={quit}>
            {t("load.quit")}
          </button>
        </div>
      </div>
    </main>
  );
}
