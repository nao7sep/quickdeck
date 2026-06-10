import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppStateProvider } from "./state/AppStateContext";
import { logError, logInfo, serializeError } from "./services/logger";
import "./styles.css";

// Global last-resort hooks: log anything that escapes a component or a promise
// before it is lost. The Rust core also installs a panic hook for the native
// side; together they cover both halves of the app.
window.addEventListener("error", (event) => {
  logError("uncaught error", {
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    // Keep the description under `error` so it never collides with the envelope
    // `message`; for cross-origin "Script error." there is no error object.
    error: event.error ? serializeError(event.error) : { message: event.message },
  });
});

window.addEventListener("unhandledrejection", (event) => {
  logError("unhandled rejection", { error: serializeError(event.reason) });
});

logInfo("ui ready");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </React.StrictMode>,
);
