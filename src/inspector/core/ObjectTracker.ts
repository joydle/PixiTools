/**
 * Object Tracker - WeakMap-based tracking for game objects
 *
 * Tracks created game objects with their source locations
 * without preventing garbage collection.
 */

import { TrackedObject, SourceLocation } from './types';
import { StackParser } from './StackParser';

export class ObjectTracker {
  private objects: WeakMap<object, TrackedObject> = new WeakMap();
  private count = 0;
  private stackParser: StackParser;

  constructor(stackParser?: StackParser) {
    this.stackParser = stackParser || new StackParser();
  }

  /**
   * Track an object with its type and source location
   */
  track(obj: object, type: string, source?: SourceLocation | null): void {
    const sourceLocation = source ?? this.stackParser.parse();

    this.objects.set(obj, {
      type,
      source: sourceLocation,
    });

    this.count++;
  }

  /**
   * Get tracking info for an object
   */
  get(obj: object): TrackedObject | undefined {
    return this.objects.get(obj);
  }

  /**
   * Check if an object is tracked
   */
  has(obj: object): boolean {
    return this.objects.has(obj);
  }

  /**
   * Get the number of tracked objects
   * Note: This is approximate since WeakMap entries can be garbage collected
   */
  getCount(): number {
    return this.count;
  }

  /**
   * Create a hook wrapper for constructor functions
   * Automatically tracks objects created by the hooked function
   */
  createHook<T extends (...args: unknown[]) => object>(
    original: T,
    getType: (args: unknown[], result: object) => string
  ): T {
    const tracker = this;

    return function(this: unknown, ...args: unknown[]): object {
      const result = original.apply(this, args);
      const type = getType(args, result);
      tracker.track(result, type);
      return result;
    } as T;
  }

  /**
   * Hook a class constructor using Reflect.construct
   * This preserves the prototype chain properly
   */
  hookConstructor<T extends new (...args: unknown[]) => object>(
    Constructor: T,
    getType: (args: unknown[], result: object) => string
  ): T {
    const tracker = this;
    const original = Constructor;

    const HookedConstructor = function(this: unknown, ...args: unknown[]): object {
      const instance = Reflect.construct(original, args, new.target || original);
      const type = getType(args, instance);
      tracker.track(instance, type);
      return instance;
    } as unknown as T;

    // Preserve prototype chain
    HookedConstructor.prototype = original.prototype;
    Object.setPrototypeOf(HookedConstructor, original);

    return HookedConstructor;
  }
}
