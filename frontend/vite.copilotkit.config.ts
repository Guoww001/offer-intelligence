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
    emptyOutDir: false,
    lib: {
      entry: resolve(frontendRoot, "src/copilotkit-entry.ts"),
      name: "OfferIntelligenceAgentRuntime",
      formats: ["iife"],
      fileName: () => "oi-agent-runtime.js"
    },
    rollupOptions: {
      // The headless Agent does not render CopilotKit's Markdown/KaTeX UI.
      // Leave its optional, caught dynamic stylesheet import external so an
      // unused 1.4 MB font payload is not emitted with the Agent bundle.
      external: (id) => id === "vue" || id === "katex/dist/katex.min.css",
      output: {
        globals: { vue: "OI_VUE_RUNTIME" }
      }
    }
  }
});
