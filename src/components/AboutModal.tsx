import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "../i18n/I18nContext";
import { logWarn, serializeError } from "../services/logger";
import { ModalBase } from "./ModalBase";

type AboutModalProps = {
  onClose: () => void;
};

const REPO_URL = "https://github.com/nao7sep/quickdeck";
const ISSUES_URL = "https://github.com/nao7sep/quickdeck/issues";

export function AboutModal({ onClose }: AboutModalProps) {
  const { t } = useI18n();
  const [repoLinkFailed, setRepoLinkFailed] = useState(false);
  const [issuesLinkFailed, setIssuesLinkFailed] = useState(false);
  const linkAttempts = useRef({ repository: 0, issues: 0 });

  async function open(
    owner: "repository" | "issues",
    url: string,
    setFailed: (failed: boolean) => void,
  ) {
    const attempt = ++linkAttempts.current[owner];
    try {
      if (isTauri()) {
        await openUrl(url);
      } else if (window.open(url, "_blank", "noreferrer") === null) {
        throw new Error("Browser declined to open a new window");
      }
      if (linkAttempts.current[owner] === attempt) setFailed(false);
    } catch (error) {
      logWarn("open url failed", { url, error: serializeError(error) });
      if (linkAttempts.current[owner] === attempt) setFailed(true);
    }
  }

  return (
    <ModalBase
      title={t("about.title")}
      onRequestClose={onClose}
      passiveContentLabel={t("about.title")}
      footer={
        <button className="secondaryButton" type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <div className="aboutText">
        <p className="aboutTitle">QuickDeck</p>
        <p className="aboutVersion">{t("about.version", { version: __APP_VERSION__ })}</p>
        <p>{t("about.tagline")}</p>
        <div className="aboutLinks">
          <button
            type="button"
            className="aboutLinkButton"
            onClick={() => void open("repository", REPO_URL, setRepoLinkFailed)}
          >
            GitHub
            <ExternalLink size={12} />
          </button>
          <button
            type="button"
            className="aboutLinkButton"
            onClick={() => void open("issues", ISSUES_URL, setIssuesLinkFailed)}
          >
            {t("about.reportIssue")}
            <ExternalLink size={12} />
          </button>
        </div>
        {repoLinkFailed || issuesLinkFailed ? (
          <div className="aboutLinkResults">
            {repoLinkFailed ? (
              <div className="aboutLinkResult" role="alert" aria-atomic="true">
                <span>{t("about.linkFailed", { link: "GitHub" })}</span>
              </div>
            ) : null}
            {issuesLinkFailed ? (
              <div className="aboutLinkResult" role="alert" aria-atomic="true">
                <span>{t("about.linkFailed", { link: t("about.reportIssue") })}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="aboutMeta">© 2026 Yoshinao Inoguchi · {t("about.license")}</p>
      </div>
    </ModalBase>
  );
}
