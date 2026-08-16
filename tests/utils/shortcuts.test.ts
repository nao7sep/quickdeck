import { describe, expect, it, afterEach, vi } from "vitest";
import { hasMod, isEditableTarget } from "../../src/utils/shortcuts";

type ShortcutsModule = typeof import("../../src/utils/shortcuts");

function key(
  k: string,
  mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: k, ...mods });
}

// The shadow predicate reads the platform at module load; stub navigator and
// re-import with a fresh registry to test both platforms.
async function importWithPlatform(platform: "mac" | "windows"): Promise<ShortcutsModule> {
  const platformString = platform === "mac" ? "MacIntel" : "Win32";
  vi.stubGlobal("navigator", { platform: platformString, userAgent: platformString });
  vi.resetModules();
  return import("../../src/utils/shortcuts");
}

describe("hasMod", () => {
  it("fires on either Cmd or Ctrl alone — both bound on every platform", () => {
    expect(hasMod(key("/", { metaKey: true }))).toBe(true);
    expect(hasMod(key("/", { ctrlKey: true }))).toBe(true);
    expect(hasMod(key("/"))).toBe(false);
  });

  it("rejects Alt chords — Windows AltGr arrives as Ctrl+Alt and must keep typing", () => {
    expect(hasMod(key(";", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(hasMod(key("n", { metaKey: true, altKey: true }))).toBe(false);
  });
});

// Build a fake editable-walk target chain.
function domNode(opts: {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string | null;
  parent?: ReturnType<typeof domNode> | null;
}): {
  tagName?: string;
  isContentEditable?: boolean;
  parentElement: ReturnType<typeof domNode> | null;
  getAttribute: (name: string) => string | null;
} {
  return {
    tagName: opts.tagName,
    isContentEditable: opts.isContentEditable,
    parentElement: opts.parent ?? null,
    getAttribute: (name: string) => (name === "type" ? (opts.type ?? null) : null),
  };
}

describe("isEditableTarget", () => {
  it("recognizes textareas and text-bearing inputs", () => {
    expect(isEditableTarget(domNode({ tagName: "TEXTAREA" }))).toBe(true);
    expect(isEditableTarget(domNode({ tagName: "INPUT", type: "text" }))).toBe(true);
    expect(isEditableTarget(domNode({ tagName: "INPUT", type: null }))).toBe(true); // default type is text
  });

  it("rejects non-text inputs and non-editable elements", () => {
    expect(isEditableTarget(domNode({ tagName: "INPUT", type: "checkbox" }))).toBe(false);
    expect(isEditableTarget(domNode({ tagName: "DIV" }))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("walks parentElement — a rich-text target is a DIV inside the contenteditable", () => {
    const editorRoot = domNode({ tagName: "DIV", isContentEditable: true });
    const innerSpan = domNode({ tagName: "SPAN", parent: editorRoot });
    expect(isEditableTarget(innerSpan)).toBe(true);
  });
});

describe("shadowsMacTextEditing (platform-dependent)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("on macOS, flags bare-Ctrl Cocoa letters", async () => {
    const { shadowsMacTextEditing } = await importWithPlatform("mac");
    // Ctrl+K is Cocoa kill-line; Ctrl+N next-line; Ctrl+Slash is bound too.
    expect(shadowsMacTextEditing(key("k", { ctrlKey: true }))).toBe(true);
    expect(shadowsMacTextEditing(key("n", { ctrlKey: true }))).toBe(true);
    expect(shadowsMacTextEditing(key("/", { ctrlKey: true }))).toBe(true);
    // Arrows are NOT listed: Cmd+Left/Right are Cocoa line navigation, which is
    // exactly why pane navigation uses layout-independent PageUp/PageDown keys
    // instead of being bound and then suppressed here.
    expect(shadowsMacTextEditing(key("ArrowLeft", { metaKey: true }))).toBe(false);
    expect(shadowsMacTextEditing(key("PageUp", { metaKey: true }))).toBe(false);
    // The Cmd half of a letter chord is unbound and must fire.
    expect(shadowsMacTextEditing(key("k", { metaKey: true }))).toBe(false);
    // Zoom symbols are genuinely unbound in Cocoa and stay global.
    expect(shadowsMacTextEditing(key(";", { ctrlKey: true }))).toBe(false);
    expect(shadowsMacTextEditing(key("=", { ctrlKey: true }))).toBe(false);
  });

  it("never fires off macOS — there is no Cocoa keymap to shadow", async () => {
    const { shadowsMacTextEditing } = await importWithPlatform("windows");
    expect(shadowsMacTextEditing(key("k", { ctrlKey: true }))).toBe(false);
  });
});
