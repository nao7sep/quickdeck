import { ModalBase } from "./ModalBase";

type ShortcutEntry = { description: string; keys: string };

const shortcuts: ShortcutEntry[] = [
  { description: "Add pane",            keys: "Cmd/Ctrl + N" },
  { description: "Focus previous pane", keys: "Cmd/Ctrl + Left" },
  { description: "Focus next pane",     keys: "Cmd/Ctrl + Right" },
  { description: "Move pane left",      keys: "Cmd/Ctrl + Shift + Left" },
  { description: "Move pane right",     keys: "Cmd/Ctrl + Shift + Right" },
  { description: "Toggle zen mode",      keys: "Cmd/Ctrl + K" },
  { description: "Toggle always on top", keys: "Cmd/Ctrl + T" },
  { description: "Zoom in",              keys: "Cmd/Ctrl + Equal / Plus / Semicolon" },
  { description: "Zoom out",             keys: "Cmd/Ctrl + Minus" },
  { description: "Reset zoom",           keys: "Cmd/Ctrl + 0" },
  { description: "Open settings",  keys: "Cmd/Ctrl + Comma" },
  { description: "Open shortcuts", keys: "Cmd/Ctrl + Slash" },
  { description: "Close modal",    keys: "Escape" },
];

type ShortcutsModalProps = {
  onClose: () => void;
};

export function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  return (
    <ModalBase title="Shortcuts" onRequestClose={onClose}>
      <div className="shortcutList">
        {shortcuts.map((s) => (
          <div className="shortcutRow" key={s.description}>
            <span>{s.description}</span>
            <kbd>{s.keys}</kbd>
          </div>
        ))}
      </div>
    </ModalBase>
  );
}
