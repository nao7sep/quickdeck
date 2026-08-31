import { describe, expect, it } from "vitest";

import { denyUnhandledExternalDrop } from "../../src/utils/externalDropBoundary";

function drag(
  defaultPrevented = false,
  editable = false,
  types: string[] = [],
  items: Array<{ kind: string }> = [],
): DragEvent {
  const event = {
    defaultPrevented,
    preventDefault() { this.defaultPrevented = true; },
    target: editable ? { tagName: "TEXTAREA" } : null,
    dataTransfer: { types, items, dropEffect: "copy" },
  };
  return event as unknown as DragEvent;
}

describe("renderer external-drop boundary", () => {
  it("denies an unowned drop without overriding an owned one", () => {
    const unowned = drag();
    denyUnhandledExternalDrop(unowned);
    expect(unowned.defaultPrevented).toBe(true);
    expect(unowned.dataTransfer?.dropEffect).toBe("none");

    const owned = drag(true);
    denyUnhandledExternalDrop(owned);
    expect(owned.dataTransfer?.dropEffect).toBe("copy");

    const editableText = drag(false, true, ["text/plain"]);
    denyUnhandledExternalDrop(editableText);
    expect(editableText.defaultPrevented).toBe(false);

    const editableLink = drag(false, true, ["text/uri-list"]);
    denyUnhandledExternalDrop(editableLink);
    expect(editableLink.defaultPrevented).toBe(false);

    const unownedLink = drag(false, false, ["text/uri-list"]);
    denyUnhandledExternalDrop(unownedLink);
    expect(unownedLink.defaultPrevented).toBe(true);
    expect(unownedLink.dataTransfer?.dropEffect).toBe("none");

    const editableFile = drag(false, true, [], [{ kind: "file" }]);
    denyUnhandledExternalDrop(editableFile);
    expect(editableFile.defaultPrevented).toBe(true);
  });
});
