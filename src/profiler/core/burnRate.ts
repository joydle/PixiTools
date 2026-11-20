/**
 * SLO burn rate from a window of frame samples.
 *
 * SLO: "99% of frames hit the target frame-time budget."
 * Error budget = 1% per window. Burn rate = (% over budget) / 1%.
 *
 *   burn ≈ 1.0  → consuming budget at the steady-state rate (right at SLO)
 *   burn ≥ 3    → sustained degradation
 *   burn ≥ 10   → acute stutter
 *
 * Used by both the warning detector (multi-window pairs) and any other
 * consumer that wants a uniform "how bad is this window?" scalar.
 */

/** Fraction of frames allowed to miss the budget under the SLO. */
export const SLO_ERROR_BUDGET = 0.01;

/**
 * Compute the burn rate for a windowed sample slice.
 *
 * @param samples Frame samples within the window (already sliced by caller).
 * @param targetFrameMs Frame-time budget. Frames whose frameTime exceeds this
 *   count as "errors" against the SLO.
 * @param minSamples If `samples.length < minSamples` the window is treated as
 *   insufficient signal and the function returns 0. Default 30 (~0.5s at 60fps).
 */
export function computeBurnRate(
  samples: ReadonlyArray<{ frameTime: number }>,
  targetFrameMs: number,
  minSamples: number = 30,
): number {
  if (samples.length < minSamples) return 0;
  let overBudget = 0;
  for (const s of samples) {
    if (s.frameTime > targetFrameMs) overBudget += 1;
  }
  return (overBudget / samples.length) / SLO_ERROR_BUDGET;
}
