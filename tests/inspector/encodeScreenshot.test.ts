import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  encodeScreenshot,
  SCREENSHOT_MAX_WIDTH,
  SCREENSHOT_JPEG_QUALITY,
} from '../../src/inspector/core/InspectorBase';

/**
 * A screenshot often rides a JSON request body as base64. A full-resolution
 * WebGL canvas as lossless PNG is about 8 MB, which request-size limits refuse.
 * These tests pin the two properties that stop that: JPEG by default, and a
 * capped width.
 */
// The inspector runs in a browser; this suite runs in node (vitest.config.ts
// sets environment: 'node' because the engine code needs a real browser). A
// two-field document stub is enough to exercise the encode path.
let created: ReturnType<typeof fakeCanvas> | null = null;
beforeEach(() => {
  created = null;
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      created = fakeCanvas(0, 0);
      return created.canvas;
    },
  };
});
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

function fakeCanvas(width: number, height: number) {
  const calls: Array<[string, number | undefined]> = [];
  const ctx = { drawImage: vi.fn() };
  const canvas = {
    width,
    height,
    getContext: () => ctx,
    toDataURL: (mime: string, q?: number) => {
      calls.push([mime, q]);
      return `data:${mime};base64,AAAA`;
    },
  } as unknown as HTMLCanvasElement;
  return { canvas, calls, ctx };
}

describe('encodeScreenshot', () => {
  it('encodes as JPEG, not lossless PNG', () => {
    const { canvas, calls } = fakeCanvas(800, 600);
    const out = encodeScreenshot(canvas);
    expect(calls[0][0]).toBe('image/jpeg');
    expect(calls[0][1]).toBe(SCREENSHOT_JPEG_QUALITY);
    expect(out.startsWith('data:image/jpeg')).toBe(true);
  });

  it('downscales a canvas wider than the cap, and draws into the smaller one', () => {
    const { canvas } = fakeCanvas(3840, 2160);
    encodeScreenshot(canvas);
    expect(created).not.toBeNull();
    expect(created!.ctx.drawImage).toHaveBeenCalled();
    expect(created!.canvas.width).toBe(SCREENSHOT_MAX_WIDTH);
    // aspect ratio preserved: 3840x2160 -> 1280x720
    expect(created!.canvas.height).toBe(720);
    // and the smaller canvas is what gets encoded
    expect(created!.calls[0][0]).toBe('image/jpeg');
  });

  it('leaves a canvas narrower than the cap at its own size', () => {
    const { canvas, calls } = fakeCanvas(640, 480);
    encodeScreenshot(canvas);
    expect(created).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('keeps PNG when the caller needs an alpha channel', () => {
    const { canvas, calls } = fakeCanvas(900, 600);
    encodeScreenshot(canvas, { alpha: true });
    expect(calls[0][0]).toBe('image/png');
  });

  it('still returns an image when the 2D context is unavailable', () => {
    (globalThis as { document?: unknown }).document = {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => null,
        toDataURL: (mime: string) => `data:${mime};base64,AAAA`,
      }),
    };
    const { canvas } = fakeCanvas(4000, 2000);
    expect(encodeScreenshot(canvas)).toContain('data:image/jpeg');
  });
});
