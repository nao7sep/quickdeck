import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Search } from "lucide-react";
import { listSnapshots, type SnapshotRow } from "../services/persistence";
import { copyText } from "../services/clipboard";
import { logWarn, serializeError } from "../services/logger";
import { useAppState } from "../state/AppStateContext";
import { useComposing, isComposingKeyboardEvent } from "../hooks/useComposing";
import { ModalBase } from "./ModalBase";
import { formatSnapshotTimestamp } from "../utils/snapshotTimestamp";
import { truncate } from "../utils/textCleanup";
import {
  EXCERPT_GRAPHEMES,
  nextSelectionIndex,
  selectionAfterRowsChange,
} from "../utils/snapshotSelection";
import { useI18n } from "../i18n/I18nContext";
import { passiveScrollRegionProps } from "../utils/passiveScroll";

type SnapshotsModalProps = {
  onClose: () => void;
};

// How long the Copy control keeps saying Copied. It must return to Copy on its
// own: copying the same snapshot twice is ordinary, and a label already reading
// Copied would give the second press no feedback at all.
const COPIED_FEEDBACK_MS = 2000;

// A snapshot's origin in words: the pane's name as it reads now while that pane exists,
// otherwise the name it carried when the copy was taken. Empty for a copy saved before
// names were recorded, which then shows nothing rather than a placeholder.
function paneName(liveTitle: string | undefined, savedTitle: string): string {
  return (liveTitle ?? savedTitle).trim();
}

// How close to the end of the list a scroll gets before the next page loads.
const LOAD_MORE_THRESHOLD_PX = 120;

