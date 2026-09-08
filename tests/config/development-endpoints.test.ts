import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");
const tauri = JSON.parse(read("src-tauri/tauri.conf.json")) as {
  build: { devUrl: string };
  app: { security: { devCsp: string } };
};

describe("development endpoint", () => {
  it("keeps the package command, Vite, Tauri, CSP, and both launchers on the app-owned port", () => {
    expect(read("package.json")).toContain("--port 26267 --strictPort");
    expect(read("vite.config.ts")).toContain("port: 26267");
    expect(tauri.build.devUrl).toBe("http://127.0.0.1:26267");
    expect(tauri.app.security.devCsp).toContain("http://127.0.0.1:26267");
    for (const path of ["scripts/run-dev.command", "scripts/run-dev.ps1"]) {
      expect(read(path)).toContain("26267");
      expect(read(path)).not.toMatch(/stop[_-]port|Stop-Port/);
    }
  });
});
