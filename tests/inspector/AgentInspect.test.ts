/**
 * The agent's side of the inspector: dev-server modules
 * resolve through their inline maps, stack-only errors find their line, and
 * what the game hung on an object comes back as small plain JSON.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceMapGenerator } from 'source-map-js';
import { SourceMapResolver, inlineMapOf, isDevModule } from '../../src/inspector/core/SourceMapResolver';
import { sourceRefFromStack } from '../../src/inspector/core/StackParser';
import { ErrorTracker } from '../../src/inspector/core/ErrorTracker';
import { plainValues } from '../../src/inspector/core/InspectorBase';

const SOURCE = ['interface Hero {', '  hp: number;', '}', '', 'export function spawn() {', '  const hero = new Sprite(tex);', '}'].join('\n');

/** A transformed module: the types are gone, so `new Sprite` is on line 2, not 6. */
function devModule(): string {
  const g = new SourceMapGenerator({ file: 'game.ts' });
  g.addMapping({ generated: { line: 2, column: 15 }, original: { line: 6, column: 15 }, source: 'game.ts' });
  g.setSourceContent('game.ts', SOURCE);
  const b64 = Buffer.from(g.toString()).toString('base64');
  return `export function spawn() {\n  const hero = new Sprite(tex);\n}\n//# sourceMappingURL=data:application/json;base64,${b64}\n`;
}

afterEach(() => vi.unstubAllGlobals());

describe('dev modules', () => {
  it('knows a dev-served module from a bundle and a dependency', () => {
    expect(isDevModule('http://localhost:5173/src/game.ts')).toBe(true);
    expect(isDevModule('http://localhost:5173/src/hud.tsx?t=17')).toBe(true);
    expect(isDevModule('http://localhost:5173/assets/index-a1b2c3d4.js')).toBe(false);
    expect(isDevModule('http://localhost:5173/node_modules/.vite/deps/pixi__js.js?v=1')).toBe(false);
    expect(isDevModule('http://localhost:5173/@vite/client')).toBe(false);
  });

  it('reads the inline map a dev server appends', () => {
    expect(inlineMapOf(devModule())?.sources).toEqual(['game.ts']);
    expect(inlineMapOf('const a = 1;')).toBeNull();
    expect(inlineMapOf('//# sourceMappingURL=data:application/json;base64,!!!')).toBeNull();
  });

  it('maps a transformed line back to the source line, once per module', async () => {
    const fetch = vi.fn(async () => new Response(devModule()));
    vi.stubGlobal('fetch', fetch);
    const r = new SourceMapResolver();
    const out = await r.resolve({ f: 'http://localhost:5173/src/game.ts', l: 2, c: 15 });
    expect(out).toMatchObject({ source: '/src/game.ts', line: 6, sourceLine: 'const hero = new Sprite(tex);', varName: 'hero' });
    await r.resolve({ f: 'http://localhost:5173/src/game.ts', l: 2, c: 15 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the raw line when the module has no map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('export const a = 1;')));
    const out = await new SourceMapResolver().resolve({ f: 'http://localhost:5173/src/a.ts', l: 3, c: 1 });
    expect(out).toEqual({ source: '/src/a.ts', line: 3, column: 1 });
  });
});

describe('stack-only errors', () => {
  it('finds the first frame of the game, past the devtools and dependencies', () => {
    const stack = [
      'Error: boom',
      '    at captureSource (http://localhost:5173/@fs/x/pixitools/dist/pixitools.pixi.min.js:1:200)',
      '    at new Sprite (http://localhost:5173/node_modules/.vite/deps/pixi__js.js?v=9:40:3)',
      '    at spawn (http://localhost:5173/src/game.ts?t=5:2:15)',
    ].join('\n');
    expect(sourceRefFromStack(stack)).toEqual({ f: 'http://localhost:5173/src/game.ts?t=5', l: 2, c: 15 });
    expect(sourceRefFromStack('Error\n    at <anonymous>')).toBeNull();
    expect(sourceRefFromStack(undefined)).toBeNull();
  });

  it('resolves a rejection with no filename through its stack, and settles before it is read', async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    vi.stubGlobal('window', { addEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = f; }, removeEventListener: () => {} });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(devModule())));
    const sent: unknown[] = [];
    const tracker = new ErrorTracker({ send: (m: unknown) => sent.push(m) } as never, new SourceMapResolver());
    tracker.init();
    const reason = new Error('no texture');
    reason.stack = 'Error: no texture\n    at spawn (http://localhost:5173/src/game.ts:2:15)';
    listeners.unhandledrejection({ reason });
    await tracker.settled();
    const [e] = tracker.getErrors();
    expect(e).toMatchObject({ type: 'unhandledrejection', message: 'no texture', originalSource: '/src/game.ts', originalLine: 6 });
    expect(sent).toHaveLength(1);
    tracker.destroy();
  });
});

describe('plainValues', () => {
  it('keeps strings, numbers, booleans and short plain arrays; drops the rest', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(plainValues({ hp: 3, name: 'hero', alive: true, path: [1, 2], nan: NaN, fn: () => 1, obj: cyclic, mixed: [1, {}] }))
      .toEqual({ hp: 3, name: 'hero', alive: true, path: [1, 2] });
    expect(plainValues({})).toBeUndefined();
    expect(plainValues(null)).toBeUndefined();
    expect(plainValues([1, 2])).toBeUndefined();
  });
});
