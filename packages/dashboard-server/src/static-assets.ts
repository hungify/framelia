import * as fs from "node:fs/promises";
import * as path from "node:path";

import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import { getMimeType } from "hono/utils/mime";

export async function assertClientBuildExists(clientRoot: string): Promise<void> {
  await fs.access(path.join(clientRoot, "index.html")).catch(() => {
    throw new Error(
      `Dashboard build missing: ${clientRoot}. Run pnpm --filter @framelia/dashboard-server build.`,
    );
  });
}

/**
 * Mounts the bundled Vue dashboard client (built by `apps/dashboard`'s vite
 * build into `clientRoot`) using `@hono/node-server`'s `serveStatic`, which
 * handles path-traversal rejection and MIME typing. Two middlewares: serve a
 * real file when the request path matches one; otherwise fall through to
 * `index.html` so client-side routing keeps working on a hard refresh or a
 * deep link.
 */
export function mountClientRoutes(app: Hono, clientRoot: string): void {
  app.use("*", serveStatic({ root: clientRoot }));
  app.get("*", serveStatic({ root: clientRoot, path: "index.html" }));
}

/**
 * Sends one artifact file, straight off disk -- no directory listing, no
 * traversal (the caller only ever passes a path that came out of the
 * allowlist `Map` `mountArtifactRoute` resolves against).
 *
 * Accepted exception: `getMimeType` returns bare `"application/json"` for
 * `.json` files (no `; charset=utf-8` suffix -- Hono's MIME table omits it
 * for that one extension). Both real consumers (the dashboard client's
 * `fetch(...).json()` and Playwright's own artifact reads) parse the body
 * via `.json()`/`JSON.parse`, which is charset-agnostic for UTF-8 --
 * see `tests/static-assets.test.ts`.
 */
async function sendArtifactFile(filePath: string): Promise<Response> {
  try {
    const data = await fs.readFile(filePath);
    return new Response(data, {
      headers: {
        "content-type": getMimeType(filePath) ?? "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return new Response("Not found", { status: 404 });
    throw error;
  }
}

/**
 * Mounts `GET /artifacts/*`, resolving the requested virtual path through
 * `filesSource()` -- an application-defined allowlist `Map` built from
 * scattered real output directories -- rather than a single static root,
 * which is why this route stays hand-rolled instead of using `serveStatic`
 * (whose config takes exactly one synchronous root).
 */
export function mountArtifactRoute(
  app: Hono,
  filesSource: () => Map<string, string> | Promise<Map<string, string>>,
): void {
  app.get("/artifacts/*", async (context) => {
    const requested = context.req.path.slice("/artifacts/".length);
    const files = await filesSource();
    const filePath = files.get(requested) ?? files.get(decodeURIComponent(requested));
    return filePath
      ? sendArtifactFile(filePath)
      : context.json({ error: "Artifact not found" }, 404);
  });
}
