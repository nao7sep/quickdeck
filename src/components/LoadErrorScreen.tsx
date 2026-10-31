import { isTauri } from "@tauri-apps/api/core";
import { DATA_DIR_ENV_VAR, DATA_DIR_NAME } from "../utils/dataFolder";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useI18n } from "../i18n/I18nContext";
import { message, type Message } from "../i18n/translate";
import { logWarn, serializeError } from "../services/logger";
import type { RefusedFile } from "../services/persistence";

// Non-dismissible stop shown when the launch cannot open its saved data, so
// nothing is written over it. It names every file the launch refused — newer,
// or unreadable — and what the user can do; the only action is Quit
// (store-recovery conventions, What a refused file does). A failure that
// reached no named file names the data folder instead.

type LoadErrorScreenProps = {
  error: Message | null;
  // The file a failure names; null when the load stopped before reaching a
  // store, and the hint then names the data folder instead.
  path: string | null;
  // Every file the launch refused. When any is listed, the screen names them
  // in place of the error and its hint.
  refused?: RefusedFile[];
};

export function LoadErrorScreen({ error, path, refused = [] }: LoadErrorScreenProps) {
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
        {refused.length > 0 ? (
          <>
            <p className="loadErrorMessage">{t("load.refused")}</p>
            <ul className="loadErrorFiles">
              {refused.map((file) => (
                <li key={file.path}>
                  {file.newer !== null
                    ? rich("load.fileNewer", { path: <code>{file.path}</code>, version: file.newer })
                    : rich("load.fileUnreadable", { path: <code>{file.path}</code> })}
                </li>
              ))}
            </ul>
            <p className="loadErrorHint">{t("load.refusedHint")}</p>
          </>
        ) : (
          <>
            <p className="loadErrorMessage">{text(error ?? message("load.unknown"))}</p>
            <p className="loadErrorHint">
              {path !== null
                ? rich("load.hint", { path: <code>{path}</code> })
                : rich("load.hintDataFolder", {
                    folder: <code>{DATA_DIR_NAME}</code>,
                    envVar: <code>{DATA_DIR_ENV_VAR}</code>,
                  })}
            </p>
          </>
        )}
        <div className="loadErrorActions">
          <button type="button" className="primaryButton" onClick={quit}>
            {t("load.quit")}
          </button>
        </div>
      </div>
    </main>
  );
}
