// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { QuitSaveErrorModal } from "../../src/components/QuitSaveErrorModal";
import { message } from "../../src/i18n/translate";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function render(reason: ReturnType<typeof message> | null) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<QuitSaveErrorModal reason={reason} onChoose={vi.fn()} />));
  return document.body.textContent ?? "";
}

it("suggests freeing storage or restoring access when no reason is named", async () => {
  const text = await render(null);
  expect(text).toContain("Free some storage or restore access to the data folder, then retry.");
});

it("shows the named reason instead of the storage advice", async () => {
  const text = await render(message("saveError.panesNewer", { path: "/data/panes.json", version: 2 }));
  expect(text).toContain("uses a newer format (format 2)");
  expect(text).not.toContain("Free some storage");
});
