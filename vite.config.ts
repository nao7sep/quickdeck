import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    // Bumped from the 1420/1421 Tauri scaffold default so it never collides
    // with a sibling Tauri app's launcher port-kill (dropkick uses 1521/1522).
    port: 1621,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
