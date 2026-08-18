import { createRouter } from "@tanstack/react-router";

import { DefaultCatchBoundary } from "#/components/default-catch-boundary.tsx";
import { DefaultNotFound } from "#/components/default-not-found.tsx";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: DefaultNotFound,
    scrollRestoration: true,
    defaultStructuralSharing: true,
  });

  return router;
}
