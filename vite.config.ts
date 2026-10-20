import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The app's name and version come from the Tauri config, which the bundle and
// installer carry, and reach the pages as __APP_NAME__ and __APP_VERSION__, so
// About never drifts from the release.
const { productName, version } = JSON.parse(
  readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_NAME__: JSON.stringify(productName),
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    host: "127.0.0.1",
    // Bumped from the 1420/1421 Tauri scaffold default so it never collides
    // with a sibling app's fixed development endpoint.
    port: 26267,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  // Two pages: the main window, and the Records window the Rust core opens
  // (src-tauri/src/records_window.rs).
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        records: fileURLToPath(new URL("./records.html", import.meta.url)),
      },
    },
  },
});
