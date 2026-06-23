import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { describe, expect, it } from "vitest";
import { isComposingEvent, isComposingKeyboardEvent } from "../../src/hooks/useComposing";

const ref = (value: boolean): RefObject<boolean> => ({ current: value });

describe("isComposingKeyboardEvent", () => {
  it("is true when the composition ref is set, regardless of the event", () => {
    const event = new KeyboardEvent("keydown", { key: "Enter" });
    expect(isComposingKeyboardEvent(ref(true), event)).toBe(true);
  });

  it("is true when the native event reports isComposing", () => {
    const event = new KeyboardEvent("keydown", { key: "Enter", isComposing: true });
    expect(isComposingKeyboardEvent(ref(false), event)).toBe(true);
  });

  it("falls back to legacy keyCode 229", () => {
    const fake = { isComposing: false, keyCode: 229 } as unknown as KeyboardEvent;
    expect(isComposingKeyboardEvent(ref(false), fake)).toBe(true);
  });

  it("reads through a React synthetic event's nativeEvent", () => {
    const synthetic = { nativeEvent: { isComposing: true } } as unknown as ReactKeyboardEvent;
    expect(isComposingKeyboardEvent(ref(false), synthetic)).toBe(true);
  });

  it("is false when no composition signal is present", () => {
    const fake = { isComposing: false, keyCode: 0 } as unknown as KeyboardEvent;
    expect(isComposingKeyboardEvent(ref(false), fake)).toBe(false);
  });
});

// The ref-free variant the global shortcut dispatcher uses: a command chord mid-composition carries
// isComposing on its own keydown, so no per-input ref is needed there.
describe("isComposingEvent", () => {
  it("is true when the native event reports isComposing", () => {
    const event = new KeyboardEvent("keydown", { key: "n", metaKey: true, isComposing: true });
    expect(isComposingEvent(event)).toBe(true);
  });

  it("falls back to legacy keyCode 229", () => {
    const fake = { isComposing: false, keyCode: 229 } as unknown as KeyboardEvent;
    expect(isComposingEvent(fake)).toBe(true);
  });

  it("reads through a React synthetic event's nativeEvent", () => {
    const synthetic = { nativeEvent: { isComposing: true } } as unknown as ReactKeyboardEvent;
    expect(isComposingEvent(synthetic)).toBe(true);
  });

  it("is false for a plain command chord with no composition in progress", () => {
    const event = new KeyboardEvent("keydown", { key: "n", metaKey: true, isComposing: false });
    expect(isComposingEvent(event)).toBe(false);
  });
});
