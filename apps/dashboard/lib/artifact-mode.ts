export type DashboardArtifactMode = "mock" | "report" | "live" | "archived";
export type DashboardConnectionState = "connecting" | "open" | "reconnecting";

const MODE: Record<DashboardArtifactMode, { label: string; dotClass: string }> = {
  mock: { label: "Mock data", dotClass: "bg-blue" },
  report: { label: "Report", dotClass: "bg-blue" },
  live: { label: "Live", dotClass: "bg-green" },
  archived: { label: "Archived", dotClass: "bg-blue" },
};

const LIVE_CONNECTION: Record<
  Exclude<DashboardConnectionState, "open">,
  { label: string; dotClass: string }
> = {
  connecting: { label: "Connecting…", dotClass: "bg-amber" },
  reconnecting: { label: "Reconnecting…", dotClass: "bg-amber" },
};

export function resolveArtifactMode(input: {
  mockMode: boolean;
  staticMode: boolean;
  liveMode: boolean;
}): DashboardArtifactMode {
  if (input.mockMode) return "mock";
  if (input.staticMode) return "report";
  if (input.liveMode) return "live";
  return "archived";
}

/**
 * Header badge for the mode. A live dashboard only says "Live" while its event stream is
 * actually open; otherwise it says it is (re)connecting, so a dropped connection is never
 * invisible.
 */
export function artifactModeMeta(
  mode: DashboardArtifactMode,
  connection?: DashboardConnectionState,
) {
  if (mode === "live" && connection && connection !== "open") return LIVE_CONNECTION[connection];
  return MODE[mode];
}
