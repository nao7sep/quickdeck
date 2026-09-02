import { Component, type ReactNode } from "react";
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
    return (
      <main className="loadErrorShell" role="alert">
        <section className="loadErrorPanel">
          <h1 className="loadErrorTitle">QuickDeck could not keep this window open</h1>
          <p className="loadErrorMessage">
            Reload the window to recover. Your saved decks and snapshots are unchanged.
          </p>
          <div className="loadErrorActions">
            <button
              type="button"
              className="primaryButton"
              onClick={this.props.onReload ?? (() => window.location.reload())}
            >
              Reload
            </button>
          </div>
        </section>
      </main>
    );
  }
}
