import { describe, expect, it } from "vitest";
import {
  paneReadFailureMessage,
  paneShapeFailureMessage,
  settingsResetMessage,
} from "../../src/state/AppStateContext";

describe("persistence failure presentation", () => {
  it("keeps raw read and shape diagnostics out of pane recovery copy", () => {
    const hostile = "TypeError EACCES /private/tmp/HOSTILE-SENTINEL";
    const messages = [paneReadFailureMessage(hostile), paneShapeFailureMessage([hostile])];

    for (const message of messages) {
      expect(message).not.toContain("EACCES");
      expect(message).not.toContain("HOSTILE-SENTINEL");
      expect(message).not.toContain("TypeError");
    }
  });

  it("keeps internal quarantine paths out of settings recovery copy", () => {
    const message = settingsResetMessage([
      "/.quickdeck/HOSTILE-SENTINEL-EACCES.invalid",
    ]);

    expect(message).toContain("preserved copy's location is recorded in the log");
    expect(message).not.toContain("/.quickdeck/");
    expect(message).not.toContain(".invalid");
    expect(message).not.toContain("HOSTILE-SENTINEL");
    expect(message).not.toContain("EACCES");
  });
});
