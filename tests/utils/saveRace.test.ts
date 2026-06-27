import { describe, expect, it } from "vitest";
import { resolveSaveState } from "../../src/utils/saveRace";

describe("resolveSaveState", () => {
  it("is 'saved' when the dirty counter did not move during the save", () => {
    expect(resolveSaveState(5, 5)).toBe("saved");
  });

  it("is 'unsaved' when an edit bumped the counter mid-save", () => {
    // An edit arrived while the write was in flight, so the bytes are stale.
    expect(resolveSaveState(5, 6)).toBe("unsaved");
  });

  it("treats any change in the counter as unsaved, not just +1", () => {
    expect(resolveSaveState(5, 8)).toBe("unsaved");
  });
});
