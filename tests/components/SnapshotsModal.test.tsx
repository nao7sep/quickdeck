// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  deleteOne: vi.fn(),
  deleteAll: vi.fn(),
  refreshCount: vi.fn(),
  copyText: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("../../src/services/persistence", () => ({
  listSnapshots: mocks.list,
  deleteSnapshot: mocks.deleteOne,
  deleteAllSnapshots: mocks.deleteAll,
}));
vi.mock("../../src/services/clipboard", () => ({ copyText: mocks.copyText }));
vi.mock("../../src/services/logger", () => ({
  logWarn: mocks.logWarn,
  serializeError: (error: unknown) => ({ value: String(error) }),
}));
vi.mock("../../src/state/AppStateContext", () => ({
  useAppState: () => ({
    settings: { snapshotSearchPageSize: 20 },
    panes: [{ id: "pane-1", title: "Notes", headerColor: "#c72323" }],
    refreshSnapshotCount: mocks.refreshCount,
  }),
}));

import { SnapshotsModal } from "../../src/components/SnapshotsModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  mocks.list.mockReset();
  mocks.deleteOne.mockReset();
  mocks.deleteAll.mockReset();
  mocks.refreshCount.mockReset();
  mocks.copyText.mockReset();
  mocks.logWarn.mockReset();
});

function row(id: string, content: string, paneId = "pane-1", paneTitle = "Scratch") {
  return { id, paneId, paneTitle, createdAtUtc: "2026-09-08T00:00:00.000Z", content };
}

async function open() {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<SnapshotsModal onClose={vi.fn()} />));
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".snapshotRow"));
}

function pressOnList(key: string) {
  const list = document.querySelector<HTMLElement>(".snapshotList")!;
  list.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("SnapshotsModal browsing", () => {
  it("lists the whole store on open, with no query typed", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "first"), row("b", "second")], hasMore: false });
    await open();

    expect(mocks.list).toHaveBeenCalledWith("", 20, 0);
    expect(rows()).toHaveLength(2);
  });

  it("selects the first snapshot so the detail pane is never blank on open", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "first"), row("b", "second")], hasMore: false });
    await open();

    expect(rows()[0].getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".snapshotDetail pre")?.textContent).toBe("first");
  });

  it("tells an empty store apart from a search that matched nothing", async () => {
    mocks.list.mockResolvedValue({ rows: [], hasMore: false });
    await open();
    expect(document.querySelector(".snapshotList")?.textContent).toContain("No snapshots yet.");

    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "needle");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const search = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Search",
    )!;
    await act(async () => search.click());

    expect(document.querySelector(".snapshotList")?.textContent).toContain(
      "No snapshots match your search.",
    );
  });
});

describe("SnapshotsModal list as one composite control", () => {
  it("gives the list a single tab stop that follows the selection", async () => {
    mocks.list.mockResolvedValue({
      rows: [row("a", "first"), row("b", "second"), row("c", "third")],
      hasMore: false,
    });
    await open();

    expect(rows().map((item) => item.tabIndex)).toEqual([0, -1, -1]);

    await act(async () => pressOnList("ArrowDown"));
    expect(rows().map((item) => item.tabIndex)).toEqual([-1, 0, -1]);
    expect(rows()[1].getAttribute("aria-selected")).toBe("true");
  });

  it("swaps the detail pane as the cursor moves, and stops at the ends", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "first"), row("b", "second")], hasMore: false });
    await open();

    await act(async () => pressOnList("ArrowDown"));
    expect(document.querySelector(".snapshotDetail pre")?.textContent).toBe("second");

    await act(async () => pressOnList("ArrowDown"));
    expect(document.querySelector(".snapshotDetail pre")?.textContent).toBe("second");

    await act(async () => pressOnList("Home"));
    expect(document.querySelector(".snapshotDetail pre")?.textContent).toBe("first");
  });

  it("keeps the empty list reachable by Tab", async () => {
    mocks.list.mockResolvedValue({ rows: [], hasMore: false });
    await open();

    expect(document.querySelector<HTMLElement>(".snapshotList")?.tabIndex).toBe(0);
  });

  it("adds no control for the next page, so the list stays one tab stop", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "first")], hasMore: true });
    await open();

    const list = document.querySelector<HTMLElement>(".snapshotList")!;
    expect(list.querySelectorAll("button, [tabindex='0']")).toHaveLength(1);
    expect(list.querySelector("[tabindex='0']")?.classList.contains("snapshotRow")).toBe(true);
  });

  it("colours a row from its pane, and leaves an orphaned snapshot uncoloured", async () => {
    mocks.list.mockResolvedValue({
      rows: [row("a", "first"), row("b", "second", "deleted-pane")],
      hasMore: false,
    });
    await open();

    const dots = Array.from(document.querySelectorAll<HTMLElement>(".snapshotRowDot"));
    expect(dots[0].style.background).not.toBe("");
    expect(dots[1].style.background).toBe("");
  });

  it("names the pane a snapshot came from, from the pane itself or from the snapshot", async () => {
    mocks.list.mockResolvedValue({
      rows: [
        // A live pane: the name it goes by now, even if the copy was taken under an older one.
        row("a", "first", "pane-1", "Old name"),
        // A deleted pane: the name the copy carries.
        row("b", "second", "deleted-pane", "Shopping"),
        // Saved before names were recorded: nothing rather than a placeholder.
        row("c", "third", "deleted-pane", ""),
      ],
      hasMore: false,
    });
    await open();

    const names = Array.from(document.querySelectorAll<HTMLElement>(".snapshotRow .snapshotRowPane"));
    expect(names.map((name) => name.textContent)).toEqual(["Notes", "Shopping"]);
  });
});

