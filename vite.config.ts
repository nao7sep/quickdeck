import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single source of truth for the app version: the Tauri config (the version the
// bundle/installer actually carries, and the one the release workflow names the
// installer file from). Injected as __APP_VERSION__ so the About dialog never
// drifts from the release. package.json, package-lock.json, and Cargo.toml must
// each carry a literal version for their own tooling; tests/version.test.ts
// checks that they stay equal to this one, and the release workflow runs the test
// suite, so a drift fails the release before any installer is built.
const { version } = JSON.parse(
  readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    host: "127.0.0.1",
    // Bumped from the 1420/1421 Tauri scaffold default so it never collides
    // with a sibling Tauri app's launcher port-kill (dropkick uses 1521/1522).
    port: 1621,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
