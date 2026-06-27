import { useMemo, useState } from "react";
import { useAppState } from "../state/AppStateContext";
import type { AppSettings } from "../types";
import { SETTINGS_BOUNDS, isSettingsDraftValid, normalizeSettings } from "../state/normalize";
import { ConfirmCloseModal } from "./ConfirmCloseModal";
import { ModalBase } from "./ModalBase";

type SettingsModalProps = {
  onClose: () => void;
};

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, updateSettings } = useAppState();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const isDirty = useMemo(() => {
    // Exclude zoomLevel — it is controlled outside this modal (keyboard shortcuts
    // and the menu zoom widget) and must not be compared against the draft.
    const keys = (Object.keys(settings) as (keyof AppSettings)[]).filter((k) => k !== "zoomLevel");
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
    // shape (trimmed font, clamped bounds). zoomLevel is owned outside the modal,
    // so commit the current value rather than the (possibly stale) draft copy.
    updateSettings({ ...normalizeSettings(draft), zoomLevel: settings.zoomLevel });
    onClose();
  }

  function setField<Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <>
      <ModalBase
        title="Settings"
        closeDisabled={confirmingClose}
        onRequestClose={requestClose}
        footer={
          <>
            <button className="secondaryButton" type="button" onClick={requestClose}>
              Cancel
            </button>
            <button
              className="primaryButton"
              type="button"
              disabled={!isDirty || !isValid}
              onClick={save}
            >
              Save Settings
            </button>
          </>
        }
      >
        <div className="formGrid">
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.dark}
              onChange={(event) => setField("dark", event.target.checked)}
            />
            <span>Dark theme</span>
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.zen}
              onChange={(event) => setField("zen", event.target.checked)}
            />
            <span>Zen mode (show only the focused pane)</span>
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.topmost}
              onChange={(event) => setField("topmost", event.target.checked)}
            />
            <span>Keep window on top of other windows</span>
          </label>
          <label>
            <span>UI font</span>
            <input
              type="text"
              value={draft.uiFontFamily}
              onChange={(event) => setField("uiFontFamily", event.target.value)}
              placeholder="Default"
            />
          </label>
          <label>
            <span>Editor font family</span>
            <input
              type="text"
              value={draft.editorFontFamily}
              onChange={(event) => setField("editorFontFamily", event.target.value)}
              placeholder="monospace"
            />
          </label>
          <label>
            <span>
              Editor font size (px){" "}
              <span className="fieldRange">
                {SETTINGS_BOUNDS.editorFontSize.min}–{SETTINGS_BOUNDS.editorFontSize.max}
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
              Editor line height{" "}
              <span className="fieldRange">
                {SETTINGS_BOUNDS.editorLineHeight.min}–{SETTINGS_BOUNDS.editorLineHeight.max}
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
              Editor padding (px){" "}
              <span className="fieldRange">
                {SETTINGS_BOUNDS.editorPadding.min}–{SETTINGS_BOUNDS.editorPadding.max}
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
            <span>Bold editor text</span>
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.editorItalic}
              onChange={(event) => setField("editorItalic", event.target.checked)}
            />
            <span>Italic editor text</span>
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.editorUnderline}
              onChange={(event) => setField("editorUnderline", event.target.checked)}
            />
            <span>Underline editor text</span>
          </label>
          <label>
            <span>
              Autosave delay after edits (seconds){" "}
              <span className="fieldRange">
                {SETTINGS_BOUNDS.autosaveDelaySeconds.min}–{SETTINGS_BOUNDS.autosaveDelaySeconds.max}
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
              Snapshot search results per page{" "}
              <span className="fieldRange">
                {SETTINGS_BOUNDS.snapshotSearchPageSize.min}–{SETTINGS_BOUNDS.snapshotSearchPageSize.max}
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