describe("SnapshotsModal deleting", () => {
  // The trigger and the button that commits it share their word, by design: the trigger is
  // outlined and the one in the question is filled. The question is the later layer, so
  // answering it means the last match.
  function click(label: string, which: "first" | "last" = "first") {
    const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
      (candidate) => candidate.textContent?.trim() === label,
    );
    const button = which === "first" ? found[0] : found[found.length - 1];
    if (button === undefined) throw new Error(`no button labelled ${label}`);
    return act(async () => button.click());
  }

  it("asks before deleting the open snapshot, and a refusal touches nothing", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "first"), row("b", "second")], hasMore: false });
    await open();

    await click("Delete");
    // The question is its own layer; nothing has been deleted yet.
    expect(document.body.textContent).toContain("This copy is removed for good.");
    expect(mocks.deleteOne).not.toHaveBeenCalled();

    await click("Cancel");
    expect(mocks.deleteOne).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("This copy is removed for good.");
  });

  it("deletes the open snapshot once the question is answered, then reads the store again", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "first"), row("b", "second")], hasMore: false });
    mocks.deleteOne.mockResolvedValue(true);
    await open();
    mocks.list.mockResolvedValue({ rows: [row("b", "second")], hasMore: false });

    await click("Delete");
    await click("Delete", "last");

    expect(mocks.deleteOne).toHaveBeenCalledWith("a");
    expect(mocks.refreshCount).toHaveBeenCalled();
    expect(rows()).toHaveLength(1);
  });

  it("empties the store on the same terms, and offers that only while it holds something", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "first")], hasMore: false });
    mocks.deleteAll.mockResolvedValue(1);
    await open();

    await click("Delete all");
    expect(document.body.textContent).toContain("Every copy is removed for good.");
    mocks.list.mockResolvedValue({ rows: [], hasMore: false });
    await click("Delete", "last");

    expect(mocks.deleteAll).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(0);
    // Nothing left to empty, so the trigger goes.
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "Delete all",
      ),
    ).toBe(false);
  });
});

// jsdom lays nothing out, so the list is given the metrics of one scrolled to
// its end; the component reads exactly these three.
function scrollListToEnd() {
  const list = document.querySelector<HTMLElement>(".snapshotList")!;
  Object.defineProperty(list, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(list, "clientHeight", { value: 400, configurable: true });
  list.scrollTop = 600;
  list.dispatchEvent(new Event("scroll", { bubbles: true }));
}

describe("SnapshotsModal paging", () => {
  it("loads the next page when the list is scrolled to its end", async () => {
    mocks.list.mockResolvedValueOnce({ rows: [row("a", "first")], hasMore: true });
    await open();
    expect(mocks.list).toHaveBeenCalledTimes(1);

    mocks.list.mockResolvedValueOnce({ rows: [row("b", "second")], hasMore: false });
    await act(async () => scrollListToEnd());

    expect(mocks.list).toHaveBeenLastCalledWith("", 20, 1);
    expect(rows()).toHaveLength(2);
  });

  // Tied to `hasMore` instead of to an in-flight request, this sat there
  // reading Loading forever whenever more existed.
  it("shows the paging notice only while a page is in flight", async () => {
    mocks.list.mockResolvedValueOnce({ rows: [row("a", "first")], hasMore: true });
    await open();
    expect(document.querySelector(".snapshotListFoot")).toBeNull();

    let release!: (value: { rows: never[]; hasMore: boolean }) => void;
    mocks.list.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    await act(async () => scrollListToEnd());
    expect(document.querySelector(".snapshotListFoot")).not.toBeNull();

    await act(async () => release({ rows: [], hasMore: false }));
    expect(document.querySelector(".snapshotListFoot")).toBeNull();
  });

  it("does not page again once the store is exhausted", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "first")], hasMore: false });
    await open();

    await act(async () => scrollListToEnd());
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("lets the keyboard reach the next page by arrowing past the last row", async () => {
    mocks.list.mockResolvedValueOnce({ rows: [row("a", "first")], hasMore: true });
    await open();

    mocks.list.mockResolvedValueOnce({ rows: [row("b", "second")], hasMore: false });
    await act(async () => pressOnList("ArrowDown"));

    expect(mocks.list).toHaveBeenLastCalledWith("", 20, 1);
  });

  it("keeps the snapshot being read when a further page arrives", async () => {
    mocks.list.mockResolvedValueOnce({
      rows: [row("a", "first"), row("b", "second")],
      hasMore: true,
    });
    await open();
    await act(async () => pressOnList("ArrowDown"));
    expect(document.querySelector(".snapshotDetail pre")?.textContent).toBe("second");

    mocks.list.mockResolvedValueOnce({ rows: [row("c", "third")], hasMore: false });
    await act(async () => scrollListToEnd());

    expect(document.querySelector(".snapshotDetail pre")?.textContent).toBe("second");
  });
});

