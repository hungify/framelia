// Private implementation: reachable from this package (tests included), never from another one.
export function slugParts(name: string): string[] {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? [slug] : [];
}
