import { beforeEach, expect, it, vi } from "vitest";
import type { SnapshotWriteInput } from "../../src/services/persistence";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke }));

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
});

const input: SnapshotWriteInput = { paneId: "p1", paneTitle: "Test", trigger: "copy", content: "beta" };

it("does not let an earlier capture repopulate Delete all", async () => {
  const { createSnapshot, deleteAllSnapshots } = await import("../../src/services/persistence");
  let rows: string[] = [];
  let release!: () => void;
  let captureAdmitted!: () => void;
  const admitted = new Promise<void>((resolve) => { captureAdmitted = resolve; });
  invoke.mockImplementation((command: string) => {
    if (command === "create_snapshot") return new Promise((resolve) => {
      release = () => {
        rows.push(input.content);
        resolve({ inserted: true, id: "snapshot" });
      };
      captureAdmitted();
    });
    const removed = rows.length;
    rows = [];
    return Promise.resolve(removed);
  });
  const capturing = createSnapshot(input);
  const deleting = deleteAllSnapshots();
  await admitted;
  release();
  await Promise.all([capturing, deleting]);
  expect(rows).toEqual([]);
});

it("orders a batch and a single deletion with single captures", async () => {
  const { createSnapshot, createSnapshots, deleteSnapshot } = await import("../../src/services/persistence");
  let release!: () => void;
  let firstAdmitted!: () => void;
  const admitted = new Promise<void>((resolve) => { firstAdmitted = resolve; });
  invoke.mockImplementationOnce(() => new Promise((resolve) => {
    release = () => resolve({ inserted: true, id: "first" });
    firstAdmitted();
  }));
  invoke.mockResolvedValueOnce([{ inserted: true, id: "second" }]);
  invoke.mockResolvedValueOnce(true);
  const first = createSnapshot(input);
  const batch = createSnapshots([input]);
  const deletion = deleteSnapshot("first");
  await admitted;
  try {
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["create_snapshot"]);
  } finally {
    release();
    await Promise.all([first, batch, deletion]);
  }
  expect(invoke.mock.calls).toEqual([
    ["create_snapshot", input],
    ["create_snapshots", { snapshots: [input] }],
    ["delete_snapshot", { id: "first" }],
  ]);
});

it("keeps failures rejectable and admits the next mutation after settlement", async () => {
  const { createSnapshot, deleteAllSnapshots } = await import("../../src/services/persistence");
  invoke.mockRejectedValueOnce(new Error("disk full"));
  invoke.mockResolvedValueOnce(0);
  const capture = createSnapshot(input);
  const deletion = deleteAllSnapshots();
  await expect(capture).rejects.toThrow("disk full");
  await expect(deletion).resolves.toBe(0);
});
