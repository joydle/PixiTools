/**
 * ObjectTracker Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectTracker } from '../../src/inspector/core/ObjectTracker';
import { StackParser } from '../../src/inspector/core/StackParser';

describe('ObjectTracker', () => {
  let tracker: ObjectTracker;

  beforeEach(() => {
    tracker = new ObjectTracker(new StackParser());
  });

  describe('track', () => {
    it('should track an object with type', () => {
      const obj = { name: 'player' };

      tracker.track(obj, 'sprite');

      expect(tracker.has(obj)).toBe(true);
      expect(tracker.get(obj)?.type).toBe('sprite');
    });

    it('should track an object with source location', () => {
      const obj = { name: 'enemy' };
      const source = { file: 'main.ts', line: 45 };

      tracker.track(obj, 'sprite', source);

      const tracked = tracker.get(obj);
      expect(tracked?.source).toEqual(source);
    });

    it('should increment count when tracking', () => {
      const obj1 = {};
      const obj2 = {};

      tracker.track(obj1, 'sprite1');
      tracker.track(obj2, 'sprite2');

      expect(tracker.getCount()).toBe(2);
    });
  });

  describe('get', () => {
    it('should return undefined for untracked objects', () => {
      const obj = {};

      expect(tracker.get(obj)).toBeUndefined();
    });

    it('should return tracked info', () => {
      const obj = {};
      tracker.track(obj, 'mesh', { file: 'game.ts', line: 100 });

      const tracked = tracker.get(obj);

      expect(tracked).toEqual({
        type: 'mesh',
        source: { file: 'game.ts', line: 100 },
      });
    });
  });

  describe('has', () => {
    it('should return false for untracked objects', () => {
      expect(tracker.has({})).toBe(false);
    });

    it('should return true for tracked objects', () => {
      const obj = {};
      tracker.track(obj, 'container');

      expect(tracker.has(obj)).toBe(true);
    });
  });

  describe('createHook', () => {
    it('should create a hook that tracks returned objects', () => {
      const createSprite = () => ({ type: 'sprite' });

      const hookedCreate = tracker.createHook(
        createSprite,
        (_args, result) => (result as { type: string }).type
      );

      const sprite = hookedCreate();

      expect(tracker.has(sprite)).toBe(true);
      expect(tracker.get(sprite)?.type).toBe('sprite');
    });

    it('should pass arguments through', () => {
      const createWithName = (name: string) => ({ name });

      const hookedCreate = tracker.createHook(
        createWithName,
        (args) => args[0] as string
      );

      const obj = hookedCreate('player');

      expect(obj.name).toBe('player');
      expect(tracker.get(obj)?.type).toBe('player');
    });
  });

  describe('fallback pattern', () => {
    it('should use stackParser fallback when source is undefined', () => {
      // Create a mock parser that returns a known source
      const mockParser = {
        parse: () => ({ file: 'test.ts', line: 42 }),
        parseStack: () => null,
        getCodeRange: () => ({ startLine: 1, endLine: 10 }),
      } as any;

      const trackerWithMock = new ObjectTracker(mockParser);
      const obj = {};

      // Track WITHOUT source parameter (fallback should kick in)
      trackerWithMock.track(obj, 'sprite');

      const tracked = trackerWithMock.get(obj);

      // Should have source from automatic parse()
      expect(tracked?.source).toEqual({ file: 'test.ts', line: 42 });
    });

    it('should prefer explicit source over fallback', () => {
      // Create a mock parser that should NOT be called
      const mockParser = {
        parse: () => {
          throw new Error('parse() should not be called when explicit source provided');
        },
        parseStack: () => null,
        getCodeRange: () => ({ startLine: 1, endLine: 10 }),
      } as any;

      const trackerWithMock = new ObjectTracker(mockParser);
      const obj = {};
      const explicitSource = { file: 'explicit.ts', line: 99 };

      // Track WITH explicit source
      trackerWithMock.track(obj, 'sprite', explicitSource);

      const tracked = trackerWithMock.get(obj);

      // Should use explicit source, NOT fallback parse()
      expect(tracked?.source).toEqual(explicitSource);
    });

    it('should handle null source as fallback trigger', () => {
      // Create a mock parser
      const mockParser = {
        parse: () => ({ file: 'fallback.ts', line: 123 }),
        parseStack: () => null,
        getCodeRange: () => ({ startLine: 1, endLine: 10 }),
      } as any;

      const trackerWithMock = new ObjectTracker(mockParser);
      const obj = {};

      // Track with null source (should trigger fallback)
      trackerWithMock.track(obj, 'mesh', null);

      const tracked = trackerWithMock.get(obj);

      // Should have source from fallback
      expect(tracked?.source).toEqual({ file: 'fallback.ts', line: 123 });
    });
  });
});
