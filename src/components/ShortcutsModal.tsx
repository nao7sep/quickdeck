import { shortcutDefinitions } from "../shortcuts";
import { ModalBase } from "./ModalBase";

type ShortcutsModalProps = {
  onClose: () => void;
};

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <ModalBase title="Shortcuts" onRequestClose={onClose}>
      <div className="shortcutList">
        {shortcutDefinitions.map((shortcut) => (
          <div className="shortcutRow" key={shortcut.id}>
            <span>{shortcut.description}</span>
            <kbd>{shortcut.keys}</kbd>
          </div>
        ))}
      </div>
    </ModalBase>
  );
}
