import { describe, expect, it } from "vitest";
import { SPELL_CHECK_MAX_CHARS, spellCheckFits } from "../../src/utils/spellCheck";

// A very large pane drops spell checking, which froze WebKit while typing, and
// gets it back when it shrinks.
describe("spellCheckFits", () => {
  it("keeps spell checking up to the limit and drops it past it", () => {
    expect(spellCheckFits("")).toBe(true);
    expect(spellCheckFits("a".repeat(SPELL_CHECK_MAX_CHARS))).toBe(true);
    expect(spellCheckFits("a".repeat(SPELL_CHECK_MAX_CHARS + 1))).toBe(false);
  });
});
