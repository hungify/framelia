import { serve, type ServerType } from "@hono/node-server";

export const MAX_PORT_ATTEMPTS = 20;

export interface ListenWithPortRetryOptions {
  /** The Hono app's `fetch` handler -- passed directly rather than the app
   *  itself, so this module never needs to know about routes. */
  fetch: (request: Request) => Response | Promise<Response>;
  hostname: string;
  startPort: number;
  /** Defaults to `MAX_PORT_ATTEMPTS` when omitted. */
  maxAttempts?: number;
  /** Called once per real EADDRINUSE before retrying the next port -- production
   *  logs it; tests observe it instead of scraping console output. */
  onPortInUse?: (port: number, nextPort: number) => void;
}

/**
 * Binds a real Node HTTP listener, retrying on the next port up whenever
 * the current one is genuinely in use (a real OS-level EADDRINUSE, not
 * something fakeable). Any other bind failure -- or exhausting
 * `maxAttempts` -- rejects immediately.
 */
export async function listenWithPortRetry(
  options: ListenWithPortRetryOptions,
): Promise<ServerType> {
  const { fetch, hostname, startPort, maxAttempts = MAX_PORT_ATTEMPTS, onPortInUse } = options;

  const listen = (port: number): Promise<ServerType> =>
    new Promise<ServerType>((resolve, reject) => {
      const instance = serve({ fetch, hostname, port }, () => resolve(instance));
      instance.once("error", reject);
    });

  let port = startPort;
  for (;;) {
    try {
      // eslint-disable-next-line no-await-in-loop -- must know this port failed before trying the next
      return await listen(port);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EADDRINUSE" ||
        port >= startPort + maxAttempts - 1
      )
        throw error;
      onPortInUse?.(port, port + 1);
      port += 1;
    }
  }
}
