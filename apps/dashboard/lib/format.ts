export function formatRatio(value: number | null | undefined): string {
  if (value == null) return "—";
  const percent = value * 100;
  if (percent > 0 && percent < 0.01) return "<0.01%";
  return `${percent.toFixed(2)}%`;
}
