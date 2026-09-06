export const DEFAULT_DASHBOARD_PORT = 6789;

/** Where the dashboard binds when the caller names no host. Loopback-only by default:
 *  exposing a run's screenshots on every interface has to be an explicit `--host`. */
export const DEFAULT_DASHBOARD_HOSTNAME = "localhost";

/** The host that means "every interface", minted by the CLI's `--host` with no value and
 *  recognised by the URL resolver. Shared so the two ends agree on the spelling. */
export const WILDCARD_DASHBOARD_HOSTNAME = "0.0.0.0";
