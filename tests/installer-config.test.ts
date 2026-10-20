import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANGUAGES, type Language } from "../src/i18n/languages";

// NSIS's name for each interface language.
const NSIS_LANGUAGE: Record<Language, string> = {
  en: "English",
  de: "German",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  "pt-BR": "PortugueseBR",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  "zh-Hans": "SimpChinese",
};

describe("installer configuration", () => {
  const tauriDir = join(process.cwd(), "src-tauri");
  const nsis = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8")).bundle?.windows?.nsis;

  // The installer follows the computer's language among the app's own, in the
  // app's order, English first as the fallback.
  it("speaks the app's interface languages", () => {
    expect(nsis?.languages).toEqual(LANGUAGES.map((language) => NSIS_LANGUAGE[language]));
  });

  it.each(["installerIcon", "uninstallerIcon"])("uses an icon file that exists for %s", (field) => {
    const icon = nsis?.[field];
    expect(icon).toMatch(/\.ico$/i);
    expect(existsSync(join(tauriDir, icon))).toBe(true);
  });
});
