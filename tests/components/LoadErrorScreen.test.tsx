// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { LoadErrorScreen } from "../../src/components/LoadErrorScreen";
import { message } from "../../src/i18n/translate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function render(path: string | null): Promise<string[]> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<LoadErrorScreen error={message("load.failed")} path={path} />));
  return [...container.querySelectorAll(".loadErrorHint code")].map((code) => code.textContent ?? "");
}

it("names the file the halt left in place", async () => {
  expect(await render("C:\\Users\\me\\.quickdeck\\panes.json")).toEqual([
    "C:\\Users\\me\\.quickdeck\\panes.json",
  ]);
});

it("names the data folder when the load stopped before reaching a file", async () => {
  expect(await render(null)).toEqual([".quickdeck", "QUICKDECK_DATA_DIR"]);
});

it("presents completed recovery facts beside the terminal halt", async () => {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(<LoadErrorScreen error={message("load.failed")} path="/actual/snapshots.sqlite3" recovery={[
    message("load.settingsSetAside", { path: "/actual/config.invalid" }),
    message("load.panesSetAside", { path: "/actual/panes.invalid" }),
  ]} />));
  expect(container.textContent).toContain("moved to /actual/config.invalid");
  expect(container.textContent).toContain("moved to /actual/panes.invalid");
  expect(container.textContent).toContain("/actual/snapshots.sqlite3");
  expect(container.textContent).not.toContain("started with");
});
