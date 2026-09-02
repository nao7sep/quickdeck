import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Single source of truth for the app version: src-tauri/tauri.conf.json (see
// vite.config.ts, which injects it as __APP_VERSION__ for the built app).
// Mirrored here so a test rendering version-facing UI (the About dialog) sees
// the same global instead of a ReferenceError — vitest never runs through
// vite.config.ts's own `define`.
const { version } = JSON.parse(
  readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

// Tests live in a dedicated tree mirroring src/, kept out of the app's tsc
// build surface (tsconfig.json only includes "src"). jsdom supplies the
// KeyboardEvent and navigator globals the zoom/shortcut tests rely on.
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      // V8's native coverage; `include` spans the frontend source (the Rust
      // backend has its own cargo-llvm-cov pass) so the report flags logic no
      // test reaches, not just a score for what is reached.
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      // Excluded as framework wiring with no decision to cover:
      exclude: [
        "src/main.tsx", // React DOM mount
        "src/vite-env.d.ts",
        "**/*.d.ts",
      ],
    },
  },
});
