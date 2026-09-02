import { X } from "lucide-react";
import { useAppState } from "../state/AppStateContext";
import type { Toast } from "../types";

const THEME_APPLICATION_FAILURE_ID = "app:window-theme-application";
const ZOOM_APPLICATION_FAILURE_ID = "app:zoom-application";
const TOPMOST_APPLICATION_FAILURE_ID = "app:topmost-application";

type ToastViewportProps = {
  themeApplicationFailed: boolean;
  zoomApplicationFailed: boolean;
  topmostApplicationFailed: boolean;
  onDismissThemeApplicationFailure: () => void;
  onDismissZoomApplicationFailure: () => void;
  onDismissTopmostApplicationFailure: () => void;
};

export function ToastViewport({
  themeApplicationFailed,
  zoomApplicationFailed,
  topmostApplicationFailed,
  onDismissThemeApplicationFailure,
  onDismissZoomApplicationFailure,
  onDismissTopmostApplicationFailure,
}: ToastViewportProps) {
  const { toasts, dismissToast } = useAppState();
  const appChromeResults: Toast[] = [];
  if (themeApplicationFailed) {
    appChromeResults.push({
      id: THEME_APPLICATION_FAILURE_ID,
      kind: "error",
      message: "Window theme could not be applied. Try switching themes again.",
    });
  }
  if (zoomApplicationFailed) {
    appChromeResults.push({
      id: ZOOM_APPLICATION_FAILURE_ID,
      kind: "error",
      message: "Zoom could not be applied. Try changing zoom again.",
    });
  }
  if (topmostApplicationFailed) {
    appChromeResults.push({
      id: TOPMOST_APPLICATION_FAILURE_ID,
      kind: "error",
      message: "Always on top could not be updated. Try changing it again.",
    });
  }

  return (
    <ToastList
      toasts={[...appChromeResults, ...toasts]}
      onDismiss={(id) => {
        if (id === THEME_APPLICATION_FAILURE_ID) onDismissThemeApplicationFailure();
        else if (id === ZOOM_APPLICATION_FAILURE_ID) onDismissZoomApplicationFailure();
        else if (id === TOPMOST_APPLICATION_FAILURE_ID) onDismissTopmostApplicationFailure();
        else dismissToast(id);
      }}
    />
  );
}

export function ToastList({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
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
          <span>{toast.message}</span>
          <button className="toastClose" type="button" aria-label="Dismiss toast" onClick={() => onDismiss(toast.id)}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        );
      })}
    </div>
  );
}
