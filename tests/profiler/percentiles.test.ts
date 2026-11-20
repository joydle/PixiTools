import { describe, it, expect } from 'vitest';
import { percentile } from '../../src/profiler/core/percentiles';

describe('percentile', () => {
  it('p50 of [1..10] is ~5.5 (linear interpolation between 5 and 6)', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBeCloseTo(5.5, 1);
  });

  it('p95 of [1..100] is ~95.05', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(arr, 95)).toBeCloseTo(95, 0);
  });

  it('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('returns the only value for a single-element array', () => {
    expect(percentile([42], 99)).toBe(42);
  });

  it('returns min for p0 and max for p100', () => {
    expect(percentile([3, 1, 2], 0)).toBe(1);
    expect(percentile([3, 1, 2], 100)).toBe(3);
  });

  it('does not mutate the input array', () => {
    const arr = [3, 1, 2];
    percentile(arr, 50);
    expect(arr).toEqual([3, 1, 2]);
  });

  it('handles unsorted input', () => {
    expect(percentile([10, 1, 7, 4, 2], 50)).toBeCloseTo(4, 1);
  });
});
