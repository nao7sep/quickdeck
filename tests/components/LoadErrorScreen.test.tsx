// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { DATA_DIR_ENV_VAR, DATA_DIR_NAME } from "../../src/utils/dataFolder";
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
  expect(await render(null)).toEqual([DATA_DIR_NAME, DATA_DIR_ENV_VAR]);
});

it("names every refused file, says why, and offers only Quit", async () => {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(<LoadErrorScreen error={null} path={null} refused={[
    { path: "/data/config.json", newer: 2 },
    { path: "/data/panes.json", newer: null },
  ]} />));
  const files = [...container.querySelectorAll(".loadErrorFiles li")].map((item) => item.textContent);
  expect(files).toEqual([
    "/data/config.json was written by a newer version of QuickDeck (format 2).",
    "/data/panes.json could not be read.",
  ]);
  expect(container.textContent).toContain("nothing was changed");
  expect(container.textContent).toContain("move each file away");
  expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Quit"]);
});
