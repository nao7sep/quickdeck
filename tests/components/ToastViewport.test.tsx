// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastList } from "../../src/components/ToastViewport";
import { message } from "../../src/i18n/translate";

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
          { id: "warning", kind: "warning", message: message("toast.snapshotFailed") },
          { id: "error", kind: "error", message: message("toast.closeFailed") },
          { id: "info", kind: "info", message: message("toast.lastPane") },
        ]}
        onDismiss={vi.fn()}
      />,
    ));

    expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not close the window");
    expect(document.querySelector('[role="alert"]')?.textContent).not.toContain("Error");
    const statuses = Array.from(document.querySelectorAll('[role="status"]'));
    expect(statuses.some((status) => status.textContent?.includes("snapshot wasn’t saved"))).toBe(true);
    expect(statuses.some((status) => status.textContent?.includes("At least one pane"))).toBe(true);
    expect(document.querySelectorAll(".toast svg")).toHaveLength(3);
    expect(document.querySelectorAll(".toastClose svg")).toHaveLength(3);
  });
});
