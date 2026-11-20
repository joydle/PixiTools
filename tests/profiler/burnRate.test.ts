import { describe, it, expect } from 'vitest';
import { computeBurnRate, SLO_ERROR_BUDGET } from '../../src/profiler/core/burnRate';

const sample = (frameTime: number) => ({ frameTime });

describe('computeBurnRate', () => {
  it('returns 0 when below minSamples (insufficient signal)', () => {
    const samples = Array.from({ length: 10 }, () => sample(100)); // all way over budget
    expect(computeBurnRate(samples, 16.7, 30)).toBe(0);
  });

  it('returns 0 when all frames are within budget', () => {
    const samples = Array.from({ length: 60 }, () => sample(10));
    expect(computeBurnRate(samples, 16.7)).toBe(0);
  });

  it('returns ≈1 at exactly the SLO error budget rate (1% over)', () => {
    // 1 over budget out of 100 → 1% over → burn rate 1.0
    const samples = [sample(100), ...Array.from({ length: 99 }, () => sample(10))];
    expect(computeBurnRate(samples, 16.7)).toBeCloseTo(1.0, 5);
  });

  it('returns ≈3 when 3% of frames miss budget', () => {
    const over = Array.from({ length: 3 }, () => sample(100));
    const ok = Array.from({ length: 97 }, () => sample(10));
    expect(computeBurnRate([...over, ...ok], 16.7)).toBeCloseTo(3.0, 5);
  });

  it('returns ≈10 when 10% of frames miss budget', () => {
    const over = Array.from({ length: 10 }, () => sample(100));
    const ok = Array.from({ length: 90 }, () => sample(10));
    expect(computeBurnRate([...over, ...ok], 16.7)).toBeCloseTo(10.0, 5);
  });

  it('does not count frames at exactly the target as over-budget', () => {
    const samples = Array.from({ length: 60 }, () => sample(16.7));
    expect(computeBurnRate(samples, 16.7)).toBe(0);
  });

  it('SLO_ERROR_BUDGET is 1%', () => {
    expect(SLO_ERROR_BUDGET).toBe(0.01);
  });

  it('minSamples default is 30', () => {
    const exactly29 = Array.from({ length: 29 }, () => sample(100));
    const exactly30 = Array.from({ length: 30 }, () => sample(100));
    expect(computeBurnRate(exactly29, 16.7)).toBe(0);
    expect(computeBurnRate(exactly30, 16.7)).toBeGreaterThan(0);
  });
});
