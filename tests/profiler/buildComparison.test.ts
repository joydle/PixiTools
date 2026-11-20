import { describe, it, expect } from 'vitest';
import { computeBuildComparison } from '../../src/profiler/core/buildComparison';
import type { BuildSnapshot } from '../../src/profiler/core/types';

const make = (overrides: Partial<BuildSnapshot> = {}): BuildSnapshot => ({
  gameId: 'g1',
  buildId: null,
  capturedAt: 1_000_000,
  engineKind: 'PixiJS',
  windowMs: 30_000,
  fps: { p50: 120, p95: 110, p99: 100, min: 80, max: 135 },
  frameTimeMs: { p50: 8, p95: 9, p99: 10, max: 12 },
  frameTimeBuckets: new Array(12).fill(0),
  heapMB: { start: 8, end: 8, min: 7, max: 9 },
  scoreOverall: 90,
  scoreSmooth: 90,
  scoreMemory: 90,
  sampleCount: 1800,
  ...overrides,
});

describe('computeBuildComparison', () => {
  it('flags a >5% FPS drop as a regression', () => {
    const prior = make({ fps: { p50: 120, p95: 110, p99: 100, min: 80, max: 135 } });
    const current = make({ fps: { p50: 80, p95: 70, p99: 60, min: 50, max: 100 } }); // p95 110 → 70
    const cmp = computeBuildComparison(current, prior, prior.capturedAt + 60_000);
    const fpsDelta = cmp.deltas.find((d) => d.metric === 'fps_p95');
    expect(fpsDelta?.severity).toBe('regression');
    expect(fpsDelta?.deltaPct).toBeCloseTo(((70 - 110) / 110) * 100, 1);
  });

  it('flags a >5% FPS gain as an improvement', () => {
    const prior = make({ fps: { p50: 80, p95: 70, p99: 60, min: 50, max: 90 } });
    const current = make({ fps: { p50: 120, p95: 110, p99: 100, min: 80, max: 130 } });
    const cmp = computeBuildComparison(current, prior, prior.capturedAt + 60_000);
    const fpsDelta = cmp.deltas.find((d) => d.metric === 'fps_p95');
    expect(fpsDelta?.severity).toBe('improvement');
  });

  it('within ±5% is neutral', () => {
    const prior = make({ fps: { p50: 120, p95: 110, p99: 100, min: 80, max: 135 } });
    const current = make({ fps: { p50: 121, p95: 112, p99: 101, min: 81, max: 136 } });
    const cmp = computeBuildComparison(current, prior, prior.capturedAt + 60_000);
    const fpsDelta = cmp.deltas.find((d) => d.metric === 'fps_p95');
    expect(fpsDelta?.severity).toBe('neutral');
  });

  it('frame-time direction is inverted (higher = regression)', () => {
    const prior = make({ frameTimeMs: { p50: 8, p95: 9, p99: 10, max: 12 } });
    const current = make({ frameTimeMs: { p50: 16, p95: 20, p99: 24, max: 32 } });
    const cmp = computeBuildComparison(current, prior, prior.capturedAt + 60_000);
    const ftDelta = cmp.deltas.find((d) => d.metric === 'frame_time_p95');
    expect(ftDelta?.severity).toBe('regression');
  });

  it('heap-max direction is inverted (higher = regression)', () => {
    const prior = make({ heapMB: { start: 8, end: 8, min: 7, max: 9 } });
    const current = make({ heapMB: { start: 8, end: 12, min: 7, max: 14 } });
    const cmp = computeBuildComparison(current, prior, prior.capturedAt + 60_000);
    const heapDelta = cmp.deltas.find((d) => d.metric === 'heap_max');
    expect(heapDelta?.severity).toBe('regression');
  });

  it('skips metrics with zero prior baseline', () => {
    const prior = make({ scoreOverall: 0 });
    const current = make({ scoreOverall: 90 });
    const cmp = computeBuildComparison(current, prior, prior.capturedAt);
    expect(cmp.deltas.find((d) => d.metric === 'score_overall')).toBeUndefined();
  });

  it('humanizes age — minutes', () => {
    const prior = make({ capturedAt: 1_000_000 });
    const cmp = computeBuildComparison(make(), prior, prior.capturedAt + 12 * 60_000);
    expect(cmp.priorAgeHuman).toBe('last build · 12 min ago');
  });

  it('humanizes age — just now', () => {
    const prior = make({ capturedAt: 1_000_000 });
    const cmp = computeBuildComparison(make(), prior, prior.capturedAt + 30_000);
    expect(cmp.priorAgeHuman).toBe('last build · just now');
  });

  it('humanizes age — hours', () => {
    const prior = make({ capturedAt: 1_000_000 });
    const cmp = computeBuildComparison(make(), prior, prior.capturedAt + 3 * 3600_000);
    expect(cmp.priorAgeHuman).toBe('last build · 3 hr ago');
  });
});
