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
    reorderPane,
    recordSnapshot,
  } = useAppState();
  const active = pane.id === activePaneId;
  const counts = getTextCounts(pane.content);

  return (
    <section
      className={`pane ${active ? "pane-active" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const draggedPaneId = event.dataTransfer.getData("text/plain");
        reorderPane(draggedPaneId, pane.id);
      }}
      onMouseDown={() => setActivePaneId(pane.id)}
    >
      <header
        className="paneHeader"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", pane.id);
          setActivePaneId(pane.id);
        }}
      >
        <input
          aria-label="Pane title"
          className="paneTitleInput"
          draggable={false}
          value={pane.title}
          onChange={(event) => updatePaneTitle(pane.id, event.target.value)}
          onFocus={() => setActivePaneId(pane.id)}
        />
        <button
          className="iconButton"
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
        className="paneEditor"
        value={pane.content}
        onChange={(event) => updatePaneContent(pane.id, event.target.value)}
        onCopy={() => recordSnapshot(pane.id, "copy", pane.content)}
        onCut={() => recordSnapshot(pane.id, "cut", pane.content)}
        onPaste={() => recordSnapshot(pane.id, "paste", pane.content)}
        onFocus={() => setActivePaneId(pane.id)}
        spellCheck={false}
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
