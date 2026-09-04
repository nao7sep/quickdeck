import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The production Content-Security-Policy is declared as text in
// src-tauri/tauri.conf.json (app.security.csp) and is the only thing standing
// between the WebView and inline/eval'd script. It does not show up in any
// typecheck or runtime assertion, so a careless edit, merge, or tooling change
// could silently drop or weaken it and nothing would notice until a release.
// This file is that guard. It mirrors the config-reading approach used by the
// version and window-chrome guards: `npm test` runs vitest from the repo root,
// so cwd is the project root and the manifest is read straight off disk.
//
// `app.security.devCsp` is intentionally not checked: it is the dev-server
// policy (it deliberately allows 'unsafe-inline'/'unsafe-eval' and the local
// Vite origin) and never ships in a built artifact.

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function directives(policy: string): Map<string, Set<string>> {
  return new Map(policy.split(";").map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name, new Set(values)];
  }));
}

describe("production Content-Security-Policy guard", () => {
  const security = JSON.parse(read("src-tauri/tauri.conf.json")).app.security;
  const csp: unknown = security?.csp;

  it("declares a present, non-empty production CSP", () => {
    expect(typeof csp).toBe("string");
    expect((csp as string).trim().length).toBeGreaterThan(0);
  });

  it("script-src is strict: no 'unsafe-inline' and no 'unsafe-eval'", () => {
    // Isolate the script-src directive so a relaxation there is caught even if
    // an unrelated directive ever legitimately needed one of these tokens.
    const scriptSrc = /(?:^|;)\s*script-src\b([^;]*)/.exec(csp as string)?.[1];
    expect(scriptSrc).toBeDefined();
    expect(scriptSrc).not.toMatch(/'unsafe-inline'/);
    expect(scriptSrc).not.toMatch(/'unsafe-eval'/);
  });

  it("the policy as a whole permits no 'unsafe-eval' anywhere", () => {
    expect(csp as string).not.toMatch(/'unsafe-eval'/);
  });

  it("keeps the required production restrictions and app connections", () => {
    const policy = directives(csp as string);

    expect(policy.get("default-src")).toEqual(new Set(["'self'"]));
    expect(policy.get("script-src")).toEqual(new Set(["'self'"]));
    expect(policy.get("object-src")).toEqual(new Set(["'none'"]));
    expect(policy.get("base-uri")).toEqual(new Set(["'self'"]));
    expect(policy.get("frame-ancestors")).toEqual(new Set(["'none'"]));
    expect(policy.get("connect-src")).toEqual(
      new Set(["'self'", "ipc:", "http://ipc.localhost"]),
    );
  });
});
