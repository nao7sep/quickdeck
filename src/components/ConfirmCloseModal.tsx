import { useI18n } from "../i18n/I18nContext";
import { ModalBase } from "./ModalBase";

type ConfirmCloseModalProps = {
  onCancel: () => void;
  onDiscard: () => void;
};

export function ConfirmCloseModal({ onCancel, onDiscard }: ConfirmCloseModalProps) {
  const { t } = useI18n();
  return (
    <ModalBase
      title={t("discard.title")}
      onRequestClose={onCancel}
      footer={
        <>
          <button className="secondaryButton" type="button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button className="dangerButton" type="button" onClick={onDiscard}>
            {t("discard.confirm")}
          </button>
        </>
      }
    >
      <p>{t("discard.body")}</p>
    </ModalBase>
  );
}
