import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error plain JS server module
import { handle } from "./server/api.mjs";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The MCP App view is one HTML file: hosts frame it from a resource, with nothing else to fetch. */
function oneFile(): Plugin {
  return {
    name: "scout-boards-one-file",
    enforce: "post",
    generateBundle(_, bundle) {
      const page = Object.values(bundle).find((f) => f.type === "asset" && f.fileName.endsWith(".html"));
      if (!page || page.type !== "asset") return;
      let html = String(page.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk") {
          const code = file.code.replace(/<\/script/gi, "<\\/script");
          html = html.replace(new RegExp(`<script[^>]*src="[^"]*${escape(file.fileName)}"[^>]*></script>`), () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.fileName.endsWith(".css")) {
          html = html.replace(new RegExp(`<link[^>]*href="[^"]*${escape(file.fileName)}"[^>]*>`), () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        }
      }
      page.source = html;
    },
  };
}

export default defineConfig(({ mode }) => mode === "view"
  ? {
      plugins: [react(), oneFile()],
      publicDir: false,
      build: {
        outDir: "dist/view",
        emptyOutDir: true,
        cssCodeSplit: false,
        modulePreload: false,
        assetsInlineLimit: 100_000_000,
        rollupOptions: { input: "view.html", output: { inlineDynamicImports: true } },
      },
    }
  : {
      plugins: [
        react(),
        { name: "scout-boards-api", configureServer(server) { server.middlewares.use(async (req, res, next) => { if (!(await handle(req, res))) next(); }); } },
      ],
      server: { port: 4802, strictPort: true, host: "127.0.0.1" },
    });
