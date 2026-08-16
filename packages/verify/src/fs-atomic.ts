import * as fs from "node:fs";
import * as path from "node:path";

import { nanoid } from "nanoid";

/** Write `content` to `filePath` via temp-file-then-rename so readers never see a partial write. */
export function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // pid alone collides when two concurrent writes in one process target the same filePath;
  // a random suffix per call keeps every temp file unique regardless of timing.
  const temporary = `${filePath}.${process.pid}.${nanoid()}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}
