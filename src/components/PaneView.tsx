import { useEffect, useRef, type CSSProperties } from "react";
import { Trash2 } from "lucide-react";
import type { Pane } from "../types";
import { useAppState } from "../state/AppStateContext";
import { getTextCounts } from "../utils/counts";

type PaneViewProps = {
  pane: Pane;
};

export function PaneView({ pane }: PaneViewProps) {
  const {
    activePaneId,
    settings,
    setActivePaneId,
    updatePaneTitle,
    updatePaneContent,
    deletePane,
    recordSnapshot,
  } = useAppState();
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const active = pane.id === activePaneId;
  const counts = getTextCounts(pane.content);

  // When this pane becomes active, focus the textarea unless the user clicked
  // into this pane's own title input (in which case leave it alone).
  useEffect(() => {
    if (active && editorRef.current && document.activeElement !== editorRef.current) {
      if (document.activeElement !== titleRef.current) {
        editorRef.current.focus();
      }
    }
  }, [active]);

  return (
    <section
      className={`pane ${active ? "pane-active" : ""}`}
      style={
        {
          "--pane-color": pane.headerColor,
          "--pane-bg": pane.backgroundColor,
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
          onFocus={() => setActivePaneId(pane.id)}
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
        onChange={(event) => updatePaneContent(pane.id, event.target.value)}
        onCopy={() => recordSnapshot(pane.id, "copy", pane.content)}
        onCut={() => recordSnapshot(pane.id, "cut", pane.content)}
        onPaste={() => recordSnapshot(pane.id, "paste", pane.content)}
        onFocus={() => setActivePaneId(pane.id)}
        spellCheck
        style={{
          fontFamily: settings.editorFontFamily,
          fontSize: `${settings.editorFontSize}px`,
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
