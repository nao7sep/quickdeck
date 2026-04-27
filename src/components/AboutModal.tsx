import { ModalBase } from "./ModalBase";
import { useAppState } from "../state/AppStateContext";

type AboutModalProps = {
  onClose: () => void;
};

export function AboutModal({ onClose }: AboutModalProps) {
  const { dataDir } = useAppState();

  return (
    <ModalBase title="About QuickDeck" onRequestClose={onClose}>
      <div className="aboutText">
        <p>QuickDeck is a local-first multi-pane plain text workspace.</p>
        <p>Version 0.1.0</p>
        <p>Data path: {dataDir}</p>
        <p>All workspace data stays local. QuickDeck does not include telemetry or remote sync.</p>
        <p>License: MIT</p>
      </div>
    </ModalBase>
  );
}
