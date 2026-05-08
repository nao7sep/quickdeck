import { useEffect, useRef, useState } from "react";
import { ChevronUp } from "lucide-react";
import type { Pane } from "../types";

type PaneSwitcherProps = {
  panes: Pane[];
  activePaneId: string;
  onSelect: (paneId: string) => void;
};

export function PaneSwitcher({ panes, activePaneId, onSelect }: PaneSwitcherProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const activePane = panes.find((pane) => pane.id === activePaneId) ?? panes[0];

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handleClickOutside(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (!activePane) {
    return null;
  }

  return (
    <div className="paneSwitcherWrap" ref={wrapRef}>
      <button
        className="paneSwitcherButton"
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="paneSwitcherSwatch" style={{ background: activePane.headerColor }} />
        <span className="paneSwitcherTitle">{activePane.title}</span>
        <ChevronUp size={14} className="paneSwitcherChevron" />
      </button>
      {open ? (
        <div className="paneSwitcherPanel" role="listbox">
          {panes.map((pane) => {
            const selected = pane.id === activePaneId;
            return (
              <button
                key={pane.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`paneSwitcherOption ${selected ? "paneSwitcherOption-selected" : ""}`}
                onClick={() => {
                  onSelect(pane.id);
                  setOpen(false);
                }}
              >
                <span className="paneSwitcherSwatch" style={{ background: pane.headerColor }} />
                <span className="paneSwitcherOptionTitle">{pane.title}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
