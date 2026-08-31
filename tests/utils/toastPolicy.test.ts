import { describe, expect, it } from "vitest";
import { INFO_TOAST_LIFETIME_MS, toastLifetimeMs } from "../../src/utils/toastPolicy";

describe("toastLifetimeMs", () => {
  it("expires only routine information", () => {
    expect(toastLifetimeMs("info")).toBe(INFO_TOAST_LIFETIME_MS);
    expect(toastLifetimeMs("warning")).toBeNull();
    expect(toastLifetimeMs("error")).toBeNull();
  });
});
