import { X } from "lucide-react";
import { useI18n } from "../i18n/I18nContext";
import { message } from "../i18n/translate";
import { useAppState } from "../state/AppStateContext";
import type { Toast } from "../types";

const THEME_APPLICATION_FAILURE_ID = "app:window-theme-application";
const LANGUAGE_APPLICATION_FAILURE_ID = "app:language-application";
const ZOOM_APPLICATION_FAILURE_ID = "app:zoom-application";
const TOPMOST_APPLICATION_FAILURE_ID = "app:topmost-application";

type ToastViewportProps = {
  themeApplicationFailed: boolean;
  languageApplicationFailed: boolean;
  zoomApplicationFailed: boolean;
  topmostApplicationFailed: boolean;
  onDismissThemeApplicationFailure: () => void;
  onDismissLanguageApplicationFailure: () => void;
  onDismissZoomApplicationFailure: () => void;
  onDismissTopmostApplicationFailure: () => void;
};

export function ToastViewport({
  themeApplicationFailed,
  languageApplicationFailed,
  zoomApplicationFailed,
  topmostApplicationFailed,
  onDismissThemeApplicationFailure,
  onDismissLanguageApplicationFailure,
  onDismissZoomApplicationFailure,
  onDismissTopmostApplicationFailure,
}: ToastViewportProps) {
  const { toasts, dismissToast } = useAppState();
  const appChromeResults: Toast[] = [];
  if (themeApplicationFailed) {
    appChromeResults.push({
      id: THEME_APPLICATION_FAILURE_ID,
      kind: "error",
      message: message("toast.themeFailed"),
    });
  }
  if (languageApplicationFailed) {
    appChromeResults.push({
      id: LANGUAGE_APPLICATION_FAILURE_ID,
      kind: "error",
      message: message("toast.languageFailed"),
    });
  }
  if (zoomApplicationFailed) {
    appChromeResults.push({
      id: ZOOM_APPLICATION_FAILURE_ID,
      kind: "error",
      message: message("toast.zoomFailed"),
    });
  }
  if (topmostApplicationFailed) {
    appChromeResults.push({
      id: TOPMOST_APPLICATION_FAILURE_ID,
      kind: "error",
      message: message("toast.topmostFailed"),
    });
  }

  return (
    <ToastList
      toasts={[...appChromeResults, ...toasts]}
      onDismiss={(id) => {
        if (id === THEME_APPLICATION_FAILURE_ID) onDismissThemeApplicationFailure();
        else if (id === LANGUAGE_APPLICATION_FAILURE_ID) onDismissLanguageApplicationFailure();
        else if (id === ZOOM_APPLICATION_FAILURE_ID) onDismissZoomApplicationFailure();
        else if (id === TOPMOST_APPLICATION_FAILURE_ID) onDismissTopmostApplicationFailure();
        else dismissToast(id);
      }}
    />
  );
}

export function ToastList({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const { t, text } = useI18n();
  return (
    <div className="toastViewport">
      {toasts.map((toast) => {
        return (
        <div
          className={`toast toast-${toast.kind}`}
          key={toast.id}
          role={toast.kind === "error" ? "alert" : "status"}
          aria-atomic="true"
        >
          <span>{text(toast.message)}</span>
          <button className="toastClose" type="button" aria-label={t("common.dismissToast")} onClick={() => onDismiss(toast.id)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        );
      })}
    </div>
  );
}