// Browse first, search second: the store opens newest-first and a query narrows
// it. Left is the list of snapshots, right is the selected one's full text — a
// split rather than a column of scrollable previews, so the list stays a single
// tab stop with no second scroll region nested inside a row.
export function SnapshotsModal({ onClose }: SnapshotsModalProps) {
  const { panes, settings } = useAppState();
  const i18n = useI18n();
  const { t } = i18n;
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const composing = useComposing();
  const listInFlightRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLPreElement | null>(null);
  // `load` is memoized on the page size, so it cannot read `rows` from the
  // render closure. A ref carries what a later page appends to; state updaters
  // stay pure, since StrictMode double-invokes them.
  const rowsRef = useRef<SnapshotRow[]>([]);
  rowsRef.current = rows;

  const load = useCallback(
    async (nextOffset: number, searchQuery: string) => {
      // The Search button is disabled while loading, but Enter can arrive before
      // React commits that state. Claim the request synchronously so two loads
      // cannot race and let an older response replace newer rows.
      if (listInFlightRef.current) {
        return;
      }

      listInFlightRef.current = true;
      setLoading(true);
      setFailed(false);
      try {
        const result = await listSnapshots(
          searchQuery.trim(),
          settings.snapshotSearchPageSize,
          nextOffset,
        );
        const next =
          nextOffset === 0 ? result.rows : [...rowsRef.current, ...result.rows];
        const nextIds = next.map((row) => row.id);
        setRows(next);
        // A fresh list starts at the top; a further page leaves the snapshot the
        // user is reading exactly where it is.
        setSelectedId((previous) =>
          selectionAfterRowsChange(nextIds, nextOffset === 0 ? null : previous),
        );
        setHasMore(result.hasMore);
      } catch (err) {
        // Report modal-local failures inline; the modal stays usable, so there is
        // no need to spawn an app-level toast over it.
        logWarn("snapshot list failed", { offset: nextOffset, error: serializeError(err) });
        setFailed(true);
        if (nextOffset === 0) {
          setRows([]);
          setSelectedId(null);
          setHasMore(false);
        }
      } finally {
        listInFlightRef.current = false;
        setLoading(false);
        setLoaded(true);
      }
    },
    [settings.snapshotSearchPageSize],
  );

  // Open on the whole store rather than on an empty box.
  useEffect(() => {
    void load(0, "");
  }, [load]);

  const selectedIndex = rows.findIndex((row) => row.id === selectedId);
  const selected = selectedIndex < 0 ? null : rows[selectedIndex];
  const selectedOrigin =
    selected === null ? undefined : panes.find((pane) => pane.id === selected.paneId);

  const copiedTimerRef = useRef<number | null>(null);

  function clearCopiedTimer() {
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
  }

  useEffect(() => {
    setCopied(false);
    clearCopiedTimer();
    // React reuses the same <pre> across selections, so without this the new
    // snapshot opens at the previous one's scroll position — and a reader who
    // was deep inside a long snapshot lands in the middle of a short one.
    if (detailRef.current !== null) {
      detailRef.current.scrollTop = 0;
    }
  }, [selectedId]);

  useEffect(() => clearCopiedTimer, []);

  function selectAt(index: number) {
    const row = rows[index];
    if (row === undefined) {
      return;
    }
    setSelectedId(row.id);
    // Keyboard navigation moves real focus onto the active row, which scrolls it
    // into view for free. Only ever while focus already lives in the list: an
    // arriving page must never pull the caret out of the search box.
    const list = listRef.current;
    if (list !== null && list.contains(document.activeElement)) {
      list.querySelector<HTMLElement>(`[data-snapshot-id="${CSS.escape(row.id)}"]`)?.focus();
    }
  }

  async function copySelected() {
    if (selected === null) {
      return;
    }
    // Drop the previous result first, so pressing Copy again while the label
    // still reads Copied shows the change rather than nothing at all.
    clearCopiedTimer();
    setCopied(false);
    try {
      await copyText(selected.content);
      setCopied(true);
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, COPIED_FEEDBACK_MS);
    } catch (err) {
      logWarn("snapshot copy failed", { error: serializeError(err) });
      setFailed(true);
    }
  }

  // The next page arrives by scrolling rather than by a control, which also
  // keeps the list a single tab stop. `load` ignores a call while one is in
  // flight, so a fast scroll cannot start the same page twice.
  function loadMoreIfNeeded(list: HTMLElement) {
    if (!hasMore || loading) {
      return;
    }
    const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;
    if (remaining <= LOAD_MORE_THRESHOLD_PX) {
      void load(rows.length, query);
    }
  }

  function emptyMessage(): string | null {
    if (failed) return null;
    if (!loaded || loading) return t("snapshots.loading");
    if (rows.length > 0) return null;
    return query.trim().length === 0 ? t("snapshots.emptyStore") : t("snapshots.noMatches");
  }

  const message = emptyMessage();

  return (
    <ModalBase
      wide
      scrollableBody={false}
      title={t("snapshots.title")}
      onRequestClose={onClose}
      toolbar={
        <div className="snapshotSearchControls">
          <div className="searchBox">
            <Search size={18} />
            <input
              type="search"
              placeholder={t("snapshots.placeholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={composing.handlers.onCompositionStart}
              onCompositionEnd={composing.handlers.onCompositionEnd}
              onKeyDown={(event) => {
                if (isComposingKeyboardEvent(composing.composingRef, event)) return;
                if (event.key === "Enter") {
                  void load(0, query);
                }
              }}
            />
          </div>
          <button
            className="primaryButton"
            type="button"
            disabled={loading}
            onClick={() => void load(0, query)}
          >
            {t("snapshots.search")}
          </button>
        </div>
      }
      footer={
        <button className="secondaryButton" type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <div className="snapshotBrowser">
        <div className="snapshotListColumn">
          <div
            ref={listRef}
            className="snapshotList"
            role="listbox"
            aria-label={t("snapshots.listLabel")}
            // The container stays reachable by Tab while the list is empty; once
            // it has rows, the active row carries the control's single tab stop.
            tabIndex={rows.length === 0 ? 0 : -1}
            onScroll={(event) => loadMoreIfNeeded(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              const target = nextSelectionIndex(selectedIndex, event.key, rows.length);
              if (target === null) {
                // Arrowing past the last row is how a keyboard reaches the next
                // page, since scrolling is what loads one for the pointer.
                if (event.key === "ArrowDown" && hasMore && !loading) {
                  event.preventDefault();
                  void load(rows.length, query);
                }
                return;
              }
              event.preventDefault();
              selectAt(target);
            }}
          >
            {failed ? (
              <p className="errorText" role="alert">
                {t("snapshots.failed")}
              </p>
            ) : null}
            {message !== null ? <p className="mutedText">{message}</p> : null}
            {rows.map((row, index) => {
              const timestamp = formatSnapshotTimestamp(row.createdAtUtc, i18n.dateTime);
              const excerpt = truncate(row.content, EXCERPT_GRAPHEMES);
              const origin = panes.find((pane) => pane.id === row.paneId);
              const active = row.id === selectedId;
              return (
                <div
                  key={row.id}
                  data-snapshot-id={row.id}
                  className={`snapshotRow ${active ? "snapshotRow-selected" : ""}`}
                  role="option"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectAt(index)}
                  onFocus={() => setSelectedId(row.id)}
                >
                  <span className="snapshotRowHead">
                    {/* A snapshot from a deleted pane carries no colour, because the colour
                        belongs to a pane that is gone — but it still says the pane's name,
                        which it recorded for itself when it was taken. */}
                    <span
                      className="snapshotRowDot"
                      style={origin ? { background: origin.headerColor } : undefined}
                    />
                    <span className="snapshotRowTime">{timestamp}</span>
                    {paneName(origin?.title, row.paneTitle) !== "" ? (
                      <span className="snapshotRowPane">{paneName(origin?.title, row.paneTitle)}</span>
                    ) : null}
                  </span>
                  <span className="snapshotRowExcerpt">
                    {excerpt.text}
                    {excerpt.truncated ? "…" : ""}
                  </span>
                </div>
              );
            })}
            {/* Only while a page is actually in flight. Tied to `hasMore` it
                would sit there reading Loading whenever more existed, whether
                or not anything was being fetched. */}
            {loading && rows.length > 0 ? (
              <p className="snapshotListFoot" aria-hidden="true">
                {t("snapshots.loading")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="snapshotDetail">
          {selected === null ? (
            <p className="mutedText">{t("snapshots.noSelection")}</p>
          ) : (
            <>
              {/* The list can be scrolled away from the selected row, so the
                  detail names what is open rather than relying on the row —
                  the same dot and time, not a bare repeat of the timestamp. */}
              <div className="snapshotDetailBar">
                <span className="snapshotRowHead">
                  <span
                    className="snapshotRowDot"
                    style={selectedOrigin ? { background: selectedOrigin.headerColor } : undefined}
                  />
                  <span className="snapshotRowTime">
                    {formatSnapshotTimestamp(selected.createdAtUtc, i18n.dateTime)}
                  </span>
                  {paneName(selectedOrigin?.title, selected.paneTitle) !== "" ? (
                    <span className="snapshotRowPane">
                      {paneName(selectedOrigin?.title, selected.paneTitle)}
                    </span>
                  ) : null}
                </span>
                <button
                  className="iconTextButton"
                  type="button"
                  onClick={() => void copySelected()}
                >
                  <Copy size={15} />
                  {copied ? t("snapshots.copied") : t("snapshots.copy")}
                </button>
              </div>
              <pre
                ref={detailRef}
                {...passiveScrollRegionProps(
                  t("snapshots.entryLabel", {
                    timestamp: formatSnapshotTimestamp(selected.createdAtUtc, i18n.dateTime),
                  }),
                )}
              >
                {selected.content}
              </pre>
            </>
          )}
        </div>
      </div>
    </ModalBase>
  );
}
