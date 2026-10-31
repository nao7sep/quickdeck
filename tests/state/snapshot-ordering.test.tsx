import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AppStateProvider, useAppState } from "../../src/state/AppStateContext";
import { PaneView } from "../../src/components/PaneView";
import type { LoadedAppData } from "../../src/services/persistence";

const native = vi.hoisted(() => ({
  rows: ["alpha"],
  releaseBefore: () => {},
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "load_app_data") return loaded();
    if (command === "count_snapshots") return native.rows.length;
    if (command === "create_snapshot") {
      const content = args.content as string;
      const commit = () => {
        // Native dedup compares the last inserted text, not every older copy.
        if (native.rows.at(-1) === content) return { inserted: false, id: null };
        native.rows.push(content);
        return { inserted: true, id: String(native.rows.length) };
      };
      if (content === "beta") return new Promise((resolve) => {
        // Hold the earlier blocking dispatch before it acquires the native
        // connection; a later command must not overtake it at this boundary.
        native.releaseBefore = () => resolve(commit());
      });
      return commit();
    }
    return undefined;
  },
}));

function loaded(): LoadedAppData {
  return {
    config: null, state: null,
    panes: { panes: [{ id: "p1", title: "Test", content: "beta", headerColor: "#112233", backgroundColor: "#ffffff" }] },
    refused: [], off: [],
    dataDir: "/disposable", systemLanguage: "en", systemLocale: null,
  };
}

function Editor() {
  return <PaneView pane={useAppState().activePane} />;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps the return to earlier text when pre-paste native dispatch is late", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AppStateProvider><Editor /></AppStateProvider>));
    const editor = host.querySelector("textarea")!;
    editor.setSelectionRange(0, editor.value.length);
    await act(async () => editor.dispatchEvent(new Event("paste", { bubbles: true })));
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "alpha");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => native.releaseBefore());
    expect(native.rows).toEqual(["alpha", "beta", "alpha"]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
