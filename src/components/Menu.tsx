import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { nextIndex } from "../utils/compositeNav";
import { isComposingKeyboardEvent, useComposing } from "../hooks/useComposing";

/**
 * The app's in-app menu layer: a trigger plus a popup list of commands that
 * behaves like a real menu per the composite-control conventions. The trigger is
 * the single tab stop (aria-haspopup="menu" / aria-expanded); opening moves focus
 * into the menu and closing returns it to the trigger. Up/Down move between items
 * (stopping at the ends, like the app's lists), Home/End jump to the ends,
 * type-ahead jumps by label, Enter/Space activate, and Escape / Tab / outside
 * click close. Items are `menuitem`s navigated by the arrows, never by Tab.
 *
 * The type-ahead, Enter/Space activation, and Escape branches are guarded against
 * IME composition (a Japanese/Chinese/Korean conversion Enter must not activate
 * or close), via the shared useComposing hook wired to the menu container.
 *
 * Hand-rolled on the app's own focus helpers (no menu dependency); the Menu and
 * MenuItem are the single in-app menu layer, so every dropdown behaves
 * identically. The Menu is not a modal: its Escape / outside-close is
 * self-contained and never enters the modal stack.
 */
type TriggerProps = {
  ref: (el: HTMLButtonElement | null) => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  onClick: () => void;
};

type MenuProps = {
  /** Accessible name for the popup. */
  label: string;
  trigger: (props: TriggerProps) => ReactNode;
  children: ReactNode;
  /** Extra class on the popup panel, e.g. `menuPanelUp` for upward placement. */
  panelClassName?: string;
};

const MenuContext = createContext<{ close: () => void } | null>(null);

export function Menu({ label, trigger, children, panelClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const composing = useComposing();

  const items = (): HTMLElement[] =>
    contentRef.current
      ? Array.from(contentRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'))
      : [];

  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };

  // On open, move focus into the menu (first item). On a re-render while open
  // (the item set changed), leave focus where it is.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const id = requestAnimationFrame(() => items()[0]?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Outside click closes without yanking focus back (a pointer interaction).
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    if (all.length === 0) {
      return;
    }
    const current = all.indexOf(document.activeElement as HTMLElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      all[nextIndex("next", current, all.length)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      all[nextIndex("prev", current, all.length)]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      all[nextIndex("first", current, all.length)]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      all[nextIndex("last", current, all.length)]?.focus();
    } else if (event.key === "Escape") {
      // An IME conversion Escape cancels composition, not the menu.
      if (isComposingKeyboardEvent(composing.composingRef, event)) {
        return;
      }
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      // Tab never moves between items; it leaves (closes) the menu. Closing
      // returns focus to the trigger so the page tab order resumes from there.
      event.preventDefault();
      close();
    } else if (event.key === "Enter" || event.key === " ") {
      // The IME confirmation Enter must not activate the focused item.
      if (isComposingKeyboardEvent(composing.composingRef, event)) {
        return;
      }
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.click();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Type-ahead: jump to the next item whose label starts with the key. A
      // composition keystroke is for the IME, not navigation.
      if (isComposingKeyboardEvent(composing.composingRef, event)) {
        return;
      }
      const char = event.key.toLowerCase();
      const order = [...all.slice(current + 1), ...all.slice(0, current + 1)];
      order.find((el) => el.textContent?.trim().toLowerCase().startsWith(char))?.focus();
    }
  };

  return (
    <div className="menuWrap">
      {trigger({
        ref: (el) => {
          triggerRef.current = el;
        },
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => setOpen((value) => !value),
      })}
      {open ? createPortal(
        <div
          ref={contentRef}
          role="menu"
          aria-label={label}
          className={panelClassName ? `menuPanel ${panelClassName}` : "menuPanel"}
          onKeyDown={onKeyDown}
          onCompositionStart={composing.handlers.onCompositionStart}
          onCompositionEnd={composing.handlers.onCompositionEnd}
        >
          <MenuContext.Provider value={{ close }}>{children}</MenuContext.Provider>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

/**
 * One command in a {@link Menu}. A `menuitem` reachable only by the menu's arrow
 * navigation (never its own tab stop); activating it runs the action and closes
 * the menu, returning focus to the trigger.
 */
export function MenuItem({
  onSelect,
  children,
}: {
  onSelect: () => void;
  children: ReactNode;
}) {
  const ctx = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={() => {
        ctx?.close();
        onSelect();
      }}
    >
      {children}
    </button>
  );
}
