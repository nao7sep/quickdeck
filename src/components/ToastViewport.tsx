import { X } from "lucide-react";
import { useAppState } from "../state/AppStateContext";

export function ToastViewport() {
  const { toasts, dismissToast } = useAppState();

  return (
    <div className="toastViewport" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.kind}`} key={toast.id}>
          <span>{toast.message}</span>
          <button className="toastClose" type="button" aria-label="Dismiss toast" onClick={() => dismissToast(toast.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
