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
    deleteActivePane,
    recordSnapshot,
  } = useAppState();
  const active = pane.id === activePaneId;
  const counts = getTextCounts(pane.content);

  return (
    <section className={`pane ${active ? "pane-active" : ""}`} onMouseDown={() => setActivePaneId(pane.id)}>
      <header className="paneHeader">
        <input
          aria-label="Pane title"
          className="paneTitleInput"
          value={pane.title}
          onChange={(event) => updatePaneTitle(pane.id, event.target.value)}
          onFocus={() => setActivePaneId(pane.id)}
        />
        <button className="iconButton" type="button" aria-label="Delete empty pane" onClick={deleteActivePane}>
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
