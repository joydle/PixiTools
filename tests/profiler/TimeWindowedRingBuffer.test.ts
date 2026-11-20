import { describe, it, expect } from 'vitest';
import { TimeWindowedRingBuffer } from '../../src/profiler/core/TimeWindowedRingBuffer';

describe('TimeWindowedRingBuffer', () => {
  it('returns empty slice on empty buffer', () => {
    const b = new TimeWindowedRingBuffer<{ timestamp: number; v: number }>(5);
    expect(b.sliceSince(0)).toEqual([]);
  });

  it('returns all samples when cutoff is before oldest', () => {
    const b = new TimeWindowedRingBuffer<{ timestamp: number; v: number }>(5);
    b.push({ timestamp: 100, v: 1 });
    b.push({ timestamp: 200, v: 2 });
    b.push({ timestamp: 300, v: 3 });
    expect(b.sliceSince(50)).toEqual([
      { timestamp: 100, v: 1 },
      { timestamp: 200, v: 2 },
      { timestamp: 300, v: 3 },
    ]);
  });

  it('returns only samples with ts >= cutoff', () => {
    const b = new TimeWindowedRingBuffer<{ timestamp: number; v: number }>(5);
    b.push({ timestamp: 100, v: 1 });
    b.push({ timestamp: 200, v: 2 });
    b.push({ timestamp: 300, v: 3 });
    expect(b.sliceSince(200)).toEqual([
      { timestamp: 200, v: 2 },
      { timestamp: 300, v: 3 },
    ]);
  });

  it('returns empty when cutoff is after newest', () => {
    const b = new TimeWindowedRingBuffer<{ timestamp: number; v: number }>(5);
    b.push({ timestamp: 100, v: 1 });
    expect(b.sliceSince(200)).toEqual([]);
  });

  it('overwrites oldest at capacity', () => {
    const b = new TimeWindowedRingBuffer<{ timestamp: number; v: number }>(3);
    b.push({ timestamp: 1, v: 1 });
    b.push({ timestamp: 2, v: 2 });
    b.push({ timestamp: 3, v: 3 });
    b.push({ timestamp: 4, v: 4 });
    expect(b.sliceSince(0)).toEqual([
      { timestamp: 2, v: 2 },
      { timestamp: 3, v: 3 },
      { timestamp: 4, v: 4 },
    ]);
  });

  it('clear() empties the buffer', () => {
    const b = new TimeWindowedRingBuffer<{ timestamp: number; v: number }>(5);
    b.push({ timestamp: 1, v: 1 });
    b.clear();
    expect(b.sliceSince(0)).toEqual([]);
  });

  it('length reflects current size', () => {
    const b = new TimeWindowedRingBuffer<{ timestamp: number; v: number }>(3);
    expect(b.length).toBe(0);
    b.push({ timestamp: 1, v: 1 });
    b.push({ timestamp: 2, v: 2 });
    expect(b.length).toBe(2);
    b.push({ timestamp: 3, v: 3 });
    b.push({ timestamp: 4, v: 4 });
    expect(b.length).toBe(3);
  });

  it('throws on capacity < 1', () => {
    expect(() => new TimeWindowedRingBuffer<{ timestamp: number }>(0)).toThrow();
  });

  it('preserves insertion order across wrap-around', () => {
    // capacity 3; push 5 with rising ts; slice should return the last 3 in ts order.
    const b = new TimeWindowedRingBuffer<{ timestamp: number; v: number }>(3);
    for (let i = 1; i <= 5; i++) b.push({ timestamp: i * 10, v: i });
    expect(b.sliceSince(0)).toEqual([
      { timestamp: 30, v: 3 },
      { timestamp: 40, v: 4 },
      { timestamp: 50, v: 5 },
    ]);
  });
});
