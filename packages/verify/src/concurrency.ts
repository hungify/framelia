import pMap from "p-map";

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const normalizedLimit =
    limit === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : Math.floor(limit);
  return pMap(items, (item, index) => worker(item, index), {
    concurrency: Number.isFinite(normalizedLimit) ? Math.max(1, normalizedLimit) : 1,
  });
}
