// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/logger", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/services/logger")>();
  return { ...original, logError: vi.fn() };
});

import { RootErrorBoundary } from "../../src/components/RootErrorBoundary";
import { logError } from "../../src/services/logger";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function BrokenView(): never {
  throw new Error("IPC EACCES /private/tmp/quickdeck render sentinel", {
    cause: new TypeError("root cause sentinel"),
  });
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("root render recovery", () => {
  it("shows authored reload copy and logs the full cause chain", async () => {
    const reload = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <RootErrorBoundary onReload={reload}>
          <BrokenView />
        </RootErrorBoundary>,
      );
    });

    expect(host.textContent).toContain("QuickDeck could not keep this window open");
    expect(host.textContent).not.toContain("EACCES");
    host.querySelector("button")?.click();
    expect(reload).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith(
      "renderer root failed",
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining("EACCES"),
          cause: expect.objectContaining({ message: "root cause sentinel" }),
        }),
      }),
    );
  });
});
