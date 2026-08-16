import { fetchGold } from "../src/fetch-gold.ts";

const [fileKey, nodeId, outPath, scaleRaw] = process.argv.slice(2);
if (!fileKey || !nodeId || !outPath) {
  console.error("Usage: fetch-gold <fileKey> <nodeId> <outPath> [scale]");
  process.exit(2);
}
const scale = scaleRaw == null ? 1 : Number(scaleRaw);
if (!Number.isFinite(scale) || scale <= 0) {
  console.error(`Invalid scale ${scaleRaw}`);
  process.exit(2);
}

const result = await fetchGold({
  fileKey,
  nodeId,
  outPath,
  scale,
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
