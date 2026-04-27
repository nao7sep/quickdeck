import { ModalBase } from "./ModalBase";

type AboutModalProps = {
  onClose: () => void;
};

export function AboutModal({ onClose }: AboutModalProps) {
  return (
    <ModalBase title="About QuickDeck" onRequestClose={onClose}>
      <div className="aboutText">
        <p>QuickDeck is a local-first multi-pane plain text workspace.</p>
        <p>Version 0.1.0</p>
        <p>Data path integration will be wired through Tauri persistence commands in the next phase.</p>
        <p>License: MIT</p>
      </div>
    </ModalBase>
  );
}
