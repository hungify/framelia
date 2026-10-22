import { slugParts } from "./lib/slug.ts";

/**
 * Entry point: the only file other packages may import (listed in package.json `exports`).
 * It delegates to private code under lib/, so the package stays deep, not a pass-through.
 */
export function toContractId(...names: string[]): string {
  return names.flatMap(slugParts).join(".");
}
