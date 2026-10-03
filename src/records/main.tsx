import React from "react";
import ReactDOM from "react-dom/client";
import { RootErrorBoundary } from "../components/RootErrorBoundary";
import { logError, serializeError } from "../services/logger";
import { installWindowActivity } from "../services/windowActivity";
import { denyUnhandledExternalDrop } from "../utils/externalDropBoundary";
import { RecordsApp } from "./RecordsApp";
import "../styles.css";

// The Records window's page (records.html), beside the main window's main.tsx.
installWindowActivity();

window.addEventListener("dragover", denyUnhandledExternalDrop);
window.addEventListener("drop", denyUnhandledExternalDrop);

// Global last-resort hooks, as in the main window.
window.addEventListener("error", (event) => {
  logError("uncaught error", {
    window: "records",
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    error: event.error ? serializeError(event.error) : { message: event.message },
  });
});

window.addEventListener("unhandledrejection", (event) => {
  logError("unhandled rejection", { window: "records", error: serializeError(event.reason) });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <RecordsApp />
    </RootErrorBoundary>
  </React.StrictMode>,
);
