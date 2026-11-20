import { describe, expect, it } from 'vitest';
import pixitools from '../src/vite';

const ctx = (seen: string[]) => ({
  resolve: async (source: string) => { seen.push(source); return { id: `/resolved/${source}` }; },
});

describe('the Vite plugin', () => {
  it('sends the game\'s `pixi.js` to the hooked build', async () => {
    const seen: string[] = [];
    const plugin = pixitools();
    const out = await plugin.resolveId.call(ctx(seen), 'pixi.js', '/app/src/main.ts', {});
    expect(seen).toEqual(['@joydle/pixitools/pixi']);
    expect(out).toEqual({ id: '/resolved/@joydle/pixitools/pixi' });
  });

  it('leaves the hooked build its real pixi.js, and every other import alone', async () => {
    const seen: string[] = [];
    const plugin = pixitools();
    expect(await plugin.resolveId.call(ctx(seen), 'pixi.js', '/app/node_modules/@joydle/pixitools/dist/pixitools.pixi.js', {})).toBeNull();
    expect(await plugin.resolveId.call(ctx(seen), 'pixi-filters', '/app/src/main.ts', {})).toBeNull();
    expect(seen).toEqual([]);
  });

  it('runs in dev only unless asked', () => {
    expect(pixitools().apply).toBe('serve');
    expect(pixitools({ build: true }).apply).toBeUndefined();
  });
});
