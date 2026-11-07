import type { DashboardEvent, DashboardRun } from "@framelia/contracts";

/** Where the dashboard server reads the run it serves, and its live updates. */
export interface DashboardSource {
  snapshot: () => DashboardRun | Promise<DashboardRun>;
  files: () => Map<string, string> | Promise<Map<string, string>>;
  subscribe?: (listener: (event: DashboardEvent) => void) => () => void;
}
