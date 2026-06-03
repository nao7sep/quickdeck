import type { BlockingError } from "../types";
import { ModalBase } from "./ModalBase";

type ErrorModalProps = {
  error: BlockingError;
  onClose: () => void;
};

export function ErrorModal({ error, onClose }: ErrorModalProps) {
  return (
    <ModalBase
      title={error.title}
      onRequestClose={onClose}
      footer={
        <button className="primaryButton" type="button" onClick={onClose}>
          OK
        </button>
      }
    >
      <p className="errorText">{error.message}</p>
    </ModalBase>
  );
}
