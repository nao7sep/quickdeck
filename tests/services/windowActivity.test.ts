import { describe, expect, it } from "vitest";
import { applyWindowActivity } from "../../src/services/windowActivity";

describe("window activity", () => {
  it("marks the root inactive only while the native window has lost focus", () => {
    const calls: Array<[string, boolean | undefined]> = [];
    const root = { toggleAttribute: (name: string, force?: boolean) => { calls.push([name, force]); return !!force; } };
    applyWindowActivity(root, false);
    applyWindowActivity(root, true);
    expect(calls).toEqual([["data-window-inactive", true], ["data-window-inactive", false]]);
  });
});
