import { resolve } from "node:path";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const frontendRoot = process.cwd();

export default defineConfig({
  plugins: [vue()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  build: {
    outDir: resolve(frontendRoot, "../public/assets/modern"),
    emptyOutDir: true,
    lib: {
      entry: resolve(frontendRoot, "src/entry.ts"),
      name: "OfferIntelligenceModern",
      formats: ["iife"],
      fileName: () => "oi-modern.js",
      cssFileName: "oi-modern"
    }
  }
});
