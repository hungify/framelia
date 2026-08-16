import pMap from "p-map";

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 1;
  return pMap(items, (item, index) => worker(item, index), {
    concurrency: Math.max(1, normalizedLimit),
  });
}
