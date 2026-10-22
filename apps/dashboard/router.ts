import { createRouter, createWebHashHistory, createWebHistory } from "vue-router";
import { handleHotUpdate, routes } from "vue-router/auto-routes";

import { dashboardHost } from "./lib/dashboard-host";

// Served: real paths (`/contracts/<id>`), with the server-injected `<base href="/">` as
// the history base. Static report: hash routes, so the report works from any directory
// without a server rewriting unknown paths to index.html.
export const router = createRouter({
  history: dashboardHost === "server" ? createWebHistory() : createWebHashHistory(),
  routes,
});

if (import.meta.hot) handleHotUpdate(router);
