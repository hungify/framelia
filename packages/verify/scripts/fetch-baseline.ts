import { fetchBaseline } from "../src/baseline/figma-fetch.ts";

const [fileKey, nodeId, outPath, scaleRaw] = process.argv.slice(2);
if (!fileKey || !nodeId || !outPath) {
  console.error("Usage: fetch-baseline <fileKey> <nodeId> <outPath> [scale]");
  process.exit(2);
}
const scale = scaleRaw == null ? 1 : Number(scaleRaw);
if (!Number.isFinite(scale) || scale <= 0) {
  console.error(`Invalid scale ${scaleRaw}`);
  process.exit(2);
}

const result = await fetchBaseline({
  fileKey,
  nodeId,
  outPath,
  scale,
});

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
