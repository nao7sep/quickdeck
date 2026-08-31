import { CircleAlert, TriangleAlert, X } from "lucide-react";
import { useAppState } from "../state/AppStateContext";
import type { Toast } from "../types";

export function ToastViewport() {
  const { toasts, dismissToast } = useAppState();

  return <ToastList toasts={toasts} onDismiss={dismissToast} />;
}

export function ToastList({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toastViewport">
      {toasts.map((toast) => {
        const actionable = toast.kind !== "info";
        return (
        <div
          className={`toast toast-${toast.kind}`}
          key={toast.id}
          role={toast.kind === "error" ? "alert" : "status"}
          aria-atomic="true"
        >
          {actionable ? (
            <strong className="toastSeverity">
              {toast.kind === "error" ? <CircleAlert size={15} /> : <TriangleAlert size={15} />}
              {toast.kind === "error" ? "Error" : "Warning"}
            </strong>
          ) : null}
          <span>{toast.message}</span>
          <button className="toastClose" type="button" aria-label="Dismiss toast" onClick={() => onDismiss(toast.id)}>
            <X size={14} />
          </button>
        </div>
        );
      })}
    </div>
  );
}
