/**
 * Who is serving this page.
 *
 * - `server`: `@framelia/dashboard-server` (or the Vite dev server). It injects
 *   `<base href="/">` plus the marker meta below into index.html, answers `/api/*`,
 *   `/artifacts/*`, `/events`, and falls back to index.html for `/contracts/<id>`, so
 *   path-based routing and absolute API URLs work.
 * - `static`: a relocatable `framelia report` directory, opened from any sub-path (or
 *   file://). Nothing rewrites unknown paths back to index.html there, so the router uses
 *   the URL hash and data URLs resolve against the page's own location.
 */
export type DashboardHost = "server" | "static";

/**
 * Must match `DASHBOARD_HOST_META_NAME` in
 * `packages/dashboard-server/src/static-assets.ts`, which injects it.
 */
export const DASHBOARD_HOST_META_NAME = "framelia-dashboard-host";

export function detectDashboardHost(
  doc: Pick<Document, "querySelector"> | undefined = globalThis.document,
  dev: boolean = import.meta.env?.DEV ?? false,
): DashboardHost {
  if (dev || !doc) return "server";
  return doc.querySelector(`meta[name="${DASHBOARD_HOST_META_NAME}"][content="server"]`)
    ? "server"
    : "static";
}

/**
 * The directory index.html was loaded from, captured once. Static-report data URLs
 * resolve against this rather than the current location, so they keep pointing at the
 * report's `data/` folder whatever route is showing.
 */
export function captureReportBase(
  baseURI: string | undefined = globalThis.document?.baseURI,
): string | undefined {
  return baseURI ? new URL(".", baseURI).href : undefined;
}

export const dashboardHost: DashboardHost = detectDashboardHost();
export const reportBase: string | undefined = captureReportBase();
