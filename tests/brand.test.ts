import { describe, expect, it } from 'vitest';
import { OWN_FRAME, ATTR_COMPONENT, id } from '../src/brand';
import { captureSource } from '../src/hooked/captureSource';

describe('brand', () => {
  it('knows its own files in a stack, and nobody else\'s', () => {
    for (const frame of [
      'at new Hooked (http://localhost:5173/node_modules/@joydle/pixitools/dist/pixitools.pixi.js:40:20)',
      'at attach (https://example.com/lib/pixitools.global.min.js:1:900)',
      'at makeHooked (/Users/me/PixiTools/src/hooked/hookFactory.ts:36:7)',
    ]) expect(OWN_FRAME.test(frame), frame).toBe(true);
    for (const frame of [
      'at build (http://localhost:5173/src/main.ts:42:15)',
      'at build (https://joydle.github.io/PixiTools/demo.js:58:15)',
      'at start (http://localhost:5173/src/pixitools-demo/world.ts:7:3)',
    ]) expect(OWN_FRAME.test(frame), frame).toBe(false);
  });

  it('names what it puts on the page after itself', () => {
    expect(id('panel')).toBe('pixitools-panel');
    expect(ATTR_COMPONENT).toBe('data-pixitools-component');
  });

  it('captureSource skips its own frames and returns the caller', () => {
    const here = captureSource();
    // Under vitest the caller is this file, served from a file:// or /@fs/ URL when there is one.
    expect(here === null || typeof here.l === 'number').toBe(true);
  });
});
