import { ExternalLink } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ModalBase } from "./ModalBase";
import { useAppState } from "../state/AppStateContext";

type AboutModalProps = {
  onClose: () => void;
};

const REPO_URL = "https://github.com/nao7sep/quickdeck";
const ISSUES_URL = "https://github.com/nao7sep/quickdeck/issues";
const AUTHOR_URL = "https://github.com/nao7sep";

export function AboutModal({ onClose }: AboutModalProps) {
  const { dataDir } = useAppState();

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
        <p className="aboutVersion">Version 0.1.0</p>
        <p>
          A local-first multi-pane plain-text workspace.
          Your data stays on your machine — no telemetry, no remote sync.
        </p>
        <div className="aboutLinks">
          <button type="button" className="aboutLinkButton" onClick={() => open(REPO_URL)}>
            GitHub
            <ExternalLink size={12} />
          </button>
          <button type="button" className="aboutLinkButton" onClick={() => open(ISSUES_URL)}>
            Report Issue
            <ExternalLink size={12} />
          </button>
          <button type="button" className="aboutLinkButton" onClick={() => open(AUTHOR_URL)}>
            Author
            <ExternalLink size={12} />
          </button>
        </div>
        <p className="aboutMeta">© 2026 Yoshinao Inoguchi · MIT License</p>
        <p className="aboutDataPath">Data directory: {dataDir}</p>
      </div>
    </ModalBase>
  );
}
