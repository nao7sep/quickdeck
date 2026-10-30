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
      // System shows what it resolves to now, named in the interface language.
      ["system", "System (Japanese)", ""],
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

// number-field conventions: the text stays as typed, an unusable value says what
// the field accepts under it, and Save waits until every field is usable.
describe("SettingsModal number fields", () => {
  const field = (label: string) => {
    const input = Array.from(document.querySelectorAll("label"))
      .find((element) => element.textContent?.startsWith(label))
      ?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
    return input;
  };
  const type = async (input: HTMLInputElement, text: string) => {
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const saveButton = () =>
    Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Save Settings")!;
  const errorOf = (input: HTMLInputElement) =>
    input.getAttribute("aria-describedby") === null
      ? null
      : document.getElementById(input.getAttribute("aria-describedby")!)?.textContent;

  it("keeps an unusable entry as typed, says what the field accepts under it, and holds Save until it is fixed", async () => {
    await renderSettings();
    const size = field("Editor font size");
    for (const text of ["16.5", "9", "abc", "1e1"]) {
      await type(size, text);
      expect(size.value).toBe(text);
      expect(size.getAttribute("aria-invalid")).toBe("true");
      expect(errorOf(size)).toBe("Enter a whole number from 10 to 32.");
      expect(saveButton().disabled).toBe(true);
    }

    await type(size, "18");
    expect(size.getAttribute("aria-invalid")).toBe("false");
    expect(errorOf(size)).toBeNull();
    await act(async () => saveButton().click());
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ editorFontSize: 18 }));
  });

  it("treats an empty padding as an error rather than zero", async () => {
    await renderSettings();
    const padding = field("Editor padding");
    await type(padding, "");
    expect(errorOf(padding)).toBe("Enter a whole number from 0 to 64.");
    expect(saveButton().disabled).toBe(true);
    await type(padding, "0");
    await act(async () => saveButton().click());
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ editorPadding: 0 }));
  });

  it("takes any line height from 1 to 3, with no step", async () => {
    await renderSettings();
    const lineHeight = field("Editor line height");
    await type(lineHeight, "3.5");
    expect(errorOf(lineHeight)).toBe("Enter a number from 1 to 3.");
    await type(lineHeight, "1.37");
    expect(errorOf(lineHeight)).toBeNull();
    await act(async () => saveButton().click());
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ editorLineHeight: 1.37 }));
  });

  it("checks the autosave delay and snapshot page size the same way", async () => {
    await renderSettings();
    const delay = field("Autosave delay");
    const pageSize = field("Snapshots per page");
    await type(delay, "0.5");
    expect(errorOf(delay)).toBe("Enter a whole number from 1 to 60.");
    await type(pageSize, "201");
    expect(errorOf(pageSize)).toBe("Enter a whole number from 5 to 200.");
    expect(saveButton().disabled).toBe(true);
  });
});
