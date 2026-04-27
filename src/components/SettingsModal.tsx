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
                updateSettings(draft);
                onClose();
              }}
            >
              Save Settings
            </button>
          </>
        }
      >
        <div className="formGrid">
          <label>
            <span>Autosave delay</span>
            <input
              type="number"
              min={1}
              max={60}
              value={draft.autosaveDelaySeconds}
              onChange={(event) => setField("autosaveDelaySeconds", Number(event.target.value))}
            />
          </label>
          <label>
            <span>Snapshot search page size</span>
            <input
              type="number"
              min={5}
              max={200}
              value={draft.snapshotSearchPageSize}
              onChange={(event) => setField("snapshotSearchPageSize", Number(event.target.value))}
            />
          </label>
          <label>
            <span>Editor font family</span>
            <input
              type="text"
              value={draft.editorFontFamily}
              onChange={(event) => setField("editorFontFamily", event.target.value)}
            />
          </label>
          <label>
            <span>Editor font size</span>
            <input
              type="number"
              min={10}
              max={32}
              value={draft.editorFontSize}
              onChange={(event) => setField("editorFontSize", Number(event.target.value))}
            />
          </label>
          <label className="checkboxRow">
            <input
              type="checkbox"
              checked={draft.topmost}
              onChange={(event) => setField("topmost", event.target.checked)}
            />
            <span>Keep window on top</span>
          </label>
          <label>
            <span>Opacity</span>
            <input
              type="range"
              min={0.45}
              max={1}
              step={0.05}
              value={draft.opacity}
              onChange={(event) => setField("opacity", Number(event.target.value))}
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
