// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../../src/services/persistence", () => ({ searchSnapshots: mocks.search }));
vi.mock("../../src/services/logger", () => ({
  logWarn: mocks.logWarn,
  serializeError: (error: unknown) => ({ value: String(error) }),
}));
vi.mock("../../src/state/AppStateContext", () => ({
  useAppState: () => ({ settings: { snapshotSearchPageSize: 20 } }),
}));

import { SnapshotSearchModal } from "../../src/components/SnapshotSearchModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  mocks.search.mockReset();
  mocks.logWarn.mockReset();
});

describe("SnapshotSearchModal failure presentation", () => {
  it("keeps hostile diagnostic text in the log and out of the modal", async () => {
    mocks.search.mockRejectedValue(
      new TypeError("EACCES /private/tmp/HOSTILE-SENTINEL Error invoking remote method"),
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<SnapshotSearchModal onClose={vi.fn()} />));

    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "needle");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const search = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Search",
    )!;
    await act(async () => search.click());

    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("Snapshots could not be searched. Try again.");
    expect(alert.textContent).not.toContain("HOSTILE-SENTINEL");
    expect(mocks.logWarn).toHaveBeenCalledOnce();
  });
});
