import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { searchSnapshots, type SnapshotSearchRow } from "../services/persistence";
import { logWarn, serializeError } from "../services/logger";
import { useAppState } from "../state/AppStateContext";
import { useComposing, isComposingKeyboardEvent } from "../hooks/useComposing";
import { ModalBase } from "./ModalBase";
import { formatSnapshotTimestamp } from "../utils/snapshotTimestamp";
import { useI18n } from "../i18n/I18nContext";
import { passiveScrollRegionProps } from "../utils/passiveScroll";

type SnapshotSearchModalProps = {
  onClose: () => void;
};

export function SnapshotSearchModal({ onClose }: SnapshotSearchModalProps) {
  const { settings } = useAppState();
  const i18n = useI18n();
  const { t } = i18n;
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SnapshotSearchRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const composing = useComposing();
  const searchInFlightRef = useRef(false);

  async function runSearch(nextOffset: number) {
    // The Search button is disabled while loading, but Enter can arrive before
    // React commits that state. Claim the request synchronously so two searches
    // cannot race and let an older response replace newer rows.
    if (searchInFlightRef.current) {
      return;
    }
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      setRows([]);
      setHasMore(false);
      setFailed(false);
      return;
    }

    searchInFlightRef.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const result = await searchSnapshots(
        trimmedQuery,
        settings.snapshotSearchPageSize,
        nextOffset,
      );
      setRows((current) => (nextOffset === 0 ? result.rows : [...current, ...result.rows]));
      setHasMore(result.hasMore);
    } catch (err) {
      // Report modal-local failures inline; the modal stays usable, so there is
      // no need to spawn an app-level toast over it.
      logWarn("snapshot search failed", { offset: nextOffset, error: serializeError(err) });
      setFailed(true);
      if (nextOffset === 0) {
        setRows([]);
        setHasMore(false);
      }
    } finally {
      searchInFlightRef.current = false;
      setLoading(false);
    }
  }

  return (
    <ModalBase
      title={t("snapshots.title")}
      onRequestClose={onClose}
      footer={
        <>
          <button className="secondaryButton" type="button" onClick={onClose}>
            {t("common.close")}
          </button>
          <button className="primaryButton" type="button" disabled={loading} onClick={() => void runSearch(0)}>
            {loading ? t("snapshots.searching") : t("snapshots.search")}
          </button>
        </>
      }
    >
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
                void runSearch(0);
              }
            }}
          />
        </div>
      </div>
      <div className="snapshotResults">
        {failed ? <p className="errorText" role="alert">{t("snapshots.failed")}</p> : null}
        {!failed && rows.length === 0 ? <p className="mutedText">{t("snapshots.empty")}</p> : null}
        {rows.map((row) => {
          const timestamp = formatSnapshotTimestamp(row.createdAtUtc, i18n.dateTime);
          return (
            <article className="snapshotResult" key={row.id}>
              <header>
                <span>{timestamp}</span>
              </header>
              <pre {...passiveScrollRegionProps(t("snapshots.entryLabel", { timestamp }))}>
                {row.content}
              </pre>
            </article>
          );
        })}
        {hasMore ? (
          <button className="secondaryButton loadMoreButton" type="button" disabled={loading} onClick={() => void runSearch(rows.length)}>
            {t("snapshots.loadMore")}
          </button>
        ) : null}
      </div>
    </ModalBase>
  );
}
