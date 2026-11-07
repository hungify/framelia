import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";

import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Hono } from "hono";
import { getMimeType } from "hono/utils/mime";

/**
 * Marks an index.html as served by this server (rather than opened as a static
 * `framelia report`). `apps/dashboard/lib/dashboard-host.ts` reads the same meta name
 * to choose path-based routing; without it the client falls back to hash routing so a
 * relocated static report keeps working. Keep the two spellings in sync.
 */
export const DASHBOARD_HOST_META_NAME = "framelia-dashboard-host";

/**
 * Prefixes the client never navigates to: an unknown path under one of these is a real
 * 404 (a missing bundle chunk, an unknown API route), never the SPA shell. Serving
 * index.html for `/assets/missing.js` is what made a stale or mis-based chunk load
 * "succeed" with HTML and leave a blank page.
 */
const NON_CLIENT_ROUTE_PREFIXES = ["/assets/", "/api/", "/artifacts/", "/events"];

/** Client-side route prefix whose ids legitimately contain dots (`checkout.desktop`). */
const CLIENT_ROUTE_PREFIX = "/contracts/";

export async function assertClientBuildExists(clientRoot: string): Promise<void> {
  await fs.access(path.join(clientRoot, "index.html")).catch(() => {
    throw new Error(
      `Dashboard build missing: ${clientRoot}. Run pnpm --filter @framelia/dashboard-server build.`,
    );
  });
}

function setClientCacheControl(filePath: string, context: Context): void {
  context.res.headers.set(
    "Cache-Control",
    filePath.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable",
  );
}

/**
 * Whether an unmatched GET should get the SPA shell. Anything that looks like a file
 * request (a last segment with an extension) 404s instead, except under `/contracts/`,
 * whose contract ids are dotted.
 */
export function isClientRoute(pathname: string): boolean {
  if (NON_CLIENT_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  if (pathname.startsWith(CLIENT_ROUTE_PREFIX)) return true;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !lastSegment.includes(".");
}

/**
 * The bundle is built with a relative base (`./`) so a static report works from any
 * directory. Served from this origin, though, a deep link such as `/contracts/a.b` would
 * resolve `./assets/x.js` to `/contracts/assets/x.js`; the injected `<base href="/">`
 * pins every relative URL to the server root, and the meta tag tells the client it may
 * use path-based routing.
 */
export function injectServerHead(html: string): string {
  const head = `<base href="/" /><meta name="${DASHBOARD_HOST_META_NAME}" content="server" />`;
  const match = /<head(?:\s[^>]*)?>/i.exec(html);
  if (!match) return `${head}${html}`;
  const end = match.index + match[0].length;
  return `${html.slice(0, end)}${head}${html.slice(end)}`;
}

async function sendClientShell(context: Context, clientRoot: string): Promise<Response> {
  const html = await fs.readFile(path.join(clientRoot, "index.html"), "utf8");
  return context.html(injectServerHead(html), 200, { "cache-control": "no-store" });
}

/**
 * Mounts the bundled Vue dashboard client (built by `apps/dashboard`'s vite build into
 * `clientRoot`) using `@hono/node-server`'s `serveStatic`, which handles path-traversal
 * rejection and MIME typing. The shell (`/`, `/index.html`, and any client route) is
 * served with `injectServerHead`; a real file is served as-is; any other unmatched path
 * is a 404 rather than the shell (see `isClientRoute`).
 */
export function mountClientRoutes(app: Hono, clientRoot: string): void {
  const onFound = setClientCacheControl;
  const shell = (context: Context) => sendClientShell(context, clientRoot);
  app.get("/", shell);
  app.get("/index.html", shell);
  app.use("*", serveStatic({ root: clientRoot, onFound }));
  app.get("*", (context) =>
    isClientRoute(context.req.path) ? shell(context) : context.text("Not found", 404),
  );
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((candidate) => candidate.trim().replace(/^W\//, ""))
    .some((candidate) => candidate === "*" || candidate === etag);
}

/**
 * Sends one artifact file, streamed off disk -- no directory listing, no traversal (the
 * caller only ever passes a path that came out of the allowlist `Map`
 * `mountArtifactRoute` resolves against).
 *
 * Artifact names are not unique per run (a retry or re-run rewrites `actual.png` in
 * place), so responses are `no-cache` with a validator: the browser revalidates every
 * time and gets a cheap 304 while the file is unchanged. The ETag is derived from the
 * opened file's identity, size, and nanosecond mtime, so a rewrite changes it.
 *
 * Accepted exception: `getMimeType` returns bare `"application/json"` for `.json` files
 * (no `; charset=utf-8` suffix -- Hono's MIME table omits it for that one extension).
 * Both real consumers (the dashboard client's `fetch(...).json()` and Playwright's own
 * artifact reads) parse the body via `.json()`/`JSON.parse`, which is charset-agnostic
 * for UTF-8 -- see `tests/static-assets.test.ts`.
 */
async function sendArtifactFile(filePath: string, ifNoneMatch: string | undefined) {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, "r");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return new Response("Not found", { status: 404 });
    throw error;
  }
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) {
      await handle.close();
      return new Response("Not found", { status: 404 });
    }
    const etag = `"${stat.ino.toString(16)}-${stat.size.toString(16)}-${stat.mtimeNs.toString(16)}"`;
    const validators = { etag, "cache-control": "no-cache" };
    if (etagMatches(ifNoneMatch, etag)) {
      await handle.close();
      return new Response(null, { status: 304, headers: validators });
    }
    const body = Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        ...validators,
        "content-type": getMimeType(filePath) ?? "application/octet-stream",
        "content-length": stat.size.toString(),
      },
    });
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

function decodeArtifactPath(requested: string): string | undefined {
  try {
    return decodeURIComponent(requested);
  } catch {
    // A malformed escape (`%zz`) names no allowlisted file; 404 below, not a 500.
    return undefined;
  }
}

/**
 * Mounts `GET /artifacts/*`, resolving the requested virtual path through `filesSource()`
 * -- an application-defined allowlist `Map` built from scattered real output directories
 * -- rather than a single static root, which is why this route stays hand-rolled instead
 * of using `serveStatic` (whose config takes exactly one synchronous root).
 */
export function mountArtifactRoute(
  app: Hono,
  filesSource: () => Map<string, string> | Promise<Map<string, string>>,
): void {
  app.get("/artifacts/*", async (context) => {
    const requested = context.req.path.slice("/artifacts/".length);
    const files = await filesSource();
    const decoded = decodeArtifactPath(requested);
    const filePath =
      files.get(requested) ?? (decoded === undefined ? undefined : files.get(decoded));
    return filePath
      ? sendArtifactFile(filePath, context.req.header("if-none-match"))
      : context.json({ error: "Artifact not found" }, 404);
  });
}
