import { describe, expect, it } from "vitest";
import { panePanelDomId, paneTabDomId } from "../../src/utils/paneDomIds";

describe("pane DOM ids", () => {
  it("encodes whitespace and symbols into one deterministic IDREF token", () => {
    const persistedId = "pane one / 日本語?#";
    const tabId = paneTabDomId(persistedId);
    const panelId = panePanelDomId(persistedId);

    expect(tabId).toBe("pane-tab-pane%20one%20%2F%20%E6%97%A5%E6%9C%AC%E8%AA%9E%3F%23");
    expect(panelId).toBe("pane-panel-pane%20one%20%2F%20%E6%97%A5%E6%9C%AC%E8%AA%9E%3F%23");
    expect(tabId).not.toMatch(/\s/);
    expect(panelId).not.toMatch(/\s/);
  });
});
