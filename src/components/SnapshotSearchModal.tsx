import { Search } from "lucide-react";
import { ModalBase } from "./ModalBase";

type SnapshotSearchModalProps = {
  onClose: () => void;
};

export function SnapshotSearchModal({ onClose }: SnapshotSearchModalProps) {
  return (
    <ModalBase
      title="Snapshot Search"
      onRequestClose={onClose}
      footer={
        <>
          <button className="secondaryButton" type="button" onClick={onClose}>
            Close
          </button>
          <button className="primaryButton" type="button" disabled>
            Search
          </button>
        </>
      }
    >
      <div className="searchBox">
        <Search size={18} />
        <input type="search" placeholder="Search snapshots" disabled />
      </div>
      <p className="mutedText">SQLite snapshot search will be implemented in Phase 2.</p>
    </ModalBase>
  );
}
