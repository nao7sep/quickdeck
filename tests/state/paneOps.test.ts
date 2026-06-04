import { describe, expect, it } from "vitest";
import { appendPane, deletePane, reorderPane } from "../../src/state/paneOps";
import type { Pane } from "../../src/types";

const HEX = /^#[0-9a-f]{6}$/i;

function pane(id: string, content = ""): Pane {
  return { id, title: id, content, headerColor: "#aabbcc", backgroundColor: "#112233" };
}

describe("appendPane", () => {
  it("adds a new pane with the given id and a fresh color", () => {
    const result = appendPane([pane("a")], "b");
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe("b");
    expect(result[1].title).toBe("New Buffer");
    expect(result[1].content).toBe("");
    expect(result[1].headerColor).toMatch(HEX);
  });
});

describe("reorderPane", () => {
  const panes = [pane("a"), pane("b"), pane("c")];

  it("moves a pane in the requested direction", () => {
    expect(reorderPane(panes, "a", 1).map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(reorderPane(panes, "b", -1).map((p) => p.id)).toEqual(["b", "a", "c"]);
  });

  it("returns the same array reference when the move is a no-op", () => {
    expect(reorderPane(panes, "a", -1)).toBe(panes); // already at the left edge
    expect(reorderPane(panes, "c", 1)).toBe(panes); // already at the right edge
    expect(reorderPane(panes, "missing", 1)).toBe(panes); // unknown pane
  });
});

describe("deletePane", () => {
  it("refuses to delete the only pane", () => {
    expect(deletePane([pane("a")], "a", "a")).toEqual({ kind: "blocked-last" });
  });

  it("refuses to delete a pane with non-empty content", () => {
    const panes = [pane("a", "hello"), pane("b")];
    expect(deletePane(panes, "a", "a")).toEqual({ kind: "blocked-non-empty" });
  });

  it("allows deleting a pane whose content is only whitespace", () => {
    const panes = [pane("a", "  \n  "), pane("b")];
    expect(deletePane(panes, "a", "b").kind).toBe("deleted");
  });

  it("reports not-found for an unknown pane", () => {
    expect(deletePane([pane("a"), pane("b")], "z", "a")).toEqual({ kind: "not-found" });
  });

  it("falls back to the previous pane when the active pane is deleted", () => {
    const panes = [pane("a"), pane("b"), pane("c")];
    const outcome = deletePane(panes, "b", "b");
    expect(outcome).toEqual({
      kind: "deleted",
      panes: [pane("a"), pane("c")],
      nextActivePaneId: "a",
    });
  });

  it("falls back to the first pane when the active first pane is deleted", () => {
    const panes = [pane("a"), pane("b"), pane("c")];
    const outcome = deletePane(panes, "a", "a");
    expect(outcome).toMatchObject({ kind: "deleted", nextActivePaneId: "b" });
  });

  it("leaves the active pane unchanged when deleting a different pane", () => {
    const panes = [pane("a"), pane("b"), pane("c")];
    const outcome = deletePane(panes, "c", "a");
    expect(outcome).toMatchObject({ kind: "deleted", nextActivePaneId: "a" });
  });
});
