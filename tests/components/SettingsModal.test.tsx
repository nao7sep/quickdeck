// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../src/state/defaults";

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  settings: {} as Record<string, unknown>,
}));

vi.mock("../../src/state/AppStateContext", () => ({
  useAppState: () => ({ settings: mocks.settings, updateSettings: mocks.updateSettings, systemLanguage: "ja" }),
}));

vi.mock("../../src/services/persistence", () => ({
  systemTheme: () => Promise.resolve("dark"),
}));

import { SettingsModal } from "../../src/components/SettingsModal";
import { systemTimeZone } from "../../src/utils/timeZone";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  mocks.updateSettings.mockReset();
});

async function renderSettings() {
  mocks.settings = { ...defaultSettings };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<SettingsModal onClose={vi.fn()} />));
  const select = document.querySelector("select");
  if (!(select instanceof HTMLSelectElement)) throw new Error("Missing language select");
  return select;
}

// Every System entry shows what it resolves to now (app-chrome conventions,
// Theme; timestamp-conventions, Time zones).
describe("SettingsModal System entries and display zone", () => {
  it("shows the OS appearance beside the theme's System", async () => {
    await renderSettings();
    await act(async () => Promise.resolve());
    const labels = Array.from(document.querySelectorAll(".radioRow span")).map((span) => span.textContent);
    expect(labels).toEqual(["System (Dark)", "Light", "Dark"]);
  });

  it("lists System with its zone first, then the platform's zones, and saves a chosen zone", async () => {
    await renderSettings();
    const zone = document.querySelectorAll("select")[1] as HTMLSelectElement;
    expect(zone.options[0].value).toBe("system");
    expect(zone.options[0].textContent).toBe(`System (${systemTimeZone()})`);
    expect(Array.from(zone.options).map((option) => option.value)).toContain("Asia/Tokyo");

    await act(async () => {
      zone.value = "Asia/Tokyo";
      zone.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Save Settings");
    await act(async () => save?.click());
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ displayZone: "Asia/Tokyo" }));
  });
});

describe("SettingsModal language", () => {
  it("lists System first, then every language by its own name in its own script", async () => {
    const select = await renderSettings();
    const options = Array.from(select.options).map((option) => [option.value, option.textContent, option.lang]);
    expect(options).toEqual([
      // System shows what it resolves to now: the computer's language.
      ["system", "System (日本語)", ""],
      ["en", "English", "en"],
      ["de", "Deutsch", "de"],
      ["es", "Español", "es"],
      ["fr", "Français", "fr"],
      ["it", "Italiano", "it"],
      ["pt-BR", "Português", "pt-BR"],
      ["ru", "Русский", "ru"],
      ["ja", "日本語", "ja"],
      ["ko", "한국어", "ko"],
      ["zh-Hans", "中文", "zh-Hans"],
    ]);
    expect(select.value).toBe("system");
  });

  it("applies a new language on Save, like its neighbours", async () => {
    const select = await renderSettings();
    await act(async () => {
      select.value = "ru";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    const save = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Save Settings");
    await act(async () => save?.click());
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ language: "ru" }));
  });
});
