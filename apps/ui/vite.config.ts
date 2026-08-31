import ui from "@nuxt/ui/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";
import vueRouter from "vue-router/vite";

import { uiMockArtifacts, uiMockRun } from "./mocks/ui.ts";

const apiOrigin = process.env.FRAMELIA_API_ORIGIN;

function uiMockPlugin(): Plugin {
  return {
    name: "framelia-ui-mock",
    apply: "serve",
    configureServer(server) {
      if (apiOrigin) return;
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://ui.test").pathname;
        if (pathname === "/api/run") {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(uiMockRun));
          return;
        }
        if (pathname === "/api/meta") {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ live: false, mock: true }));
          return;
        }
        if (pathname.startsWith("/artifacts/")) {
          const artifact =
            uiMockArtifacts[decodeURIComponent(pathname.slice("/artifacts/".length))];
          if (artifact) {
            response.setHeader("content-type", "image/svg+xml");
            response.end(artifact);
            return;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    uiMockPlugin(),
    vueRouter({
      routesFolder: "pages",
    }),
    vue(),
    ui({
      ui: {
        colors: {
          primary: "cyan",
          success: "green",
          error: "red",
          warning: "amber",
          info: "blue",
          neutral: "slate",
        },
      },
    }),
  ],
  build: {
    outDir: "../../packages/ui-server/dist/ui",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: apiOrigin
    ? {
        proxy: {
          "/api": apiOrigin,
          "/artifacts": apiOrigin,
          "/events": apiOrigin,
        },
      }
    : undefined,
});
