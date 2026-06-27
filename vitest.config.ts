import { defineConfig } from "vitest/config";

// Tests live in a dedicated tree mirroring src/, kept out of the app's tsc
// build surface (tsconfig.json only includes "src"). jsdom supplies the
// KeyboardEvent and navigator globals the zoom/shortcut tests rely on.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
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
