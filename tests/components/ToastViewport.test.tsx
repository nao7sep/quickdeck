// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastList } from "../../src/components/ToastViewport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("ToastList", () => {
  it("renders structural severity and appropriate live roles", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => root?.render(
      <ToastList
        toasts={[
          { id: "warning", kind: "warning", message: "Snapshot failed" },
          { id: "error", kind: "error", message: "Close failed" },
          { id: "info", kind: "info", message: "Done" },
        ]}
        onDismiss={vi.fn()}
      />,
    ));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("ErrorClose failed");
    const statuses = Array.from(document.querySelectorAll('[role="status"]'));
    expect(statuses.some((status) => status.textContent?.includes("WarningSnapshot failed"))).toBe(true);
    expect(statuses.some((status) => status.textContent?.includes("Done"))).toBe(true);
  });
});
