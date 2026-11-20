/**
 * Fixed-capacity ring buffer of timestamped samples.
 * `sliceSince(cutoff)` returns all samples with `ts >= cutoff` in
 * insertion order, irrespective of where the head currently sits.
 *
 * Used by ProfilerBase to maintain a rolling time window of frame
 * samples; the consumer asks for the last N ms on demand instead of
 * the buffer maintaining duration as state.
 */
export class TimeWindowedRingBuffer<T extends { timestamp: number }> {
  private readonly buf: (T | undefined)[];
  private head = 0;
  private size = 0;
  public readonly capacity: number;

  constructor(capacity: number) {
    if (capacity < 1) throw new Error('TimeWindowedRingBuffer capacity must be >= 1');
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }

  push(sample: T): void {
    this.buf[this.head] = sample;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  /** Samples in insertion order with ts >= cutoff. O(size). */
  sliceSince(cutoff: number): T[] {
    if (this.size === 0) return [];
    const out: T[] = [];
    const start = (this.head - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) {
      const idx = (start + i) % this.capacity;
      const item = this.buf[idx];
      if (item && item.timestamp >= cutoff) out.push(item);
    }
    return out;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }

  get length(): number {
    return this.size;
  }
}
