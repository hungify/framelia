export type UIArtifactMode = "mock" | "report" | "live" | "archived";

const MODE: Record<UIArtifactMode, { label: string; dotClass: string }> = {
  mock: { label: "Mock data", dotClass: "bg-blue" },
  report: { label: "Report", dotClass: "bg-blue" },
  live: { label: "Live", dotClass: "bg-green" },
  archived: { label: "Archived", dotClass: "bg-blue" },
};

export function resolveArtifactMode(input: {
  mockMode: boolean;
  staticMode: boolean;
  liveMode: boolean;
}): UIArtifactMode {
  if (input.mockMode) return "mock";
  if (input.staticMode) return "report";
  if (input.liveMode) return "live";
  return "archived";
}

export function artifactModeMeta(mode: UIArtifactMode) {
  return MODE[mode];
}
