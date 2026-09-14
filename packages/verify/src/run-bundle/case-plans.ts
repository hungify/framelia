import * as fs from "node:fs";
import * as path from "node:path";

import { casePlanSchema, type CasePlan } from "@framelia/contracts/workflow";

import { AppError } from "../types.ts";
import { casePlansDir } from "./layout.ts";

/** Reads every full `CasePlan` record frozen under a run's `plan/case-plans/` directory,
 *  keyed by `caseId`. Its own module (rather than living in `read.ts` or `run.ts`) so
 *  both can import it without a circular dependency -- `read.ts` already imports from
 *  `run.ts`, and `run.ts`'s finalization needs to read case plans too. */
export function readCasePlans(root: string, runId: string): Map<string, CasePlan> {
  const dir = casePlansDir(root, runId);
  const casePlans = new Map<string, CasePlan>();
  if (!fs.existsSync(dir)) return casePlans;
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith(".json")) continue;
    const filePath = path.join(dir, entry);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new AppError(
        "RUN_BUNDLE_INVALID",
        `Case plan at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
    const casePlan = casePlanSchema.parse(parsed);
    casePlans.set(casePlan.caseId, casePlan);
  }
  return casePlans;
}
