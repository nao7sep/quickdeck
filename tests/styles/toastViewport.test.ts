import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const compact = css.replace(/\s+/g, "");

describe("toast viewport reachability", () => {
  it("bounds the fixed stack to the usable viewport and scrolls locally", () => {
    const rule = compact.match(/\.toastViewport\{[^}]*\}/)?.[0] ?? "";

    expect(rule).toContain(
      "max-height:calc(100vh-var(--status-bar-height)-32px)",
    );
    expect(rule).toContain("overflow-y:auto");
    expect(rule).toContain("overscroll-behavior:contain");
  });

  it("keeps a one-line message and its close control in the same line box", () => {
    const toastRule = compact.match(/\.toast\{[^}]*\}/)?.[0] ?? "";
    const messageRule = compact.match(/\.toast>span\{[^}]*\}/)?.[0] ?? "";
    const closeRule = compact.match(/\.toastClose\{[^}]*\}/)?.[0] ?? "";
    const closeIconRule = compact.match(/\.toastClosesvg\{[^}]*\}/)?.[0] ?? "";

    expect(toastRule).toContain("align-items:flex-start");
    expect(toastRule).toContain("line-height:20px");
    expect(toastRule).toContain("padding:4px8px4px12px");
    expect(messageRule).toContain("padding-block:4px");
    expect(closeRule).toContain("width:28px");
    expect(closeRule).toContain("height:28px");
    expect(closeIconRule).toContain("width:20px");
    expect(closeIconRule).toContain("height:20px");
  });
});
