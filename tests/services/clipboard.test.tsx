import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";
import { SnapshotsModal } from "../../src/components/SnapshotsModal";
import { copyText } from "../../src/services/clipboard";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => invoke.mockReset());
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

it("keeps snapshot copies ordered through settlement across closing and reopening", async () => {
  let clipboard = "";
  let releaseFirst!: () => void;
  let listing = 0;
  const admitted: string[] = [];
  invoke.mockImplementation((command: string, args: { text?: string } = {}) => {
    if (command === "load_app_data") return Promise.resolve({
      config: null, configQuarantinedTo: null, configNewer: null, state: null,
      panes: { panes: [{ id: "pane", title: "Notes", content: "", headerColor: "#112233", backgroundColor: "#ffffff" }] },
      panesError: null, panesNewer: null, snapshotsNewer: null,
      panesPath: "/disposable/panes.json", snapshotsPath: "/disposable/snapshots.sqlite3",
      dataDir: "/disposable", systemLanguage: "en", systemLocale: null,
    });
    if (command === "count_snapshots") return Promise.resolve(2);
    if (command === "list_snapshots") return Promise.resolve({ rows: [{
      id: String(++listing), paneId: "pane", paneTitle: "Notes",
      createdAtUtc: "2026-10-10T00:00:00Z", content: listing === 1 ? "first copy" : "second copy",
    }], hasMore: false });
    if (command === "copy_text") {
      admitted.push(args.text!);
      if (args.text === "first copy") return new Promise<void>((resolve) => {
        releaseFirst = () => { clipboard = args.text!; resolve(); };
      });
      clipboard = args.text!;
    }
    return Promise.resolve(undefined);
  });
  let reopen!: () => void;
  function Harness() {
    const [open, setOpen] = useState(true);
    reopen = () => setOpen(true);
    return useAppState().loadStatus === "ready" && open
      ? <SnapshotsModal onClose={() => setOpen(false)} /> : null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const button = (text: string) => Array.from(container.querySelectorAll("button"))
    .find((item) => item.textContent === text)!;
  await act(async () => root?.render(<AppStateProvider><Harness /></AppStateProvider>));
  await act(async () => button("Copy").click());
  try {
    expect(admitted).toEqual(["first copy"]);
    await act(async () => button("Close").click());
    await act(async () => reopen());
    await act(async () => button("Copy").click());
    // Closing a caller does not settle its native effect or let the next one pass it.
    expect(admitted).toEqual(["first copy"]);
    expect(clipboard).toBe("");
    expect(button("Copied")).toBeUndefined();
  } finally {
    await act(async () => releaseFirst());
  }
  expect(admitted).toEqual(["first copy", "second copy"]);
  expect(clipboard).toBe("second copy");
  expect(button("Copied")).toBeDefined();
});

it("keeps a failed copy rejectable and admits the next copy only after rejection settles", async () => {
  let rejectFirst!: (error: Error) => void;
  invoke.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectFirst = reject; }));
  invoke.mockResolvedValueOnce(undefined);
  const first = copyText("first copy");
  const failure = expect(first).rejects.toThrow("clipboard busy");
  const second = copyText("second copy");
  await vi.waitFor(() => expect(rejectFirst).toBeTypeOf("function"));
  try {
    expect(invoke.mock.calls).toEqual([["copy_text", { text: "first copy" }]]);
  } finally {
    rejectFirst(new Error("clipboard busy"));
    await Promise.all([failure, second]);
  }
  expect(invoke.mock.calls).toEqual([
    ["copy_text", { text: "first copy" }],
    ["copy_text", { text: "second copy" }],
  ]);
});
