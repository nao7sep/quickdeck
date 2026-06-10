import { describe, expect, it } from "vitest";
import { isTopmostModal, popModal, pushModal } from "../src/modalStack";

// The stack is module-global, so each test pops everything it pushes to leave a
// clean slate for the next one.
describe("modalStack", () => {
  it("reports the most recently pushed modal as topmost", () => {
    const a = {};
    const b = {};

    pushModal(a);
    expect(isTopmostModal(a)).toBe(true);

    pushModal(b);
    expect(isTopmostModal(b)).toBe(true);
    expect(isTopmostModal(a)).toBe(false);

    popModal(b);
    expect(isTopmostModal(a)).toBe(true);

    popModal(a);
  });

  it("never reports a token that is not on the stack", () => {
    const onStack = {};
    const offStack = {};
    pushModal(onStack);

    expect(isTopmostModal(offStack)).toBe(false);

    popModal(onStack);
    expect(isTopmostModal(onStack)).toBe(false);
  });

  it("removes the correct entry when popped out of order", () => {
    const a = {};
    const b = {};
    const c = {};
    pushModal(a);
    pushModal(b);
    pushModal(c);

    popModal(b); // remove the middle entry
    expect(isTopmostModal(c)).toBe(true);

    popModal(c);
    expect(isTopmostModal(a)).toBe(true);

    popModal(a);
  });

  it("ignores popping a token that was never pushed", () => {
    const a = {};
    pushModal(a);

    popModal({}); // unknown token — must be a no-op
    expect(isTopmostModal(a)).toBe(true);

    popModal(a);
  });
});
