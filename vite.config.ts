import { fileURLToPath, URL } from "node:url";
import { defineConfig, Plugin } from "vite";

// Plugin to wrap content script in IIFE to avoid global scope pollution
function wrapContentScript(): Plugin {
  return {
    name: 'wrap-content-script',
    generateBundle(options, bundle) {
      const contentScript = bundle['content.js'];
      if (contentScript && contentScript.type === 'chunk') {
        contentScript.code = `(function() {\n${contentScript.code}\n})();`;
      }
    },
  };
}

export default defineConfig({
  plugins: [wrapContentScript()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: "src/background/main.ts",
        content: "src/content/main.ts",
        popup: "src/ui/popup.html",
        options: "src/ui/options.html",
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background" || chunkInfo.name === "content") {
            return `[name].js`;
          }
          return `assets/[name].js`;
        },
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
