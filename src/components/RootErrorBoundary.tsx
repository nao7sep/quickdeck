import { Component, type ReactNode } from "react";
import { documentTranslator } from "../i18n/I18nContext";
import { logError, serializeError } from "../services/logger";

/** Last-resort recovery for render failures outside the ordinary load-state flow. */
export class RootErrorBoundary extends Component<
  { children: ReactNode; onReload?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    logError("renderer root failed", { error: serializeError(error) });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // This boundary sits outside the language provider, so it speaks the
    // language the document last declared.
    const { t } = documentTranslator();
    return (
      <main className="loadErrorShell" role="alert">
        <section className="loadErrorPanel">
          <h1 className="loadErrorTitle">{t("crash.title")}</h1>
          <p className="loadErrorMessage">{t("crash.body")}</p>
          <div className="loadErrorActions">
            <button
              type="button"
              className="primaryButton"
              onClick={this.props.onReload ?? (() => window.location.reload())}
            >
              {t("crash.reload")}
            </button>
          </div>
        </section>
      </main>
    );
  }
}
