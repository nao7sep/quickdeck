import { defineConfig } from "vitest/config";

// Tests live in a dedicated tree mirroring src/, kept out of the app's tsc
// build surface (tsconfig.json only includes "src"). jsdom supplies the
// KeyboardEvent and navigator globals the zoom/shortcut tests rely on.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
