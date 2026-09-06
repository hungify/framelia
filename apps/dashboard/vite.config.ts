import ui from "@nuxt/ui/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";
import vueRouter from "vue-router/vite";

const apiOrigin = process.env.FRAMELIA_API_ORIGIN;

function dashboardMockPlugin(): Plugin {
  return {
    name: "framelia-dashboard-mock",
    apply: "serve",
    async configureServer(server) {
      if (apiOrigin) return;
      // Resolve mocks through Vite after its source conditions exist, not during config loading.
      const { dashboardMockArtifacts, dashboardMockRun } =
        await server.ssrLoadModule("/mocks/dashboard.ts");
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://dashboard.test").pathname;
        if (pathname === "/api/run") {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify(dashboardMockRun));
          return;
        }
        if (pathname === "/api/meta") {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ live: false, mock: true }));
          return;
        }
        if (pathname.startsWith("/artifacts/")) {
          const artifact =
            dashboardMockArtifacts[decodeURIComponent(pathname.slice("/artifacts/".length))];
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
  resolve: { conditions: ["framelia-dev"] },
  ssr: {
    noExternal: ["@framelia/contracts"],
    resolve: { conditions: ["framelia-dev"] },
  },
  plugins: [
    dashboardMockPlugin(),
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
    outDir: "../../packages/dashboard-server/dist/dashboard",
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
