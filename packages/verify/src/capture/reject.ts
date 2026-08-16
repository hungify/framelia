import type { RejectResult } from "../types.ts";
import { SCHEMA_VERSION } from "../types.ts";

export function reject(error: RejectResult["error"], message: string): RejectResult {
  return { schemaVersion: SCHEMA_VERSION, ok: false, error, message };
}
