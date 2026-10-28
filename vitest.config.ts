import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// The same app name and version globals vite.config.ts defines, read from the
// same Tauri config; Vitest does not run through vite.config.ts's `define`.
const { productName, version } = JSON.parse(
  readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

// Tests live in a dedicated tree mirroring src/, kept out of the app's tsc
// build surface (tsconfig.json only includes "src"). jsdom supplies the
// KeyboardEvent and navigator globals the zoom/shortcut tests rely on.
export default defineConfig({
  define: {
    __APP_NAME__: JSON.stringify(productName),
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    // Tests carry no timeouts: each awaits the promise or event it needs, and
    // product deadlines run on fake timers.
    testTimeout: 0,
    hookTimeout: 0,
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup/rendered-keys.ts"],
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
