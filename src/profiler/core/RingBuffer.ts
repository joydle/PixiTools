/**
 * RingBuffer - Fixed-size circular buffer for frame samples
 *
 * Zero-allocation after construction: no array resizing, no GC pressure.
 * Used to store recent frame samples without unbounded memory growth.
 *
 * Performance: O(1) push, O(n) toArray
 */

export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private _length = 0;
  private readonly _capacity: number;

  constructor(capacity: number) {
    if (capacity < 1) throw new Error('RingBuffer capacity must be >= 1');
    this._capacity = capacity;
    // Pre-allocate the full buffer
    this.buffer = new Array<T | undefined>(capacity);
  }

  /** Add an item, overwriting the oldest if at capacity */
  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this._capacity;
    if (this._length < this._capacity) {
      this._length++;
    }
  }

  /** Get the most recent item, or undefined if empty */
  last(): T | undefined {
    if (this._length === 0) return undefined;
    const idx = (this.head - 1 + this._capacity) % this._capacity;
    return this.buffer[idx];
  }

  /** Get item at logical index (0 = oldest, length-1 = newest) */
  at(index: number): T | undefined {
    if (index < 0 || index >= this._length) return undefined;
    const start = this._length < this._capacity ? 0 : this.head;
    const bufferIdx = (start + index) % this._capacity;
    return this.buffer[bufferIdx];
  }

  /** Return items in insertion order (oldest first, newest last) */
  toArray(): T[] {
    if (this._length === 0) return [];

    const result: T[] = new Array(this._length);
    const start = this._length < this._capacity ? 0 : this.head;

    for (let i = 0; i < this._length; i++) {
      result[i] = this.buffer[(start + i) % this._capacity] as T;
    }

    return result;
  }

  /** Return the last N items (newest first) */
  lastN(n: number): T[] {
    const count = Math.min(n, this._length);
    if (count === 0) return [];

    const result: T[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const idx = (this.head - 1 - i + this._capacity) % this._capacity;
      result[i] = this.buffer[idx] as T;
    }
    return result.reverse();
  }

  /** Number of items currently stored */
  get length(): number {
    return this._length;
  }

  /** Maximum capacity */
  get capacity(): number {
    return this._capacity;
  }

  /** Whether buffer is at capacity (oldest items being overwritten) */
  get isFull(): boolean {
    return this._length === this._capacity;
  }

  /** Clear all items */
  clear(): void {
    this.head = 0;
    this._length = 0;
    // Don't reallocate — just mark as empty
    for (let i = 0; i < this._capacity; i++) {
      this.buffer[i] = undefined;
    }
  }

  /**
   * Iterate over items oldest-to-newest without allocating an array.
   * Use this for aggregation to avoid GC pressure.
   */
  forEach(callback: (item: T, index: number) => void): void {
    if (this._length === 0) return;
    const start = this._length < this._capacity ? 0 : this.head;
    for (let i = 0; i < this._length; i++) {
      callback(this.buffer[(start + i) % this._capacity] as T, i);
    }
  }

  /**
   * Reduce over items oldest-to-newest without allocating an array.
   */
  reduce<U>(callback: (accumulator: U, item: T, index: number) => U, initialValue: U): U {
    let acc = initialValue;
    this.forEach((item, index) => {
      acc = callback(acc, item, index);
    });
    return acc;
  }
}
