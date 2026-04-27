import { useState } from "react";
import { Search } from "lucide-react";
import { searchSnapshots, type SnapshotSearchRow } from "../services/persistence";
import { useAppState } from "../state/AppStateContext";
import { ModalBase } from "./ModalBase";

type SnapshotSearchModalProps = {
  onClose: () => void;
};

export function SnapshotSearchModal({ onClose }: SnapshotSearchModalProps) {
  const { activePaneId, settings, showToast } = useAppState();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SnapshotSearchRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentPaneOnly, setCurrentPaneOnly] = useState(false);

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
        currentPaneOnly ? activePaneId : undefined,
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
        <label className="checkboxRow">
          <input
            type="checkbox"
            checked={currentPaneOnly}
            onChange={(event) => setCurrentPaneOnly(event.target.checked)}
          />
          <span>Current pane only</span>
        </label>
      </div>
      <div className="snapshotResults">
        {rows.length === 0 ? (
          <p className="mutedText">No snapshot results.</p>
        ) : (
          rows.map((row) => (
            <article className="snapshotResult" key={row.id}>
              <header>
                <span>{row.createdAtUtc}</span>
                <span>{row.paneId}</span>
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
