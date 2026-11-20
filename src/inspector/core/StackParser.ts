/**
 * Stack Parser - Extract source location from Error stack traces
 *
 * Used to track where game objects were created in user code.
 * Now captures column numbers for source map resolution.
 */

import { SourceLocation, LineRange } from './types';
import { OWN_FRAME } from '../../brand';

export class StackParser {
  /**
   * Patterns to identify user code files (not library/inspector code)
   * Chrome: "    at createSprite (main.ts:45:12)"
   * Firefox: "createSprite@main.ts:45:12"
   * Vite: "    at createPig (http://localhost:5173/src/main.ts?t=1234:45:12)"
   *
   * All patterns capture: [1]=filename, [2]=ext, [3]=line, [4]=column (optional)
   */
  private readonly userFilePatterns = [
    // Vite style with full URL: http://localhost:5173/src/main.ts?t=xxx:line:col
    /https?:\/\/[^\/]+\/(?:src\/)?([^?:]+\.(ts|js|tsx|jsx))(?:\?[^:]*)?:(\d+):(\d+)/,
    // Chrome/V8 style: (filename.ts:line:col) or (path/filename.ts:line:col)
    /\((?:[^()]*\/)?([^\/\\()]+\.(ts|js|tsx|jsx)):(\d+):(\d+)\)/,
    // Firefox style: @filename.ts:line:col
    /@(?:[^@]*\/)?([^\/\\@]+\.(ts|js|tsx|jsx)):(\d+):(\d+)/,
    // Fallback: just filename:line anywhere (no column)
    /[\s(@]([^\/\\()\s@]+\.(ts|js|tsx|jsx)):(\d+)/,
  ];

  /**
   * Files to skip (inspector code, libraries)
   */
  private readonly skipPatterns = [
    OWN_FRAME,
    /hookFactory/i,
    /captureSource/i,
    /animation-runtime/i,
    /node_modules/,
    /webpack/,
    /\/@vite\//,
    /\/vite\/dist\//,
    /chunk-/i,
    /vendor/i,
  ];

  /**
   * Parse the current stack trace to find the first user code location
   */
  parse(): SourceLocation | null {
    const stack = new Error().stack;
    if (!stack) return null;

    return this.parseLines(stack.split('\n'), 2);
  }

  /**
   * Parse a provided stack string instead of generating a new one
   */
  parseStack(stack: string): SourceLocation | null {
    return this.parseLines(stack.split('\n'), 0);
  }

  /**
   * Shared parsing logic
   */
  private parseLines(lines: string[], startIndex: number): SourceLocation | null {
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];

      // Skip library/inspector code
      if (this.skipPatterns.some(pattern => pattern.test(line))) {
        continue;
      }

      // Try to match user code
      for (const pattern of this.userFilePatterns) {
        const match = line.match(pattern);
        if (match) {
          // Extract filename from potential full path
          const fullPath = match[1];
          const filename = fullPath.includes('/')
            ? fullPath.split('/').pop() || fullPath
            : fullPath;

          return {
            file: filename,
            line: parseInt(match[3], 10),
            column: match[4] ? parseInt(match[4], 10) : undefined,
          };
        }
      }
    }

    return null;
  }

  /**
   * Get a range of lines around a given line number for context
   */
  getCodeRange(lineNumber: number, contextLines: number = 5): LineRange {
    return {
      startLine: Math.max(1, lineNumber - contextLines),
      endLine: lineNumber + contextLines,
    };
  }
}

// Singleton instance for convenience
export const stackParser = new StackParser();

/** Library and devtool frames: never the line a person wrote. */
const NOT_USER_FRAME = /hookFactory|makeHooked|node_modules|\/@vite\/|\/@fs\/|webpack|rollup|chunk-/;

/**
 * The first frame of a stack that is the game's own code, as the compact
 * { f: full URL, l, c } a source map resolves — for errors that arrive with a
 * stack but no filename (a rejected promise, a console.error(err)).
 */
export function sourceRefFromStack(stack: string | undefined): { f: string; l: number; c: number } | null {
  if (!stack) return null;
  for (const line of stack.split('\n')) {
    if (NOT_USER_FRAME.test(line) || OWN_FRAME.test(line)) continue;
    const m =
      line.match(/(?:\(|@)((?:https?|file):\/\/[^\s)]+):(\d+):(\d+)/) ||
      line.match(/at\s+((?:https?|file):\/\/[^\s)]+):(\d+):(\d+)/);
    if (m) return { f: m[1], l: +m[2], c: +m[3] };
  }
  return null;
}
