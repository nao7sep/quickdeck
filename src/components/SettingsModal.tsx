import { useEffect, useId, useMemo, useState } from "react";
import { useAppState } from "../state/AppStateContext";
import type { AppSettings } from "../types";
import {
  NUMBER_SETTING_KEYS,
  SETTINGS_BOUNDS,
  normalizeSettings,
  parseNumberSetting,
  type NumberSettingKey,
} from "../state/normalize";
import { DEFAULT_EDITOR_FONT_FAMILY_STACK } from "../state/defaults";
import { THEME_PREFERENCES } from "../utils/theme";
import { SYSTEM_ZONE, systemTimeZone, timeZones } from "../utils/timeZone";
import { systemTheme } from "../services/persistence";
import { useI18n } from "../i18n/I18nContext";
import { LANGUAGES, LANGUAGE_NAMES, languageNameIn, normalizeLanguagePreference } from "../i18n/languages";
import { ConfirmCloseModal } from "./ConfirmCloseModal";
import { ModalBase } from "./ModalBase";

type SettingsModalProps = {
  onClose: () => void;
};

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, updateSettings, systemLanguage } = useAppState();
  const i18n = useI18n();
  const { t } = i18n;
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // The number fields keep exactly what was typed; only an accepted value is
  // ever saved (number-field conventions).
  const [numberText, setNumberText] = useState(() => numberTextsOf(settings));
  const numbers = useMemo(
    () => Object.fromEntries(NUMBER_SETTING_KEYS.map((key) => [key, parseNumberSetting(numberText[key], key)])) as
      Record<NumberSettingKey, number | null>,
    [numberText],
  );

  const isDirty = useMemo(() => {
    const keys = Object.keys(settings) as (keyof AppSettings)[];
    const initialText = numberTextsOf(settings);
    return keys.some((k) => draft[k] !== settings[k]) ||
      NUMBER_SETTING_KEYS.some((key) => numberText[key] !== initialText[key]);
  }, [draft, numberText, settings]);

  const isValid = NUMBER_SETTING_KEYS.every((key) => numbers[key] !== null);
  const zones = useMemo(() => timeZones(), []);
  // Every System entry shows what it resolves to now (app-chrome and timestamp
  // conventions). The OS appearance comes from the Rust core: a saved Light or
  // Dark sets the page's own appearance, so the page cannot tell.
  const [osTheme, setOsTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    let current = true;
    void systemTheme().then(
      (theme) => {
        if (current) setOsTheme(theme);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);
  const systemWith = (system: string, value: string | null) =>
    value === null ? system : t("settings.systemResolved", { system, value });

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
    // shape.
    updateSettings(normalizeSettings({ ...draft, ...(numbers as Record<NumberSettingKey, number>) }));
    onClose();
  }

  function setField<Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const numberField = (key: NumberSettingKey, label: string) => (
    <NumberField
      label={label}
      setting={key}
      text={numberText[key]}
      valid={numbers[key] !== null}
      onChange={(text) => setNumberText((current) => ({ ...current, [key]: text }))}
    />
  );

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
              <option value="system">
                {systemWith(t("settings.languageSystem"), languageNameIn(systemLanguage, i18n.language))}
              </option>
              {LANGUAGES.map((language) => (
                <option key={language} value={language} lang={language}>
                  {LANGUAGE_NAMES[language]}
                </option>
              ))}
            </select>
          </label>
          {/* Zones are chosen from the platform's list, never typed
              (timestamp-conventions, Time zones). */}
          <label>
            <span>{t("settings.timeZone")}</span>
            <select value={draft.displayZone} onChange={(event) => setField("displayZone", event.target.value)}>
              <option value={SYSTEM_ZONE}>{systemWith(t("settings.timeZoneSystem"), systemTimeZone())}</option>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
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
                  <span>
                    {value === "system"
                      ? systemWith(t(label), osTheme === null ? null : t(osTheme === "dark" ? "settings.themeDark" : "settings.themeLight"))
                      : t(label)}
                  </span>
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
              placeholder={DEFAULT_EDITOR_FONT_FAMILY_STACK}
            />
          </label>
          {numberField("editorFontSize", t("settings.editorFontSize"))}
          {numberField("editorLineHeight", t("settings.editorLineHeight"))}
          {numberField("editorPadding", t("settings.editorPadding"))}
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
          {numberField("autosaveDelaySeconds", t("settings.autosaveDelay"))}
          {numberField("snapshotSearchPageSize", t("settings.snapshotPageSize"))}
        </div>
      </ModalBase>
      {confirmingClose ? (
        <ConfirmCloseModal onCancel={() => setConfirmingClose(false)} onDiscard={onClose} />
      ) : null}
    </>
  );
}

function numberTextsOf(settings: AppSettings): Record<NumberSettingKey, string> {
  return Object.fromEntries(NUMBER_SETTING_KEYS.map((key) => [key, String(settings[key])])) as
    Record<NumberSettingKey, string>;
}

// A plain text field rather than a number input: the platform's number input
// reads partial or unreadable text as empty and steps the value on arrow keys,
// so the app could neither show what was typed nor judge it. The accepted range
// shows beside the label, and under the field while the text is not one of them.
function NumberField({
  label,
  setting,
  text,
  valid,
  onChange,
}: {
  label: string;
  setting: NumberSettingKey;
  text: string;
  valid: boolean;
  onChange: (text: string) => void;
}) {
  const { t, number } = useI18n();
  const errorId = useId();
  const { min, max, whole } = SETTINGS_BOUNDS[setting];
  return (
    <div className="numberField">
      <label>
        <span>
          {label}{" "}
          <span className="fieldRange">
            {number(min)}–{number(max)}
          </span>
        </span>
        <input
          type="text"
          inputMode={whole ? "numeric" : "decimal"}
          value={text}
          aria-invalid={!valid}
          aria-describedby={valid ? undefined : errorId}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {valid ? null : (
        <p id={errorId} className="fieldError errorText">
          {t(whole ? "settings.wholeNumberRange" : "settings.numberRange", { min, max })}
        </p>
      )}
    </div>
  );
}
