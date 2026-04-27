import { type ReactNode, useEffect, useRef } from "react";
import { X } from "lucide-react";

type ModalBaseProps = {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onRequestClose: () => void;
};

export function ModalBase({ title, children, footer, onRequestClose }: ModalBaseProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onRequestClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onRequestClose]);

  return (
    <div
      className="modalOverlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onRequestClose();
        }
      }}
    >
      <div className="modalSurface" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={dialogRef}>
        <header className="modalHeader">
          <h2 id="modal-title">{title}</h2>
          <button className="iconButton" type="button" aria-label="Close modal" onClick={onRequestClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modalContent">{children}</div>
        {footer ? <footer className="modalFooter">{footer}</footer> : null}
      </div>
    </div>
  );
}
