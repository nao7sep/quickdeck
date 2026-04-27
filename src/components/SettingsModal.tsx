import { useMemo, useState } from "react";
import { useAppState } from "../state/AppStateContext";
import type { AppSettings } from "../types";
import { ConfirmCloseModal } from "./ConfirmCloseModal";
import { ModalBase } from "./ModalBase";

type SettingsModalProps = {
  onClose: () => void;
};

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { settings, updateSettings } = useAppState();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);

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
              onClick={() => {
                updateSettings(normalizeDraft(draft));
                onClose();
              }}
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
              checked={draft.topmost}
              onChange={(event) => setField("topmost", event.target.checked)}
            />
            <span>Keep window on top of other windows</span>
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
            <span>Editor font size (px)</span>
            <input
              type="number"
              min={10}
              max={32}
              value={draft.editorFontSize}
              onChange={(event) => setField("editorFontSize", Number(event.target.value))}
            />
          </label>
          <label>
            <span>Autosave delay after edits (seconds)</span>
            <input
              type="number"
              min={1}
              max={60}
              value={draft.autosaveDelaySeconds}
              onChange={(event) => setField("autosaveDelaySeconds", Number(event.target.value))}
            />
          </label>
          <label>
            <span>Snapshot search results per page</span>
            <input
              type="number"
              min={5}
              max={200}
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

function normalizeDraft(settings: AppSettings): AppSettings {
  return {
    ...settings,
    editorFontFamily: settings.editorFontFamily.trim() || "monospace",
    editorFontSize: clamp(settings.editorFontSize, 10, 32),
    autosaveDelaySeconds: clamp(settings.autosaveDelaySeconds, 1, 60),
    snapshotSearchPageSize: clamp(settings.snapshotSearchPageSize, 5, 200),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
