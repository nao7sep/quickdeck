// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openUrl: vi.fn<(url: string) => Promise<void>>(),
  logWarn: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("../../src/services/logger", () => ({
  logWarn: mocks.logWarn,
  serializeError: (error: unknown) => ({ value: String(error) }),
}));

import { AboutModal } from "../../src/components/AboutModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  mocks.openUrl.mockReset();
  mocks.logWarn.mockReset();
});

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return match;
}

describe("AboutModal link results", () => {
  it("keeps each failed link local until that same link opens successfully", async () => {
    mocks.openUrl
      .mockRejectedValueOnce(new Error("opener unavailable"))
      .mockResolvedValueOnce()
      .mockResolvedValueOnce();

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<AboutModal onClose={vi.fn()} />));

    await act(async () => button("GitHub").click());
    expect(document.querySelector('[role="alert"]')?.textContent)
      .toBe("Could not open GitHub. Try again.");
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "open url failed",
      expect.objectContaining({ url: "https://github.com/nao7sep/quickdeck" }),
    );

    await act(async () => button("Report Issue").click());
    expect(document.querySelector('[role="alert"]')?.textContent)
      .toContain("Could not open GitHub");

    await act(async () => button("GitHub").click());
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
