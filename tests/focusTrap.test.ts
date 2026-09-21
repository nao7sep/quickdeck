import { beforeEach, describe, expect, it } from "vitest";
import { getFocusableElements, resolveInitialFocus, resolveTrapTarget } from "../src/focusTrap";

function buildSurface(html: string): HTMLDivElement {
  const surface = document.createElement("div");
  surface.tabIndex = -1;
  surface.innerHTML = html;
  document.body.appendChild(surface);
  return surface;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("getFocusableElements", () => {
  it("collects enabled controls and skips disabled ones and tabindex=-1", () => {
    const surface = buildSurface(`
      <button data-modal-close>x</button>
      <input />
      <button disabled>nope</button>
      <a href="#">link</a>
      <div tabindex="-1">skip</div>
      <div tabindex="0">ok</div>
    `);

    // close button, input, anchor, tabindex=0 div — not the disabled button or
    // the tabindex=-1 div.
    expect(getFocusableElements(surface).length).toBe(4);
  });

  it("keeps only the checked radio of a named group as its tab stop", () => {
    const surface = buildSurface(`
      <input type="radio" name="theme" value="system" />
      <input type="radio" name="theme" value="light" />
      <input type="radio" name="theme" value="dark" checked />
      <input type="checkbox" />
    `);

    expect(getFocusableElements(surface).map((element) => (element as HTMLInputElement).value)).toEqual([
      "dark",
      "on",
    ]);
  });

  it("keeps the first radio of a group with nothing checked", () => {
    const surface = buildSurface(`
      <input type="radio" name="theme" value="system" />
      <input type="radio" name="theme" value="light" />
    `);

    expect(getFocusableElements(surface)).toEqual([surface.querySelector('[value="system"]')]);
  });
});

describe("resolveInitialFocus", () => {
  it("lands on the checked radio when a radio group leads the form", () => {
    const surface = buildSurface(`
      <button data-modal-close>x</button>
      <input type="radio" name="theme" value="system" />
      <input type="radio" name="theme" value="dark" checked />
    `);
    expect(resolveInitialFocus(surface)).toBe(surface.querySelector('[value="dark"]'));
  });

  it("prefers the first focusable that is not the close button", () => {
    const surface = buildSurface(`<button data-modal-close>x</button><input id="first" /><button>save</button>`);
    expect(resolveInitialFocus(surface)).toBe(surface.querySelector("#first"));
  });

  it("never opens on the scrolling body, which reaches the modal's own edges", () => {
    // About, Shortcuts and Error bodies are passive scroll regions and the first
    // focusable after the close button. Opening on them, after the key that opened
    // the modal, lit their ring as a second border inside the modal.
    const surface = buildSurface(`
      <button data-modal-close>x</button>
      <div data-passive-scroll-region tabindex="0"><a href="#" id="link">GitHub</a></div>
    `);
    expect(resolveInitialFocus(surface)).toBe(surface.querySelector("#link"));

    const readOnly = buildSurface(`
      <button data-modal-close>x</button>
      <div data-passive-scroll-region tabindex="0"><p>read only</p></div>
    `);
    expect(resolveInitialFocus(readOnly)).toBe(readOnly);
  });

  it("falls back to the surface when only the close button is focusable", () => {
    const surface = buildSurface(`<button data-modal-close>x</button>`);
    expect(resolveInitialFocus(surface)).toBe(surface);
  });

  it("falls back to the surface when nothing is focusable", () => {
    const surface = buildSurface(`<p>read only</p>`);
    expect(resolveInitialFocus(surface)).toBe(surface);
  });
});

describe("resolveTrapTarget", () => {
  it("wraps from the last element to the first on Tab", () => {
    const surface = buildSurface(`<button id="a">a</button><button id="b">b</button>`);
    const last = surface.querySelector("#b") as HTMLElement;
    expect(resolveTrapTarget(surface, last, false)).toBe(surface.querySelector("#a"));
  });

  it("wraps from the first element to the last on Shift+Tab", () => {
    const surface = buildSurface(`<button id="a">a</button><button id="b">b</button>`);
    const first = surface.querySelector("#a") as HTMLElement;
    expect(resolveTrapTarget(surface, first, true)).toBe(surface.querySelector("#b"));
  });

  it("returns null in the interior so the browser performs the move", () => {
    const surface = buildSurface(`<button id="a">a</button><input id="m" /><button id="b">b</button>`);
    const middle = surface.querySelector("#m");
    expect(resolveTrapTarget(surface, middle, false)).toBeNull();
    expect(resolveTrapTarget(surface, middle, true)).toBeNull();
  });

  it("pulls focus back to an edge when it has escaped the surface", () => {
    const surface = buildSurface(`<button id="a">a</button><button id="b">b</button>`);
    const outside = document.createElement("button");
    document.body.appendChild(outside);

    expect(resolveTrapTarget(surface, outside, false)).toBe(surface.querySelector("#a"));
    expect(resolveTrapTarget(surface, outside, true)).toBe(surface.querySelector("#b"));
  });

  it("treats focus on the surface itself as escaped and moves to an edge", () => {
    const surface = buildSurface(`<button id="a">a</button><button id="b">b</button>`);
    expect(resolveTrapTarget(surface, surface, false)).toBe(surface.querySelector("#a"));
    expect(resolveTrapTarget(surface, surface, true)).toBe(surface.querySelector("#b"));
  });

  it("keeps focus on the surface when there is nothing focusable inside", () => {
    const surface = buildSurface(`<p>nothing</p>`);
    expect(resolveTrapTarget(surface, surface, false)).toBe(surface);
  });

  it("wraps correctly when a single focusable control is both first and last", () => {
    const surface = buildSurface(`<button id="only">only</button>`);
    const only = surface.querySelector("#only") as HTMLElement;
    expect(resolveTrapTarget(surface, only, false)).toBe(only);
    expect(resolveTrapTarget(surface, only, true)).toBe(only);
  });
});
