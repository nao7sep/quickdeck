// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmCloseModal } from "../../src/components/ConfirmCloseModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

it("opens on Keep editing, never on the destructive action", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<ConfirmCloseModal onCancel={vi.fn()} onDiscard={vi.fn()} />));

  const cancel = document.querySelector("[data-initial-focus]");
  expect(cancel?.textContent).toBe("Keep editing");
  expect(document.activeElement).toBe(cancel);
});
