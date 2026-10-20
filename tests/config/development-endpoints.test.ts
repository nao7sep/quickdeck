import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");
const tauri = JSON.parse(read("src-tauri/tauri.conf.json")) as {
  build: { devUrl: string };
  app: { security: { devCsp: string } };
};

// The dev server's address is Tauri's devUrl; every other place that has to
// name it is checked against that one source.
describe("development endpoint", () => {
  const devUrl = new URL(tauri.build.devUrl);

  it("serves the package command, Vite, the dev CSP and both launchers on devUrl", () => {
    expect(read("package.json")).toContain(`--host ${devUrl.hostname} --port ${devUrl.port} --strictPort`);
    expect(read("vite.config.ts")).toContain(`port: ${devUrl.port}`);
    expect(tauri.app.security.devCsp).toContain(devUrl.origin);
    for (const path of ["scripts/run-dev.command", "scripts/run-dev.ps1"]) {
      expect(read(path)).toContain(devUrl.port);
    }
  });
});
