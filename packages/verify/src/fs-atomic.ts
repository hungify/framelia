import * as fs from "node:fs";
import * as path from "node:path";

/** Write `content` to `filePath` via temp-file-then-rename so readers never see a partial write. */
export function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}
