import { useMemo, useState } from "react";
import { useAppState } from "../state/AppStateContext";
import type { AppSettings } from "../types";
import { SETTINGS_BOUNDS, isSettingsDraftValid, normalizeSettings } from "../state/normalize";
import { defaultSettings } from "../state/defaults";
import { THEME_PREFERENCES } from "../utils/theme";
import { CATALOGUES } from "../i18n/catalogues";
import { useI18n } from "../i18n/I18nContext";
import { LANGUAGES, normalizeLanguagePreference } from "../i18n/languages";
import { ConfirmCloseModal } from "./ConfirmCloseModal";
import { ModalBase } from "./ModalBase";

type SettingsModalProps = {
  onClose: () => void;
};

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, updateSettings } = useAppState();
  const i18n = useI18n();
  const { t } = i18n;
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const isDirty = useMemo(() => {
    const keys = Object.keys(settings) as (keyof AppSettings)[];
    return keys.some((k) => draft[k] !== settings[k]);
  }, [draft, settings]);

  const isValid = useMemo(() => isSettingsDraftValid(draft), [draft]);

  function requestClose() {
    if (confirmingClose) {
      return;
    }
    if (isDirty) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }

  function save() {
    // Reuse the load-path normalizer so the form and disk agree on the canonical
    // shape (trimmed font, clamped bounds).
    updateSettings(normalizeSettings(draft));
    onClose();
  }

  function setField<Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <>
      <ModalBase
        title={t("settings.title")}
        closeDisabled={confirmingClose}
        onRequestClose={requestClose}
        footer={
          <>
            <button className="secondaryButton" type="button" onClick={requestClose}>
              {t("common.cancel")}
            </button>
            <button
              className="primaryButton"
              type="button"
              disabled={!isDirty || !isValid}
              onClick={save}
            >
              {t("settings.save")}
            </button>
          </>
        }
      >
        <div className="formGrid">
          {/* Each language is listed by its own name, in its own script, so a
              reader of any of them can find it whatever language is showing. */}
          <label>
            <span>{t("settings.language")}</span>
            <select
              value={draft.language}
              onChange={(event) => setField("language", normalizeLanguagePreference(event.target.value))}
            >
              <option value="system">{t("settings.languageSystem")}</option>
              {LANGUAGES.map((language) => (
                <option key={language} value={language} lang={language}>
                  {CATALOGUES[language]["language.name"] as string}
                </option>
              ))}
            </select>
          </label>
          {/* A native radio group: one tab stop, arrow keys move and select
              (composite-control conventions). Applied on Save like every other
              field here. */}
          <fieldset className="radioGroup">
            <legend>{t("settings.theme")}</legend>
            <div className="radioGroupOptions">
              {THEME_PREFERENCES.map(({ value, label }) => (
                <label className="radioRow" key={value}>
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={draft.theme === value}
                    onChange={() => setField("theme", value)}
                  />
                  <span>{t(label)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.zen}
              onChange={(event) => setField("zen", event.target.checked)}
            />
            <span>{t("settings.zen")}</span>
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.topmost}
              onChange={(event) => setField("topmost", event.target.checked)}
            />
            <span>{t("settings.topmost")}</span>
          </label>
          <label>
            <span>{t("settings.uiFont")}</span>
            <input
              type="text"
              value={draft.uiFontFamily}
              onChange={(event) => setField("uiFontFamily", event.target.value)}
              placeholder={t("settings.uiFontPlaceholder")}
            />
          </label>
          <label>
            <span>{t("settings.editorFontFamily")}</span>
            <input
              type="text"
              value={draft.editorFontFamily}
              onChange={(event) => setField("editorFontFamily", event.target.value)}
              placeholder={defaultSettings.editorFontFamily}
            />
          </label>
          <label>
            <span>
              {t("settings.editorFontSize")}{" "}
              <span className="fieldRange">
                {i18n.number(SETTINGS_BOUNDS.editorFontSize.min)}–{i18n.number(SETTINGS_BOUNDS.editorFontSize.max)}
              </span>
            </span>
            <input
              type="number"
              min={SETTINGS_BOUNDS.editorFontSize.min}
              max={SETTINGS_BOUNDS.editorFontSize.max}
              value={draft.editorFontSize}
              onChange={(event) => setField("editorFontSize", Number(event.target.value))}
            />
          </label>
          <label>
            <span>
              {t("settings.editorLineHeight")}{" "}
              <span className="fieldRange">
                {i18n.number(SETTINGS_BOUNDS.editorLineHeight.min)}–{i18n.number(SETTINGS_BOUNDS.editorLineHeight.max)}
              </span>
            </span>
            <input
              type="number"
              step={0.1}
              min={SETTINGS_BOUNDS.editorLineHeight.min}
              max={SETTINGS_BOUNDS.editorLineHeight.max}
              value={draft.editorLineHeight}
              onChange={(event) => setField("editorLineHeight", Number(event.target.value))}
            />
          </label>
          <label>
            <span>
              {t("settings.editorPadding")}{" "}
              <span className="fieldRange">
                {i18n.number(SETTINGS_BOUNDS.editorPadding.min)}–{i18n.number(SETTINGS_BOUNDS.editorPadding.max)}
              </span>
            </span>
            <input
              type="number"
              min={SETTINGS_BOUNDS.editorPadding.min}
              max={SETTINGS_BOUNDS.editorPadding.max}
              value={draft.editorPadding}
              onChange={(event) => setField("editorPadding", Number(event.target.value))}
            />
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.editorBold}
              onChange={(event) => setField("editorBold", event.target.checked)}
            />
            <span>{t("settings.editorBold")}</span>
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.editorItalic}
              onChange={(event) => setField("editorItalic", event.target.checked)}
            />
            <span>{t("settings.editorItalic")}</span>
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.editorUnderline}
              onChange={(event) => setField("editorUnderline", event.target.checked)}
            />
            <span>{t("settings.editorUnderline")}</span>
          </label>
          <label>
            <span>
              {t("settings.autosaveDelay")}{" "}
              <span className="fieldRange">
                {i18n.number(SETTINGS_BOUNDS.autosaveDelaySeconds.min)}–{i18n.number(SETTINGS_BOUNDS.autosaveDelaySeconds.max)}
              </span>
            </span>
            <input
              type="number"
              min={SETTINGS_BOUNDS.autosaveDelaySeconds.min}
              max={SETTINGS_BOUNDS.autosaveDelaySeconds.max}
              value={draft.autosaveDelaySeconds}
              onChange={(event) => setField("autosaveDelaySeconds", Number(event.target.value))}
            />
          </label>
          <label>
            <span>
              {t("settings.snapshotPageSize")}{" "}
              <span className="fieldRange">
                {i18n.number(SETTINGS_BOUNDS.snapshotSearchPageSize.min)}–{i18n.number(SETTINGS_BOUNDS.snapshotSearchPageSize.max)}
              </span>
            </span>
            <input
              type="number"
              min={SETTINGS_BOUNDS.snapshotSearchPageSize.min}
              max={SETTINGS_BOUNDS.snapshotSearchPageSize.max}
              value={draft.snapshotSearchPageSize}
              onChange={(event) => setField("snapshotSearchPageSize", Number(event.target.value))}
            />
          </label>
        </div>
      </ModalBase>
      {confirmingClose ? (
        <ConfirmCloseModal onCancel={() => setConfirmingClose(false)} onDiscard={onClose} />
      ) : null}
    </>
  );
}
