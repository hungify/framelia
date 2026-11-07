import { EXIT_USAGE_ERROR } from "../exit.ts";
import type { PlaywrightCancellation } from "./playwright-transport.ts";

/** How long a SIGTERM'd Playwright child gets to stop its web server before SIGKILL. */
export const PLAYWRIGHT_TERMINATE_GRACE_MS = 10_000;

export interface InterruptOptions {
  readonly cancellation: PlaywrightCancellation;
  readonly platform: NodeJS.Platform;
  /** Ends this process when there is no child left to stop. */
  readonly exit: (code: number) => void;
  readonly graceMs?: number;
}

/**
 * Escalating Ctrl+C for a command that drives a Playwright child.
 *
 * 1. The first interrupt requests cancellation and forwards SIGINT, so Playwright shuts down
 *    gracefully — including the `webServer` it spawned in its own process group.
 * 2. The second sends SIGTERM (still graceful in Playwright) and only SIGKILLs the child if it
 *    has not exited after the grace period. With no child running (planning or finalizing),
 *    the second interrupt exits immediately instead.
 * 3. A third interrupt SIGKILLs at once.
 *
 * Windows has no POSIX signal delivery: `kill()` always terminates forcefully, and a console
 * Ctrl+C already reaches every process attached to that console, the child included. There the
 * first interrupt therefore only requests cancellation and later ones terminate the child.
 */
export function createInterruptHandler(options: InterruptOptions): () => void {
  const { cancellation } = options;
  const posix = options.platform !== "win32";
  let interrupts = 0;
  return () => {
    interrupts += 1;
    const child = cancellation.child;
    if (interrupts === 1) {
      cancellation.requested = true;
      if (child) {
        cancellation.forwarded = true;
        if (posix) child.kill("SIGINT");
      }
      return;
    }
    if (!child) {
      options.exit(EXIT_USAGE_ERROR);
      return;
    }
    if (interrupts === 2 && posix) {
      child.kill("SIGTERM");
      const timer = setTimeout(
        () => child.kill("SIGKILL"),
        options.graceMs ?? PLAYWRIGHT_TERMINATE_GRACE_MS,
      );
      timer.unref();
      child.once("exit", () => clearTimeout(timer));
      return;
    }
    child.kill("SIGKILL");
  };
}
