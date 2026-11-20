/**
 * Linear-interpolated percentile of a numeric array.
 * Empty → 0. Single-element → that element. Input is not mutated.
 *
 * Used by `ProfilerBase.getWindowedStats` to summarize FPS / frame-time
 * distributions over a time window.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
