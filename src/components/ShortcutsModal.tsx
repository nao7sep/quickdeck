import { useI18n } from "../i18n/I18nContext";
import { shortcutDefinitions } from "../shortcuts";
import { ModalBase } from "./ModalBase";

type ShortcutsModalProps = {
  onClose: () => void;
};

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  const { t } = useI18n();
  return (
    <ModalBase
      title={t("shortcuts.title")}
      onRequestClose={onClose}
      passiveContentLabel={t("shortcuts.contentLabel")}
      footer={
        <button className="secondaryButton" type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <div className="shortcutList">
        {shortcutDefinitions.map((shortcut) => (
          <div className="shortcutRow" key={shortcut.description}>
            <span>{t(shortcut.description)}</span>
            <kbd>{shortcut.keys}</kbd>
          </div>
        ))}
      </div>
      {/* The catalogue-matches-bindings rule: a chord that stands down in some
          context says so (keyboard-shortcut-conventions). */}
      <p className="shortcutNote">{t("shortcuts.macNote")}</p>
    </ModalBase>
  );
}
