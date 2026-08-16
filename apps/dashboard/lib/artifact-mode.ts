export type DashboardArtifactMode = "mock" | "report" | "live" | "archived";

const MODE: Record<DashboardArtifactMode, { label: string; dotClass: string }> = {
  mock: { label: "Mock data", dotClass: "bg-blue" },
  report: { label: "Report", dotClass: "bg-blue" },
  live: { label: "Live", dotClass: "bg-green" },
  archived: { label: "Archived", dotClass: "bg-blue" },
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

export function artifactModeMeta(mode: DashboardArtifactMode) {
  return MODE[mode];
}
