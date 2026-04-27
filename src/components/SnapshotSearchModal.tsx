import { useState } from "react";
import { Search } from "lucide-react";
import { searchSnapshots, type SnapshotSearchRow } from "../services/persistence";
import { useAppState } from "../state/AppStateContext";
import { ModalBase } from "./ModalBase";

type SnapshotSearchModalProps = {
  onClose: () => void;
};

export function SnapshotSearchModal({ onClose }: SnapshotSearchModalProps) {
  const { settings, showToast } = useAppState();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SnapshotSearchRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  async function runSearch(nextOffset: number) {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      setRows([]);
      setHasMore(false);
      return;
    }

    setLoading(true);
    try {
      const result = await searchSnapshots(
        trimmedQuery,
        settings.snapshotSearchPageSize,
        nextOffset,
      );
      setRows((current) => (nextOffset === 0 ? result.rows : [...current, ...result.rows]));
      setHasMore(result.hasMore);
    } catch (error) {
      showToast("warning", `Snapshot search failed: ${String(error)}`);
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
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void runSearch(0);
              }
            }}
          />
        </div>
      </div>
      <div className="snapshotResults">
        {rows.length === 0 ? (
          <p className="mutedText">No snapshot results.</p>
        ) : (
          rows.map((row) => (
            <article className="snapshotResult" key={row.id}>
              <header>
                <span>{formatSnapshotTimestamp(row.createdAtUtc)}</span>
              </header>
              <pre>{row.content}</pre>
            </article>
          ))
        )}
        {hasMore ? (
          <button className="secondaryButton loadMoreButton" type="button" disabled={loading} onClick={() => void runSearch(rows.length)}>
            Load More
          </button>
        ) : null}
      </div>
    </ModalBase>
  );
}

// Snapshot ids encode the UTC instant as "YYYYMMDD-HHMMSS-utc"; format that
// into a human-readable local time, falling back to the raw value if parsing
// fails.
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

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
