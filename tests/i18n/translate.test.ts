import { isValidElement, type ReactElement } from "react";
import { CATALOGUE_LOADERS, loadCatalogue, type MessageKey } from "../../src/i18n/catalogues";
import { beforeAll, describe, expect, it } from "vitest";
import { createTranslator } from "../../src/i18n/translate";

describe("loadCatalogue", () => {
  it("lets a translator speak a language only once its catalogue is loaded", async () => {
    expect(createTranslator("ko").t("common.close")).toBe("Close");
    await loadCatalogue("ko");
    expect(createTranslator("ko").t("common.close")).not.toBe("Close");
  });
});

describe("createTranslator", () => {
  beforeAll(async () => {
    await Promise.all((["de", "fr", "ja", "ru"] as const).map(loadCatalogue));
  });

  it("fills placeholders and formats numbers for the locale", () => {
    expect(createTranslator("en").t("about.version", { version: "1.2.0" })).toBe("Version 1.2.0");
    expect(createTranslator("en", "en-US").t("pane.words", { count: 12345 })).toBe("Words 12,345");
    expect(createTranslator("de").t("pane.words", { count: 12345 })).toBe("Wörter 12.345");
  });

  it("chooses the plural form by the language's own rules", () => {
    const ru = createTranslator("ru");
    expect(ru.t("status.panes", { count: 1 })).toBe("1 панель");
    expect(ru.t("status.panes", { count: 3 })).toBe("3 панели");
    expect(ru.t("status.panes", { count: 5 })).toBe("5 панелей");
    expect(ru.t("status.panes", { count: 21 })).toBe("21 панель");
    expect(createTranslator("en").t("status.snapshots", { count: 1 })).toBe("1 snapshot");
    expect(createTranslator("en").t("status.snapshots", { count: 0 })).toBe("0 snapshots");
    expect(createTranslator("ja").t("status.panes", { count: 2 })).toBe("2 ペイン");
  });

  it("puts markup into placeholders for rich text", () => {
    const parts = createTranslator("en").rich("load.hint", { path: "P" }) as unknown[];
    const filled = parts.map((part) => (isValidElement(part) ? (part as ReactElement<{ children: unknown }>).props.children : part));
    expect(filled.join("")).toContain("repair or move P, then relaunch");
  });

  it("formats percentages and dates for the locale", () => {
    expect(createTranslator("en", "en-US").percent(1.1)).toBe("110%");
    expect(createTranslator("fr").percent(1.1)).toBe("110 %");
  });

  it("renders a message descriptor", () => {
    const t = createTranslator("en");
    expect(t.text({ key: "load.panesNewer", values: { version: 2 } })).toContain("(format 2)");
  });

  it("speaks English for a key the language's catalogue lacks", async () => {
    // A stale build or a half-merged catalogue could still reach this.
    const ja = await CATALOGUE_LOADERS.ja();
    const key = "common.close" as MessageKey;
    const saved = ja[key];
    delete (ja as Record<string, unknown>)[key];
    try {
      expect(createTranslator("ja").t(key)).toBe("Close");
    } finally {
      (ja as Record<string, unknown>)[key] = saved;
    }
  });

  it("shows a key no catalogue carries instead of failing the render", () => {
    // Types keep this out of the app; a stale build or a half-merged catalogue
    // could still reach it, and a window must not go down over one string.
    const missing = "gone.missing" as unknown as MessageKey;
    expect(createTranslator("ja").t(missing)).toBe("gone.missing");
  });
});
