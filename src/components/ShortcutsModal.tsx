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
      {/* The catalogue-matches-bindings rule: a chord that stands down in some
          context says so (keyboard-shortcut-conventions). */}
      <p className="shortcutNote">
        On macOS, chords that overlap the system's text-editing keys — the Ctrl
        halves of letter chords, and the pane chords on Left/Right — yield to
        the text field while you are typing in one.
      </p>
    </ModalBase>
  );
}
