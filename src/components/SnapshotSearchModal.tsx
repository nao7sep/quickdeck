import { useState } from "react";
import { Search } from "lucide-react";
import { searchSnapshots, type SnapshotSearchRow } from "../services/persistence";
import { useAppState } from "../state/AppStateContext";
import { useComposing, isComposingKeyboardEvent } from "../hooks/useComposing";
import { ModalBase } from "./ModalBase";

type SnapshotSearchModalProps = {
  onClose: () => void;
};

export function SnapshotSearchModal({ onClose }: SnapshotSearchModalProps) {
  const { settings } = useAppState();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SnapshotSearchRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composing = useComposing();

  async function runSearch(nextOffset: number) {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      setRows([]);
      setHasMore(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
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
      setError(`Snapshot search failed: ${String(err)}`);
      if (nextOffset === 0) {
        setRows([]);
        setHasMore(false);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalBase
      title="Snapshot Search"
      onRequestClose={onClose}
      footer={
        <>
          <button className="secondaryButton" type="button" onClick={onClose}>
            Close
          </button>
          <button className="primaryButton" type="button" disabled={loading} onClick={() => void runSearch(0)}>
            {loading ? "Searching" : "Search"}
          </button>
        </>
      }
    >
      <div className="snapshotSearchControls">
        <div className="searchBox">
          <Search size={18} />
          <input
            type="search"
            placeholder="Search snapshots"
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
        {error ? <p className="errorText" role="alert">{error}</p> : null}
        {!error && rows.length === 0 ? <p className="mutedText">No snapshot results.</p> : null}
        {rows.map((row) => (
          <article className="snapshotResult" key={row.id}>
            <header>
              <span>{formatSnapshotTimestamp(row.createdAtUtc)}</span>
            </header>
            <pre>{row.content}</pre>
          </article>
        ))}
        {hasMore ? (
          <button className="secondaryButton loadMoreButton" type="button" disabled={loading} onClick={() => void runSearch(rows.length)}>
            Load More
          </button>
        ) : null}
      </div>
    </ModalBase>
  );
}

// Snapshot ids encode the UTC instant as "YYYYMMDD-HHMMSS-utc". Convert that
// into a deterministic local-time string ("YYYY-MM-DD HH:mm") so the format
// stays the same across machine locales.
function formatSnapshotTimestamp(rawUtc: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-utc$/i.exec(rawUtc);
  if (!match) {
    return rawUtc;
  }

  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(Date.UTC(
    Number(y), Number(mo) - 1, Number(d),
    Number(h), Number(mi), Number(s),
  ));
  if (Number.isNaN(date.getTime())) {
    return rawUtc;
  }

  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
