import { useEffect, useRef, type CSSProperties } from "react";
import { Trash2 } from "lucide-react";
import type { Pane } from "../types";
import { useAppState } from "../state/AppStateContext";
import { getTextCounts } from "../utils/counts";
import { darkPaneBackground } from "../utils/paneColors";
import { shouldPullEditorFocus } from "../utils/paneFocus";

type PaneViewProps = {
  pane: Pane;
};

export function PaneView({ pane }: PaneViewProps) {
  const {
    activePaneId,
    settings,
    setActivePaneId,
    updatePaneTitle,
    commitPaneTitle,
    updatePaneContent,
    deletePane,
    recordSnapshot,
  } = useAppState();
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const pendingPasteSnapshotRef = useRef(false);
  const active = pane.id === activePaneId;
  const counts = getTextCounts(pane.content);

  // When this pane becomes active, pull focus into the textarea so Cmd/Ctrl+Arrow
  // and click-to-edit land ready to type — but never steal focus from a control
  // outside the pane deck (most importantly the zen-mode pane switcher, a
  // follows-focus tablist in the status bar). The decision lives in a pure helper
  // so it is unit-tested; the DOM focus move itself is verified by manual QA.
  useEffect(() => {
    const editor = editorRef.current;
    if (!active || !editor) {
      return;
    }
    const deck = editor.closest<HTMLElement>(".paneDeck");
    if (shouldPullEditorFocus(document.activeElement, editor, titleRef.current, deck)) {
      editor.focus();
    }
  }, [active]);

  return (
    <section
      className={`pane ${active ? "pane-active" : ""}`}
      style={
        {
          "--pane-color": pane.headerColor,
          "--pane-bg": pane.backgroundColor,
          "--pane-bg-dark": darkPaneBackground(pane.backgroundColor),
        } as CSSProperties
      }
      onMouseDown={() => setActivePaneId(pane.id)}
    >
      <header className="paneHeader">
        <input
          ref={titleRef}
          aria-label="Pane title"
          className="paneTitleInput"
          value={pane.title}
          spellCheck={false}
          onChange={(event) => updatePaneTitle(pane.id, event.target.value)}
          onBlur={() => commitPaneTitle(pane.id)}
          onMouseDown={(event) => {
            setActivePaneId(pane.id);

            if (document.activeElement !== event.currentTarget) {
              event.preventDefault();
              event.currentTarget.focus();
              event.currentTarget.select();
            }
          }}
          onFocus={(event) => {
            setActivePaneId(pane.id);
            event.target.select();
          }}
        />
        <button
          className="iconButton paneDeleteButton"
          type="button"
          aria-label="Delete pane"
          onClick={(event) => {
            event.stopPropagation();
            deletePane(pane.id);
          }}
        >
          <Trash2 size={16} />
        </button>
      </header>
      <textarea
        ref={editorRef}
        className="paneEditor"
        value={pane.content}
        onChange={(event) => {
          const next = event.target.value;
          updatePaneContent(pane.id, next);
          if (pendingPasteSnapshotRef.current) {
            pendingPasteSnapshotRef.current = false;
            recordSnapshot(pane.id, "paste", next);
          }
        }}
        onCopy={() => recordSnapshot(pane.id, "copy", pane.content)}
        onCut={() => recordSnapshot(pane.id, "cut", pane.content)}
        onPaste={() => {
          // The matching change event fires next with the post-paste value;
          // snapshot there so we capture what the user actually pasted in.
          pendingPasteSnapshotRef.current = true;
        }}
        onFocus={() => setActivePaneId(pane.id)}
        spellCheck
        style={{
          fontFamily: settings.editorFontFamily,
          fontSize: `${settings.editorFontSize}px`,
          lineHeight: settings.editorLineHeight,
          padding: `${settings.editorPadding}px`,
          fontWeight: settings.editorBold ? "bold" : "normal",
          fontStyle: settings.editorItalic ? "italic" : "normal",
          textDecoration: settings.editorUnderline ? "underline" : "none",
        }}
      />
      <footer className="paneFooter">
        <span>Words {counts.words}</span>
        <span>Chars {counts.chars}</span>
        <span className={counts.xValid ? undefined : "countOverLimit"}>
          X {counts.xWeightedChars}/{counts.xLimit}
        </span>
      </footer>
    </section>
  );
}
