import { shortcutDefinitions } from "../shortcuts";
import { ModalBase } from "./ModalBase";

type ShortcutsModalProps = {
  onClose: () => void;
};

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <ModalBase
      title="Shortcuts"
      onRequestClose={onClose}
      footer={
        <button className="secondaryButton" type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="shortcutList">
        {shortcutDefinitions.map((shortcut) => (
          <div className="shortcutRow" key={shortcut.description}>
            <span>{shortcut.description}</span>
            <kbd>{shortcut.keys}</kbd>
          </div>
        ))}
      </div>
    </ModalBase>
  );
}
