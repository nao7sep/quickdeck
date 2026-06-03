import { type ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

type ModalBaseProps = {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  closeDisabled?: boolean;
  onRequestClose: () => void;
};

export function ModalBase({ title, children, footer, closeDisabled = false, onRequestClose }: ModalBaseProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!isTopmostModal(dialogRef.current)) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        if (closeDisabled) {
          return;
        }
        onRequestClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeDisabled, onRequestClose]);

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
      <div className="modalSurface" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <header className="modalHeader">
          <h2 id={titleId}>{title}</h2>
          <button
            className="iconButton"
            type="button"
            aria-label="Close modal"
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

function isTopmostModal(element: HTMLDivElement | null): boolean {
  if (!element) {
    return false;
  }

  const modals = Array.from(document.querySelectorAll(".modalSurface"));
  return modals[modals.length - 1] === element;
}
