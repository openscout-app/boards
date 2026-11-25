import react from "@vitejs/plugin-react-swc";
import { defineScoutThinViteConfig, scoutAppResolveAliases } from "scout-app/vite";
import { defineConfig, type Plugin } from "vite";

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
          html = html.replace(
            new RegExp(`<script[^>]*src="[^"]*${escape(file.fileName)}"[^>]*></script>`),
            () => `<script type="module">${code}</script>`,
          );
          delete bundle[name];
        } else if (file.fileName.endsWith(".css")) {
          html = html.replace(
            new RegExp(`<link[^>]*href="[^"]*${escape(file.fileName)}"[^>]*>`),
            () => `<style>${String(file.source)}</style>`,
          );
          delete bundle[name];
        }
      }
      page.source = html;
    },
  };
}

export default defineConfig(({ mode }) => {
  if (mode === "view") {
    return {
      clearScreen: false,
      plugins: [react() as unknown as Plugin, oneFile()],
      publicDir: false,
      resolve: {
        alias: scoutAppResolveAliases(),
      },
      build: {
        outDir: "dist/view",
        emptyOutDir: true,
        cssCodeSplit: false,
        modulePreload: false,
        assetsInlineLimit: 100_000_000,
        rollupOptions: {
          input: "view.html",
          output: { inlineDynamicImports: true },
        },
      },
    };
  }

  return defineScoutThinViteConfig({
    product: "Boards",
    variant: "board",
    rail: "wide",
    port: 4802,
    serverEntry: "src/server.ts",
  });
});