describe("SnapshotsModal detail pane", () => {
  it("is the one passive scroll owner, in place of a scroller per row", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "A long snapshot")], hasMore: false });
    await open();

    expect(document.querySelectorAll("[data-passive-scroll-region]")).toHaveLength(1);
    const preview = document.querySelector<HTMLElement>(
      ".snapshotDetail pre[data-passive-scroll-region]",
    );
    expect(preview?.tabIndex).toBe(0);
    expect(preview?.getAttribute("aria-label")).toContain("Snapshot from");
  });

  // React reuses the same <pre>, so its scroll position outlives the selection
  // unless it is reset: a reader deep in a long snapshot would otherwise land
  // in the middle of the next one.
  it("opens each snapshot at the top of its text", async () => {
    mocks.list.mockResolvedValue({
      rows: [row("a", "first"), row("b", "second")],
      hasMore: false,
    });
    await open();

    const pre = document.querySelector<HTMLElement>(".snapshotDetail pre")!;
    pre.scrollTop = 400;

    await act(async () => pressOnList("ArrowDown"));

    expect(document.querySelector<HTMLElement>(".snapshotDetail pre")?.scrollTop).toBe(0);
  });

  it("copies the selected snapshot's full text, not its excerpt", async () => {
    const long = `first line\n${"x".repeat(500)}`;
    mocks.list.mockResolvedValue({ rows: [row("a", long)], hasMore: false });
    mocks.copyText.mockResolvedValue(undefined);
    await open();

    const copy = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Copy"),
    )!;
    await act(async () => copy.click());

    expect(mocks.copyText).toHaveBeenCalledWith(long);
    expect(copy.textContent).toContain("Copied");
  });

  // Copying the same snapshot twice is ordinary; a label stuck on Copied would
  // leave the second press with no feedback at all.
  it("returns the label to Copy on its own", async () => {
    vi.useFakeTimers();
    try {
      mocks.list.mockResolvedValue({ rows: [row("a", "first")], hasMore: false });
      mocks.copyText.mockResolvedValue(undefined);
      await open();

      const copy = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Copy"),
      )!;
      await act(async () => copy.click());
      expect(copy.textContent).toContain("Copied");

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(copy.textContent).toContain("Copy");
      expect(copy.textContent).not.toContain("Copied");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the result again when the same snapshot is copied twice", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "first")], hasMore: false });
    mocks.copyText.mockResolvedValue(undefined);
    await open();

    const copy = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Copy"),
    )!;
    await act(async () => copy.click());
    expect(copy.textContent).toContain("Copied");

    // Hold the second copy open so the label between the press and the result
    // is observable: it must leave Copied, or the press reports nothing.
    let release!: () => void;
    mocks.copyText.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    await act(async () => {
      copy.click();
    });
    expect(copy.textContent).not.toContain("Copied");

    await act(async () => release());
    expect(copy.textContent).toContain("Copied");
  });
});

describe("SnapshotsModal failure presentation", () => {
  it("keeps hostile diagnostic text in the log and out of the modal", async () => {
    mocks.list.mockRejectedValue(
      new TypeError("EACCES /private/tmp/HOSTILE-SENTINEL Error invoking remote method"),
    );
    await open();

    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("Snapshots could not be searched. Try again.");
    expect(alert.textContent).not.toContain("HOSTILE-SENTINEL");
    expect(mocks.logWarn).toHaveBeenCalledOnce();
  });

  it("keeps a failed copy out of the modal's text too", async () => {
    mocks.list.mockResolvedValue({ rows: [row("a", "first")], hasMore: false });
    mocks.copyText.mockRejectedValue(new Error("HOSTILE-SENTINEL clipboard owner"));
    await open();

    const copy = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Copy"),
    )!;
    await act(async () => copy.click());

    const alert = document.querySelector('[role="alert"]')!;
    expect(alert.textContent).not.toContain("HOSTILE-SENTINEL");
    expect(mocks.logWarn).toHaveBeenCalledOnce();
  });
});
