import { useEffect, useRef, type CSSProperties } from "react";
import { Trash2 } from "lucide-react";
import type { Pane } from "../types";
import { useAppState } from "../state/AppStateContext";
import { X_LIMIT } from "../utils/counts";
import { useTextCounts } from "../hooks/useTextCounts";
import { darkPaneBackground, paneHeaderDeep } from "../utils/paneColors";
import { shouldPullEditorFocus } from "../utils/paneFocus";
import { panePanelDomId } from "../utils/paneDomIds";
import { pasteReplacesText, removesLargeBlock } from "../utils/snapshotBoundaries";
import { useI18n } from "../i18n/I18nContext";

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
  const i18n = useI18n();
  const { t } = i18n;
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const pendingPasteSnapshotRef = useRef(false);
  const active = pane.id === activePaneId;
  // Word, character and X counts are O(this pane's content length), so they are
  // made off the UI thread and only when this pane's own text changes; the
  // footer shows the latest finished ones.
  const counts = useTextCounts(pane.content);
  const shown = counts === null || counts === "failed" ? null : counts;

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
      id={settings.zen ? panePanelDomId(pane.id) : undefined}
      role={settings.zen ? "tabpanel" : undefined}
      aria-label={settings.zen ? t("pane.region", { title: pane.title || t("pane.defaultTitle") }) : undefined}
      className={`pane ${active ? "pane-active" : ""}`}
      style={
        {
          "--pane-color": pane.headerColor,
          "--pane-color-deep": paneHeaderDeep(pane.headerColor),
          "--pane-bg": pane.backgroundColor,
          "--pane-bg-dark": darkPaneBackground(pane.backgroundColor),
        } as CSSProperties
      }
      onMouseDown={() => setActivePaneId(pane.id)}
    >
      <header className="paneHeader">
        <input
          ref={titleRef}
          aria-label={t("pane.titleLabel")}
          className="paneTitleInput"
          value={pane.title}
          placeholder={t("pane.defaultTitle")}
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
          aria-label={t("pane.delete")}
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
          if (removesLargeBlock(pane.content, next)) {
            recordSnapshot(pane.id, "before_removal", pane.content);
          }
          updatePaneContent(pane.id, next);
          if (pendingPasteSnapshotRef.current) {
            pendingPasteSnapshotRef.current = false;
            recordSnapshot(pane.id, "paste", next);
          }
        }}
        onCopy={() => recordSnapshot(pane.id, "copy", pane.content)}
        onCut={() => recordSnapshot(pane.id, "cut", pane.content)}
        onPaste={(event) => {
          const editor = event.currentTarget;
          if (pasteReplacesText(editor.selectionStart, editor.selectionEnd)) {
            recordSnapshot(pane.id, "before_paste", pane.content);
          }
          // The matching change event fires next with the post-paste value;
          // snapshot there so we capture what the user actually pasted in.
          pendingPasteSnapshotRef.current = true;
        }}
        onFocus={() => setActivePaneId(pane.id)}
        spellCheck
        style={{
          fontFamily: settings.editorFontFamily || "var(--font-mono)",
          fontSize: `${settings.editorFontSize}px`,
          lineHeight: settings.editorLineHeight,
          padding: `${settings.editorPadding}px`,
          fontWeight: settings.editorBold ? "bold" : "normal",
          fontStyle: settings.editorItalic ? "italic" : "normal",
          textDecoration: settings.editorUnderline ? "underline" : "none",
        }}
      />
      <footer className="paneFooter">
        {/* A dash stands in until the first count arrives or when one fails. */}
        <span>{t("pane.words", { count: shown === null ? "–" : shown.words })}</span>
        <span>{t("pane.chars", { count: shown === null ? "–" : shown.chars })}</span>
        {/* "X" is the service's name, so it stays as it is in every language. */}
        <span className={shown === null || shown.xValid ? undefined : "countOverLimit"}>
          X {shown === null ? "–" : i18n.number(shown.xWeightedChars)}/{i18n.number(X_LIMIT)}
        </span>
      </footer>
    </section>
  );
}
