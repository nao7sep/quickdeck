import { ModalBase } from "./ModalBase";

type ConfirmCloseModalProps = {
  onCancel: () => void;
  onDiscard: () => void;
};

export function ConfirmCloseModal({ onCancel, onDiscard }: ConfirmCloseModalProps) {
  return (
    <ModalBase
      title="Discard Changes?"
      onRequestClose={onCancel}
      footer={
        <>
          <button className="secondaryButton" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="dangerButton" type="button" onClick={onDiscard}>
            Discard
          </button>
        </>
      }
    >
      <p>This modal has unsaved changes. Closing it will discard them.</p>
    </ModalBase>
  );
}
