import { describe, expect, it } from "vitest";
import { normalizeThemePreference, THEME_PREFERENCES } from "../../src/utils/theme";

describe("normalizeThemePreference", () => {
  it("keeps the three choices", () => {
    expect(normalizeThemePreference("system")).toBe("system");
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("dark")).toBe("dark");
  });

  it("follows the OS for a missing, retired, or hand-edited value", () => {
    for (const value of [undefined, null, "", "Dark", "auto", true, 1]) {
      expect(normalizeThemePreference(value)).toBe("system");
    }
  });
});

describe("THEME_PREFERENCES", () => {
  it("offers System, Light, and Dark in that order", () => {
    expect(THEME_PREFERENCES.map(({ value }) => value)).toEqual(["system", "light", "dark"]);
  });
});
