/**
 * Minimal source location capture for hooked engine constructors.
 *
 * Creates an Error stack, parses it immediately, and returns ONLY
 * { f: fileUrl, l: line, c: column } — ~80 bytes per object instead
 * of ~2KB for a full stack string.
 *
 * Column is CRITICAL for source map resolution in bundled/minified code.
 */

import { OWN_FRAME } from '../brand';

/** Frames to skip — our hook code + libraries */
const SKIP = /hookFactory|makeHooked|node_modules|@vite\/|webpack|rollup/;

/**
 * Capture the source location of the calling user code.
 *
 * Walks the Error stack, skips internal/library frames, and extracts
 * the first user code frame as { f: fileUrl, l: line, c: column }.
 *
 * Handles Chrome, Firefox, and Safari stack formats.
 *
 * @returns Compact source ref or null if no user frame found
 */
export function captureSource(): { f: string; l: number; c: number } | null {
  const stack = new Error().stack;
  if (!stack) return null;

  const lines = stack.split('\n');

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];

    // Skip internal frames
    if (SKIP.test(line) || OWN_FRAME.test(line)) continue;

    // Chrome/V8:  "    at funcName (http://localhost:5173/src/main.ts:42:15)"
    //             "    at http://localhost:5173/src/main.ts:42:15"
    // Firefox:    "funcName@http://localhost:5173/src/main.ts:42:15"
    // Safari:     "funcName@http://localhost:5173/src/main.ts:42:15"
    const m =
      line.match(/(?:\(|@)(https?:\/\/[^\s)]+):(\d+):(\d+)/) ||
      line.match(/\((file:\/\/[^\s)]+):(\d+):(\d+)\)/) ||
      line.match(/at\s+(https?:\/\/[^\s]+):(\d+):(\d+)/);

    if (m) {
      return { f: m[1], l: +m[2], c: +m[3] };
    }
  }

  return null;
}
