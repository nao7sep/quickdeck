import { type ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { isTopmostModal, popModal, pushModal } from "../modalStack";
import { resolveInitialFocus, resolveTrapTarget } from "../focusTrap";
import { acquireScrollLock, releaseScrollLock } from "../scrollLock";

type ModalBaseProps = {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  closeDisabled?: boolean;
  onRequestClose: () => void;
};

export function ModalBase({ title, children, footer, closeDisabled = false, onRequestClose }: ModalBaseProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const token = useRef({}).current;
  const titleId = useId();

  // Register in the modal stack and lock background scroll for as long as this
  // modal is mounted. The stack tells the keyboard handlers below whether this
  // is the topmost layer.
  useEffect(() => {
    pushModal(token);
    acquireScrollLock();
    return () => {
      popModal(token);
      releaseScrollLock();
    };
  }, [token]);

  // Move focus into the modal on open and restore it on close. Restoring to the
  // previously focused element also chains correctly for stacked modals: a
  // confirmation returns focus to the modal that opened it.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return undefined;
    }
    const previouslyFocused = document.activeElement as HTMLElement | null;
    resolveInitialFocus(surface).focus();
    return () => {
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  // Own Escape and Tab while this is the topmost modal. Escape routes through
  // the close guard; Tab/Shift+Tab is trapped so it never reaches the window
  // behind the backdrop.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const surface = surfaceRef.current;
      if (!surface || !isTopmostModal(token)) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!closeDisabled) {
          onRequestClose();
        }
        return;
      }

      if (event.key === "Tab") {
        const target = resolveTrapTarget(surface, document.activeElement, event.shiftKey);
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, onRequestClose, token]);

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onMouseDown={(event) => {
        if (!closeDisabled && event.target === event.currentTarget) {
          onRequestClose();
        }
      }}
    >
      <div
        className="modalSurface"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={surfaceRef}
      >
        <header className="modalHeader">
          <h2 id={titleId}>{title}</h2>
          <button
            className="iconButton"
            type="button"
            aria-label="Close modal"
            data-modal-close
            disabled={closeDisabled}
            onClick={onRequestClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="modalContent">{children}</div>
        {footer ? <footer className="modalFooter">{footer}</footer> : null}
      </div>
    </div>
  );
}
