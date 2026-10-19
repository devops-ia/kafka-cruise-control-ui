/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0 }, // no inline assets: CSP forbids inline scripts and styles
  server: { proxy: { "/api": "http://localhost:8080" } },
  test: { environment: "jsdom", globals: true },
});
