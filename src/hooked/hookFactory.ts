/**
 * Hook Factory — shared utilities for wrapping engine constructors.
 *
 * Provides two patterns:
 * 1. makeHooked() — wraps a class constructor (Three.js, Pixi)
 * 2. hookFactoryMethod() — wraps a prototype method (e.g., factory.create())
 *
 * Both add __src (source location) and __n (auto-name) to every created object,
 * then call the track hook for the inspector's ObjectTracker.
 */

import { captureSource } from './captureSource';
import { TRACK } from '../brand';

const counts: Record<string, number> = {};

/**
 * Wrap a constructor class to add __src + __n + the track hook
 *
 * Name resolution order (first non-null wins):
 * 1. obj.name / obj.label — AI/user-set name
 * 2. autoName() — engine-derived name (texture key, geometry type, etc.)
 * 3. `${constructorName}_${count}` — fallback counter
 *
 * @param Original The original constructor to wrap
 * @param name Constructor name (e.g., "Mesh", "Sprite")
 * @param autoName Engine-specific naming function
 */
export function makeHooked<T extends new (...args: any[]) => any>(
  Original: T,
  name: string,
  autoName: (obj: any, args: any[], name: string) => string | null,
): T {
  const Hooked = class extends Original {
    constructor(...args: any[]) {
      super(...args);
      (this as any).__src = captureSource();
      counts[name] = (counts[name] || 0) + 1;
      (this as any).__n =
        (this as any).label ||
        (this as any).name ||
        autoName(this, args, name) ||
        `${name}_${counts[name]}`;
      if (typeof window !== 'undefined' && (window as any)[TRACK]) {
        (window as any)[TRACK](this, (this as any).__n);
      }
    }
  };

  // Preserve constructor name for instanceof checks and debugging
  Object.defineProperty(Hooked, 'name', { value: name });

  return Hooked as unknown as T;
}

/**
 * Hook a prototype method to add __src + __n + the track hook
 * on the returned object.
 *
 * Used for factory patterns where objects are created via
 * factory methods instead of constructors.
 *
 * @param prototype The prototype to patch (e.g., GameObjectFactory.prototype)
 * @param method Method name (e.g., "sprite", "image", "text")
 * @param autoName Engine-specific naming function
 */
export function hookFactoryMethod(
  prototype: any,
  method: string,
  autoName: (obj: any, args: any[], method: string) => string | null,
): void {
  const original = prototype[method];
  if (!original || typeof original !== 'function') return;

  prototype[method] = function (this: any, ...args: any[]) {
    const obj = original.apply(this, args);
    if (obj && typeof obj === 'object') {
      obj.__src = captureSource();
      counts[method] = (counts[method] || 0) + 1;
      obj.__n =
        obj.label ||
        obj.name ||
        autoName(obj, args, method) ||
        `${method}_${counts[method]}`;
      if (typeof window !== 'undefined' && (window as any)[TRACK]) {
        (window as any)[TRACK](obj, obj.__n);
      }
    }
    return obj;
  };
}
