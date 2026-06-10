import { beforeEach, describe, expect, it } from "vitest";
import { acquireScrollLock, releaseScrollLock } from "../src/scrollLock";

beforeEach(() => {
  document.body.style.overflow = "";
});

describe("scrollLock", () => {
  it("locks body overflow on acquire and restores the prior value on release", () => {
    document.body.style.overflow = "auto";

    acquireScrollLock();
    expect(document.body.style.overflow).toBe("hidden");

    releaseScrollLock();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("stays locked until the last holder releases (stacked modals)", () => {
    acquireScrollLock();
    acquireScrollLock();
    expect(document.body.style.overflow).toBe("hidden");

    releaseScrollLock();
    expect(document.body.style.overflow).toBe("hidden"); // one holder remains

    releaseScrollLock();
    expect(document.body.style.overflow).toBe(""); // restored to the original
  });

  it("ignores an unbalanced release and does not corrupt the next lock", () => {
    releaseScrollLock(); // count is already 0 — no-op

    acquireScrollLock();
    expect(document.body.style.overflow).toBe("hidden");

    releaseScrollLock();
    expect(document.body.style.overflow).toBe("");
  });
});
