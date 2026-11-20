/**
 * StackParser Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { StackParser } from '../../src/inspector/core/StackParser';

describe('StackParser', () => {
  const parser = new StackParser();

  describe('parseStack', () => {
    it('should extract file and line from Chrome-style stack trace', () => {
      const stack = `Error
    at createSprite (main.ts:45:12)
    at Game.init (game.ts:100:5)
    at new Game (game.ts:20:10)`;

      const result = parser.parseStack(stack);

      expect(result).toEqual({
        file: 'main.ts',
        line: 45,
        column: 12,
      });
    });

    it('should extract file and line from Firefox-style stack trace', () => {
      const stack = `Error
createSprite@main.ts:45:12
Game.init@game.ts:100:5
Game@game.ts:20:10`;

      const result = parser.parseStack(stack);

      expect(result).toEqual({
        file: 'main.ts',
        line: 45,
        column: 12,
      });
    });

    it("should skip the tool's own files", () => {
      const stack = `Error
    at createSprite (pixitools.global.js:100:5)
    at userFunction (main.ts:45:12)`;

      const result = parser.parseStack(stack);

      expect(result).toEqual({
        file: 'main.ts',
        line: 45,
        column: 12,
      });
    });

    it('should skip node_modules files', () => {
      const stack = `Error
    at someLibrary (node_modules/pixi.js/lib/core.js:100:5)
    at userFunction (main.ts:45:12)`;

      const result = parser.parseStack(stack);

      expect(result).toEqual({
        file: 'main.ts',
        line: 45,
        column: 12,
      });
    });

    it('should handle .js files', () => {
      const stack = `Error
    at createSprite (game.js:45:12)`;

      const result = parser.parseStack(stack);

      expect(result).toEqual({
        file: 'game.js',
        line: 45,
        column: 12,
      });
    });

    it('should handle .tsx files', () => {
      const stack = `Error
    at Component (App.tsx:100:5)`;

      const result = parser.parseStack(stack);

      expect(result).toEqual({
        file: 'App.tsx',
        line: 100,
        column: 5,
      });
    });

    it('should return null for empty stack', () => {
      const result = parser.parseStack('');
      expect(result).toBeNull();
    });

    it('should return null when no user code found', () => {
      const stack = `Error
    at internal (pixitools.js:50:10)
    at node_modules/library/index.js:100:5`;

      const result = parser.parseStack(stack);

      expect(result).toBeNull();
    });

    it('should extract file and line from Vite dev server stack trace', () => {
      const stack = `Error
    at createPig (http://localhost:5173/src/main.ts?t=1738682603123:45:12)
    at Game.init (http://localhost:5173/src/game.ts?t=1738682603123:100:5)`;

      const result = parser.parseStack(stack);

      expect(result).toEqual({
        file: 'main.ts',
        line: 45,
        column: 12,
      });
    });

    it('should extract file and line from Vite production build', () => {
      const stack = `Error
    at createPig (https://example.com/assets/main-abc123.js:45:12)`;

      const result = parser.parseStack(stack);

      expect(result).toEqual({
        file: 'main-abc123.js',
        line: 45,
        column: 12,
      });
    });

    it('should handle Vite with nested src paths', () => {
      const stack = `Error
    at Component (http://localhost:5173/src/components/Game.tsx?t=1738682603123:100:5)`;

      const result = parser.parseStack(stack);

      expect(result).toEqual({
        file: 'Game.tsx',
        line: 100,
        column: 5,
      });
    });

    it('should skip Vite internal files', () => {
      const stack = `Error
    at internal (http://localhost:5173/@vite/client:100:5)
    at createSprite (http://localhost:5173/src/main.ts?t=1738682603123:45:12)`;

      const result = parser.parseStack(stack);

      expect(result).toEqual({
        file: 'main.ts',
        line: 45,
        column: 12,
      });
    });
  });

  describe('getCodeRange', () => {
    it('should return range around line number', () => {
      const result = parser.getCodeRange(50);

      expect(result).toEqual({
        startLine: 45,
        endLine: 55,
      });
    });

    it('should handle custom context lines', () => {
      const result = parser.getCodeRange(50, 10);

      expect(result).toEqual({
        startLine: 40,
        endLine: 60,
      });
    });

    it('should not go below line 1', () => {
      const result = parser.getCodeRange(3, 5);

      expect(result).toEqual({
        startLine: 1,
        endLine: 8,
      });
    });

    it('should handle line 1', () => {
      const result = parser.getCodeRange(1);

      expect(result).toEqual({
        startLine: 1,
        endLine: 6,
      });
    });
  });
});
