import { useI18n } from "../i18n/I18nContext";
import type { BlockingError } from "../types";
import { ModalBase } from "./ModalBase";

type ErrorModalProps = {
  error: BlockingError;
  onClose: () => void;
};

export function ErrorModal({ error, onClose }: ErrorModalProps) {
  const { t, text } = useI18n();
  const title = text(error.title);
  return (
    <ModalBase
      title={title}
      onRequestClose={onClose}
      passiveContentLabel={t("error.details", { title })}
      footer={
        <button className="primaryButton" type="button" onClick={onClose}>
          {t("common.ok")}
        </button>
      }
    >
      <p className="errorText">{text(error.message)}</p>
    </ModalBase>
  );
}
