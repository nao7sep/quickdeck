import { ExternalLink } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ModalBase } from "./ModalBase";

type AboutModalProps = {
  onClose: () => void;
};

const REPO_URL = "https://github.com/nao7sep/quickdeck";
const ISSUES_URL = "https://github.com/nao7sep/quickdeck/issues";

export function AboutModal({ onClose }: AboutModalProps) {
  function open(url: string) {
    if (isTauri()) {
      void openUrl(url).catch(() => {});
    } else {
      window.open(url, "_blank", "noreferrer");
    }
  }

  return (
    <ModalBase title="About QuickDeck" onRequestClose={onClose}>
      <div className="aboutText">
        <p className="aboutTitle">QuickDeck</p>
        <p className="aboutVersion">Version {__APP_VERSION__}</p>
        <p>A local-first multi-pane plain-text workspace.</p>
        <div className="aboutLinks">
          <button type="button" className="aboutLinkButton" onClick={() => open(REPO_URL)}>
            GitHub
            <ExternalLink size={12} />
          </button>
          <button type="button" className="aboutLinkButton" onClick={() => open(ISSUES_URL)}>
            Report Issue
            <ExternalLink size={12} />
          </button>
        </div>
        <p className="aboutMeta">© 2026 Yoshinao Inoguchi · MIT License</p>
      </div>
    </ModalBase>
  );
}
