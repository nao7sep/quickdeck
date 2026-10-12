// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, MenuItem } from "../../src/components/Menu";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const LABELS = ["One", "Two", "Three", "Four"];

async function openMenu(onSelect: (label: string) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <Menu label="Commands" trigger={(props) => <button type="button" {...props}>Open</button>}>
        {LABELS.map((label) => (
          <MenuItem key={label} onSelect={() => onSelect(label)}>{label}</MenuItem>
        ))}
      </Menu>,
    ),
  );
  await act(async () => document.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
}

function item(label: string): HTMLElement {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (element) => element.textContent === label,
  )!;
}

async function press(key: string) {
  await act(async () => {
    document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function hover(element: HTMLElement) {
  for (const type of ["pointerover", "pointerenter", "mouseover", "mouseenter", "pointermove", "mousemove"]) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  }
}

// Hovering is only a visual state: the keyboard target stays where the arrows
// left it, so the next arrow or Enter acts on what the user highlighted
// (composite-control-conventions).
describe("Menu keyboard target under hover", () => {
  it("continues from the keyboard target after an earlier item is hovered", async () => {
    await openMenu(vi.fn());
    await press("ArrowDown");
    await press("ArrowDown");
    expect(document.activeElement).toBe(item("Three"));

    await act(async () => hover(item("One")));
    await press("ArrowDown");
    expect(document.activeElement).toBe(item("Four"));
  });

  it("activates the keyboard target, not the hovered item, on Enter", async () => {
    const onSelect = vi.fn();
    await openMenu(onSelect);
    await press("ArrowDown");
    await press("ArrowDown");

    await act(async () => hover(item("One")));
    await press("Enter");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("Three");
  });
});
