import { ModalBase } from "./ModalBase";

type ShortcutsModalProps = {
  onClose: () => void;
};

const shortcuts = [
  ["Cmd/Ctrl + Left", "Focus previous pane"],
  ["Cmd/Ctrl + Right", "Focus next pane"],
  ["Cmd/Ctrl + Shift + T", "Toggle always on top"],
  ["Cmd/Ctrl + Shift + Up", "Increase opacity"],
  ["Cmd/Ctrl + Shift + Down", "Decrease opacity"],
  ["Escape", "Close modal"],
];

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <ModalBase title="Shortcuts" onRequestClose={onClose}>
      <div className="shortcutList">
        {shortcuts.map(([keys, action]) => (
          <div className="shortcutRow" key={keys}>
            <kbd>{keys}</kbd>
            <span>{action}</span>
          </div>
        ))}
      </div>
    </ModalBase>
  );
}
