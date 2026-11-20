/**
 * Pure helpers for comparing two BuildSnapshots and producing a
 * BuildComparison payload (label + deltas + severity tags).
 */
import type { BuildComparison, BuildComparisonDelta, BuildSnapshot } from './types';

/** Within ±5% is considered neutral (no regression / improvement signal). */
export const NEUTRAL_BAND_PCT = 5;

/** For FPS / overall score: bigger is better. For frame time / heap: smaller is better. */
const DIRECTION: Record<BuildComparisonDelta['metric'], 'higher_is_better' | 'lower_is_better'> = {
  fps_p95: 'higher_is_better',
  frame_time_p95: 'lower_is_better',
  heap_max: 'lower_is_better',
  score_overall: 'higher_is_better',
};

const LABELS: Record<BuildComparisonDelta['metric'], string> = {
  fps_p95: 'FPS P95',
  frame_time_p95: 'Frame P95',
  heap_max: 'Heap max',
  score_overall: 'Score',
};

/**
 * Compute the delta between two snapshots for every comparable metric.
 * Skips metrics where the prior value is zero (no meaningful baseline).
 */
export function computeBuildComparison(
  current: BuildSnapshot,
  prior: BuildSnapshot,
  now: number = Date.now(),
): BuildComparison {
  const deltas: BuildComparisonDelta[] = [];

  const pairs: Array<{ metric: BuildComparisonDelta['metric']; cur: number; pr: number }> = [
    { metric: 'fps_p95', cur: current.fps.p95, pr: prior.fps.p95 },
    { metric: 'frame_time_p95', cur: current.frameTimeMs.p95, pr: prior.frameTimeMs.p95 },
    { metric: 'heap_max', cur: current.heapMB.max, pr: prior.heapMB.max },
    { metric: 'score_overall', cur: current.scoreOverall, pr: prior.scoreOverall },
  ];

  for (const { metric, cur, pr } of pairs) {
    if (pr <= 0) continue; // no baseline to compare against
    const deltaPct = ((cur - pr) / pr) * 100;
    const severity = classifySeverity(metric, deltaPct);
    deltas.push({
      metric,
      label: LABELS[metric],
      prior: pr,
      current: cur,
      deltaPct,
      severity,
    });
  }

  return {
    prior,
    priorAgeHuman: humanizeAge(now - prior.capturedAt),
    deltas,
  };
}

function classifySeverity(
  metric: BuildComparisonDelta['metric'],
  deltaPct: number,
): BuildComparisonDelta['severity'] {
  if (Math.abs(deltaPct) <= NEUTRAL_BAND_PCT) return 'neutral';
  const direction = DIRECTION[metric];
  const isImprovement =
    (direction === 'higher_is_better' && deltaPct > 0) ||
    (direction === 'lower_is_better' && deltaPct < 0);
  return isImprovement ? 'improvement' : 'regression';
}

function humanizeAge(ageMs: number): string {
  if (ageMs < 60_000) return 'last build · just now';
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 60) return `last build · ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `last build · ${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `last build · ${days} day${days === 1 ? '' : 's'} ago`;
}
