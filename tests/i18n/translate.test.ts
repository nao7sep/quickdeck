import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { createTranslator } from "../../src/i18n/translate";

describe("createTranslator", () => {
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
    const parts = createTranslator("en").rich("load.hint", { dataDir: "D", envVar: "E" }) as unknown[];
    const filled = parts.map((part) => (isValidElement(part) ? (part as ReactElement<{ children: unknown }>).props.children : part));
    expect(filled.join("")).toContain("(D by default, or E if set)");
  });

  it("formats percentages and dates for the locale", () => {
    expect(createTranslator("en", "en-US").percent(1.1)).toBe("110%");
    expect(createTranslator("fr").percent(1.1)).toBe("110 %");
  });

  it("renders a message descriptor", () => {
    const t = createTranslator("en");
    expect(t.text({ key: "load.panesNewer", values: { version: 2 } })).toContain("(format 2)");
  });
});
