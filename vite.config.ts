import { defineConfig } from "vitest/config";

// Tauri expects a fixed dev port and does its own screen clearing.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "localhost",
    // Cargo builds into ./target (which Windows locks while compiling) and Rust sources are
    // not part of the web bundle, so Vite must not watch them.
    watch: { ignored: ["**/target/**", "**/src-tauri/**", "**/crates/**"] },
  },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
