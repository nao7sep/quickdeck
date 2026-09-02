import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { logWarn, serializeError } from "../services/logger";
import { ModalBase } from "./ModalBase";

type AboutModalProps = {
  onClose: () => void;
};

const REPO_URL = "https://github.com/nao7sep/quickdeck";
const ISSUES_URL = "https://github.com/nao7sep/quickdeck/issues";

export function AboutModal({ onClose }: AboutModalProps) {
  const [repoLinkFailed, setRepoLinkFailed] = useState(false);
  const [issuesLinkFailed, setIssuesLinkFailed] = useState(false);

  async function open(url: string, setFailed: (failed: boolean) => void) {
    try {
      if (isTauri()) {
        await openUrl(url);
      } else if (window.open(url, "_blank", "noreferrer") === null) {
        throw new Error("Browser declined to open a new window");
      }
      setFailed(false);
    } catch (error) {
      logWarn("open url failed", { url, error: serializeError(error) });
      setFailed(true);
    }
  }

  return (
    <ModalBase
      title="About QuickDeck"
      onRequestClose={onClose}
      footer={
        <button className="secondaryButton" type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="aboutText">
        <p className="aboutTitle">QuickDeck</p>
        <p className="aboutVersion">Version {__APP_VERSION__}</p>
        <p>A local-first multi-pane plain text workspace.</p>
        <div className="aboutLinks">
          <button
            type="button"
            className="aboutLinkButton"
            onClick={() => void open(REPO_URL, setRepoLinkFailed)}
          >
            GitHub
            <ExternalLink size={12} />
          </button>
          <button
            type="button"
            className="aboutLinkButton"
            onClick={() => void open(ISSUES_URL, setIssuesLinkFailed)}
          >
            Report Issue
            <ExternalLink size={12} />
          </button>
        </div>
        {repoLinkFailed || issuesLinkFailed ? (
          <div className="aboutLinkResults">
            {repoLinkFailed ? (
              <div className="aboutLinkResult" role="alert" aria-atomic="true">
                <span>Could not open GitHub. Try again.</span>
              </div>
            ) : null}
            {issuesLinkFailed ? (
              <div className="aboutLinkResult" role="alert" aria-atomic="true">
                <span>Could not open Report Issue. Try again.</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="aboutMeta">© 2026 Yoshinao Inoguchi · MIT License</p>
      </div>
    </ModalBase>
  );
}
