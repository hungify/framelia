import * as crypto from "node:crypto";
import * as fs from "node:fs";

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** File content hash formatted as `sha256:<hex>`; used by evidence artifacts. */
export function fileHash(filePath: string): string {
  return `sha256:${sha256Hex(fs.readFileSync(filePath))}`;
}
