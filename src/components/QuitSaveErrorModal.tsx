import type { Message } from "../i18n/translate";
import { useI18n } from "../i18n/I18nContext";
import { ModalBase } from "./ModalBase";

export type QuitSaveErrorChoice = "cancel" | "retry" | "quitAnyway";

type QuitSaveErrorModalProps = {
  reason?: Message | null;
  onChoose: (choice: QuitSaveErrorChoice) => void;
};

// Shown when a quit the user started could not save their work: the quit is
// cancelled, and the user may retry the save or quit without it
// (unsaved-edits conventions, Quitting).
export function QuitSaveErrorModal({ onChoose, reason }: QuitSaveErrorModalProps) {
  const { t, text } = useI18n();
  return (
    <ModalBase
      title={t("saveError.title")}
      onRequestClose={() => onChoose("cancel")}
      footer={
        <>
          <button className="secondaryButton" type="button" onClick={() => onChoose("cancel")}>
            {t("common.cancel")}
          </button>
          <button
            className="primaryButton"
            type="button"
            onClick={() => onChoose("retry")}
            data-initial-focus
          >
            {t("saveError.retry")}
          </button>
          <button className="dangerButton" type="button" onClick={() => onChoose("quitAnyway")}>
            {t("saveError.quitAnyway")}
          </button>
        </>
      }
    >
      <p className="errorText">{t("saveError.onClose")}</p>
      {reason ? <p className="errorText">{text(reason)}</p> : null}
    </ModalBase>
  );
}
