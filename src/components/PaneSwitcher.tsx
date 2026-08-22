import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronUp } from "lucide-react";
import type { Pane } from "../types";
import { nextIndex, verticalTablistDirection } from "../utils/compositeNav";
import { panePanelDomId, paneTabDomId } from "../utils/paneDomIds";

type PaneSwitcherProps = {
  panes: Pane[];
  activePaneId: string;
  onSelect: (paneId: string) => void;
};

/**
 * The zen-mode pane switcher: a trigger that opens a popup of panes, which is a
 * one-tab-stop vertical tablist per the composite-control conventions. Its job is
 * to switch which pane is shown, so the popup is a `tablist` of `tab`s rather than
 * a listbox.
 *
 * Once open it is a single tab stop: roving tabindex (the active tab is 0, the
 * rest -1), Up/Down and Left/Right move between tabs, Home/End jump to the ends,
 * and activation follows focus — arrowing commits the new pane immediately (a
 * cheap local swap) and moves DOM focus to the new tab. Enter/Space or click
 * commit and close; Escape or an outside click close. Every close returns focus to
 * the trigger. On open, focus lands on the selected tab.
 *
 * Not a modal: its Escape / outside-close is self-contained and never enters the
 * modal stack.
 */
export function PaneSwitcher({ panes, activePaneId, onSelect }: PaneSwitcherProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const activePane = panes.find((pane) => pane.id === activePaneId) ?? panes[0];

  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) {
      triggerRef.current?.focus();
    }
  };

  const focusTab = (index: number) => {
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-pane-index="${index}"]`)
      ?.focus();
  };

  // On open, move focus to the selected tab so the keyboard cursor starts on the
  // pane that is currently shown.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const selectedIndex = Math.max(0, panes.findIndex((pane) => pane.id === activePaneId));
    const id = requestAnimationFrame(() => focusTab(selectedIndex));
    return () => cancelAnimationFrame(id);
    // Intentionally keyed only on `open`: re-running on activePaneId would steal
    // focus during the follows-focus arrowing below.
  }, [open]);

  // Outside click closes without yanking focus back (a pointer interaction).
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handleClickOutside(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!activePane) {
    return null;
  }

  const currentIndex = Math.max(0, panes.findIndex((pane) => pane.id === activePaneId));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = verticalTablistDirection(event.key);
    if (direction) {
      // Activation follows focus: arrowing commits the new pane immediately (a
      // cheap local swap) and moves DOM focus to the new tab.
      event.preventDefault();
      const target = nextIndex(direction, currentIndex, panes.length);
      onSelect(panes[target].id);
      focusTab(target);
    } else if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
      // The pane is already committed by the follows-focus arrowing, so these
      // just close and return focus to the trigger.
      event.preventDefault();
      close();
    }
  };

  return (
    <div
      className="paneSwitcherWrap"
      ref={wrapRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          close(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        className="paneSwitcherButton"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="paneSwitcherSwatch" style={{ background: activePane.headerColor }} />
        <span className="paneSwitcherTitle">{activePane.title}</span>
        <ChevronUp size={14} className="paneSwitcherChevron" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="paneSwitcherPanel"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Switch pane"
          onKeyDown={onKeyDown}
        >
          {panes.map((pane, index) => {
            const selected = pane.id === activePaneId;
            return (
              <button
                key={pane.id}
                id={paneTabDomId(pane.id)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panePanelDomId(pane.id)}
                tabIndex={index === currentIndex ? 0 : -1}
                data-pane-index={index}
                className={`paneSwitcherOption ${selected ? "paneSwitcherOption-selected" : ""}`}
                onClick={() => {
                  onSelect(pane.id);
                  close();
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
