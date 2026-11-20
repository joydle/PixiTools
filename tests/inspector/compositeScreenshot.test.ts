// @vitest-environment jsdom
/**
 * The screenshot a person sends to chat is what the player sees: the canvas
 * AND the DOM drawn over it. On Lanternfall #4 a canvas-only capture showed a
 * clean play view while the player saw a broken HUD on top of it.
 *
 * jsdom has no canvas and no layout, so these tests run the real composite
 * against a tiny software canvas (pixels in an array) and a fake rasterizer
 * standing in for the browser's SVG renderer; the page's boxes are stubbed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  compositeScreenshot,
  isDevtoolsElement,
  type Rasterize,
} from '../../src/inspector/core/compositeScreenshot';
import { InspectorBase } from '../../src/inspector/core/InspectorBase';
import type { Bounds, ObjectMetadata, SceneTreeNode, SelectionCandidate } from '../../src/inspector/core';

type RGBA = [number, number, number, number];
const BLUE: RGBA = [0, 0, 255, 255];
const RED: RGBA = [255, 0, 0, 255];
const CLEAR: RGBA = [0, 0, 0, 0];

interface Source {
  width: number;
  height: number;
  pixel(x: number, y: number): RGBA;
}

/** A picture the fake rasterizer returns: `fill` inside `rects`, clear elsewhere. */
class Picture implements Source {
  constructor(
    public width: number,
    public height: number,
    private rects: Array<{ x: number; y: number; w: number; h: number; fill: RGBA }>,
  ) {}
  pixel(x: number, y: number): RGBA {
    for (const r of this.rects) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.fill;
    }
    return CLEAR;
  }
}

/** Just enough of a 2D canvas: drawImage (nearest, opaque-over), fillRect, getImageData. */
class SoftCanvas implements Source {
  width = 0;
  height = 0;
  private px: RGBA[] = [];
  private w = -1;
  private h = -1;
  readonly draws: Array<{ src: unknown; dx: number; dy: number; dw: number; dh: number }> = [];
  tainted = false;

  private ensure() {
    if (this.w !== this.width || this.h !== this.height) {
      this.w = this.width;
      this.h = this.height;
      this.px = Array.from({ length: this.width * this.height }, () => CLEAR);
    }
  }
  pixel(x: number, y: number): RGBA {
    this.ensure();
    return this.px[Math.floor(y) * this.width + Math.floor(x)] ?? CLEAR;
  }
  fill(c: RGBA) {
    this.ensure();
    this.px = this.px.map(() => c);
    return this;
  }
  getContext(kind: string) {
    if (kind !== '2d') return null;
    const self = this;
    return {
      drawImage(src: Source, ...a: number[]) {
        self.ensure();
        let sx = 0, sy = 0, sw = src.width, sh = src.height, dx: number, dy: number, dw: number, dh: number;
        if (a.length === 2) [dx, dy, dw, dh] = [a[0], a[1], src.width, src.height];
        else if (a.length === 4) [dx, dy, dw, dh] = a as [number, number, number, number];
        else [sx, sy, sw, sh, dx, dy, dw, dh] = a as [number, number, number, number, number, number, number, number];
        self.draws.push({ src, dx, dy, dw, dh });
        for (let y = Math.max(0, Math.floor(dy)); y < Math.min(self.height, dy + dh); y++) {
          for (let x = Math.max(0, Math.floor(dx)); x < Math.min(self.width, dx + dw); x++) {
            const c = src.pixel(sx + ((x - dx) / dw) * sw, sy + ((y - dy) / dh) * sh);
            if (c[3] > 0) self.px[y * self.width + x] = c;
          }
        }
      },
      getImageData() {
        if (self.tainted) throw new DOMException('tainted', 'SecurityError');
        return { data: new Uint8ClampedArray(4) };
      },
    };
  }
  toDataURL(mime = 'image/png') {
    return `data:${mime};base64,${'A'.repeat(400)}`;
  }
}

const asCanvas = (c: SoftCanvas) => c as unknown as HTMLCanvasElement;

function setViewport(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}

function stubRect(el: Element, x: number, y: number, w: number, h: number) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) }) as DOMRect;
}

/** A page: a 200×100 game canvas filling the viewport, at 2× density. */
function gamePage() {
  setViewport(200, 100);
  document.body.innerHTML = '';
  const game = document.createElement('canvas');
  game.id = 'game';
  document.body.appendChild(game);
  stubRect(game, 0, 0, 200, 100);
  const frame = new SoftCanvas();
  frame.width = 400;
  frame.height = 200;
  frame.fill(BLUE);
  return { game, frame };
}

function addHud(text = 'HP 3') {
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.setAttribute('style', 'position: absolute; left: 10px; top: 10px; color: rgb(255, 0, 0)');
  hud.textContent = text;
  document.body.appendChild(hud);
  return hud;
}

/** The browser's SVG renderer, faked: paints the HUD box red when the SVG carries it. */
function hudRasterizer(seen: string[]): Rasterize {
  return async (svg, w, h) => {
    seen.push(svg);
    const rects = svg.includes('HP 3') && /color:\s*rgb\(255, 0, 0\)/.test(svg)
      ? [{ x: 10, y: 10, w: 50, h: 20, fill: RED }]
      : [];
    return new Picture(w, h, rects) as unknown as CanvasImageSource;
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('compositeScreenshot', () => {
  it('draws the DOM HUD over the canvas: the HUD pixels are in the picture', async () => {
    const { game, frame } = gamePage();
    addHud();
    const seen: string[] = [];
    const shot = await compositeScreenshot({
      gameCanvas: game,
      frame: asCanvas(frame),
      rasterize: hudRasterizer(seen),
      createCanvas: () => asCanvas(new SoftCanvas()),
    });

    expect(shot.hud).toBe('included');
    expect(shot.space).toBe('viewport');
    expect(shot.scale).toBe(2);
    const out = shot.canvas as unknown as SoftCanvas;
    expect([out.width, out.height]).toEqual([400, 200]);
    // HUD at CSS (10..60, 10..30) → output px (20..120, 20..60): red.
    expect(out.pixel(40, 40)).toEqual(RED);
    // Away from the HUD: the game frame.
    expect(out.pixel(300, 150)).toEqual(BLUE);
    // Order: frame first, then the overlay over the whole viewport.
    expect(out.draws[0].src).toBe(frame);
    expect(out.draws[0]).toMatchObject({ dx: 0, dy: 0, dw: 400, dh: 200 });
    expect(out.draws[1].src).toBeInstanceOf(Picture);

    // The overlay is XHTML in a foreignObject with the HUD's style inlined, and
    // the game canvas itself is not in it (its box is kept, empty).
    const svg = seen[0];
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('HP 3');
    expect(svg).toMatch(/color:\s*rgb\(255, 0, 0\)/);
    expect(svg).not.toContain('<canvas');
  });

  it('places a canvas that does not fill the viewport at its own box', async () => {
    const { game, frame } = gamePage();
    stubRect(game, 50, 25, 100, 50); // 400×200 px in a 100×50 CSS box → 4× density, capped at 3
    addHud();
    const shot = await compositeScreenshot({
      gameCanvas: game,
      frame: asCanvas(frame),
      rasterize: hudRasterizer([]),
      createCanvas: () => asCanvas(new SoftCanvas()),
    });
    const out = shot.canvas as unknown as SoftCanvas;
    expect(shot.scale).toBe(3);
    expect(out.draws[0]).toMatchObject({ dx: 150, dy: 75, dw: 300, dh: 150 });
  });

  it('leaves the inspector and devtools UI out', async () => {
    const { game, frame } = gamePage();
    addHud();
    for (const id of ['pixitools-dom-highlighter', 'pixitools-inspector-overlay', 'pixitools-screenshot-selection']) {
      const el = document.createElement('div');
      el.id = id;
      el.textContent = `DEVTOOLS ${id}`;
      document.body.appendChild(el);
      expect(isDevtoolsElement(el)).toBe(true);
    }
    const script = document.createElement('script');
    script.textContent = 'window.SECRET = 1';
    document.body.appendChild(script);
    const seen: string[] = [];
    const shot = await compositeScreenshot({
      gameCanvas: game,
      frame: asCanvas(frame),
      rasterize: hudRasterizer(seen),
      createCanvas: () => asCanvas(new SoftCanvas()),
    });
    expect(shot.hud).toBe('included');
    expect(seen[0]).toContain('HP 3');
    expect(seen[0]).not.toContain('DEVTOOLS');
    expect(seen[0]).not.toContain('SECRET');
  });

  it('nothing over the canvas: the frame itself, HUD included', async () => {
    const { game, frame } = gamePage();
    const rasterize = vi.fn();
    const shot = await compositeScreenshot({
      gameCanvas: game,
      frame: asCanvas(frame),
      rasterize,
      createCanvas: () => asCanvas(new SoftCanvas()),
    });
    expect(shot.hud).toBe('included');
    expect(shot.space).toBe('canvas');
    expect(shot.canvas).toBe(frame);
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('a rasterizer failure falls back to the canvas, marked hud missing', async () => {
    const { game, frame } = gamePage();
    addHud();
    const shot = await compositeScreenshot({
      gameCanvas: game,
      frame: asCanvas(frame),
      rasterize: async () => {
        throw new Error('the DOM layer did not rasterize');
      },
      createCanvas: () => asCanvas(new SoftCanvas()),
    });
    expect(shot.hud).toBe('missing');
    expect(shot.canvas).toBe(frame);
    expect(shot.reason).toContain('rasterize');
  });

  it('a tainted composite falls back to the canvas, marked hud missing', async () => {
    const { game, frame } = gamePage();
    addHud();
    const shot = await compositeScreenshot({
      gameCanvas: game,
      frame: asCanvas(frame),
      rasterize: hudRasterizer([]),
      createCanvas: () => {
        const c = new SoftCanvas();
        c.tainted = true;
        return asCanvas(c);
      },
    });
    expect(shot.hud).toBe('missing');
    expect(shot.canvas).toBe(frame);
  });

  it('a composite that does not finish in time falls back, marked hud missing', async () => {
    const { game, frame } = gamePage();
    addHud();
    const shot = await compositeScreenshot({
      gameCanvas: game,
      frame: asCanvas(frame),
      rasterize: () => new Promise(() => {}),
      timeoutMs: 30,
      createCanvas: () => asCanvas(new SoftCanvas()),
    });
    expect(shot).toMatchObject({ hud: 'missing', reason: 'timeout' });
    expect(shot.canvas).toBe(frame);
  });

  it('pictures become data URLs; one that cannot be read is dropped, not fatal', async () => {
    const { game, frame } = gamePage();
    addHud();
    const ok = document.createElement('img');
    ok.src = '/assets/heart.png';
    const bad = document.createElement('img');
    bad.src = 'https://elsewhere.example/x.png';
    document.body.append(ok, bad);
    const seen: string[] = [];
    const shot = await compositeScreenshot({
      gameCanvas: game,
      frame: asCanvas(frame),
      rasterize: hudRasterizer(seen),
      createCanvas: () => asCanvas(new SoftCanvas()),
      fetchAsDataUrl: async (url) => (url.endsWith('/assets/heart.png') ? 'data:image/png;base64,SEFSVA==' : null),
    });
    expect(shot.hud).toBe('included');
    expect(seen[0]).toContain('data:image/png;base64,SEFSVA==');
    expect(seen[0]).not.toContain('elsewhere.example');
    expect(seen[0]).not.toContain('/assets/heart.png');
  });

  it('an element the browser stacks BELOW the canvas goes in the under layer', async () => {
    const { game, frame } = gamePage();
    const backdrop = document.createElement('div');
    backdrop.id = 'backdrop';
    backdrop.setAttribute('style', 'background-color: rgb(0, 255, 0)');
    backdrop.textContent = 'BACKDROP';
    document.body.insertBefore(backdrop, game);
    stubRect(backdrop, 0, 0, 200, 100);
    addHud();
    (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint =
      () => [game, backdrop, document.body];
    const seen: string[] = [];
    await compositeScreenshot({
      gameCanvas: game,
      frame: asCanvas(frame),
      rasterize: hudRasterizer(seen),
      createCanvas: () => asCanvas(new SoftCanvas()),
    });
    delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
    // Two layers: under (backdrop shown, HUD hidden) then over (backdrop hidden).
    expect(seen).toHaveLength(2);
    const [under, over] = seen; // rasterized in paint order: under, then over
    const backdropStyle = (svg: string) => /id="backdrop" style="([^"]*)"/.exec(svg)?.[1] ?? '';
    expect(backdropStyle(over)).toContain('visibility:hidden');
    expect(backdropStyle(under)).not.toContain('visibility:hidden');
  });
});

/** The real InspectorBase screenshot path, with a soft canvas as the game's. */
class ShotInspector extends InspectorBase {
  readonly engineType = 'pixi' as const;
  constructor(private canvas: HTMLCanvasElement) {
    super();
  }
  protected findObjectsAt(): SelectionCandidate[] { return []; }
  protected getObjectMetadata(): ObjectMetadata { return { type: 'x' } as unknown as ObjectMetadata; }
  protected hookConstructors(): void {}
  protected isSceneReady(): boolean { return true; }
  protected getCanvas(): HTMLCanvasElement | null { return this.canvas; }
  protected buildSceneTree(): SceneTreeNode | null { return null; }
  protected findObjectByName(): unknown | null { return null; }
  protected focusOnObject(): void {}
  protected getObjectBounds(): Bounds | null { return null; }
}

describe('InspectorBase REQUEST_SCREENSHOT', () => {
  function harness() {
    setViewport(200, 100);
    const game = new SoftCanvas();
    game.width = 400;
    game.height = 200;
    game.fill(BLUE);
    const el = document.createElement('canvas');
    document.body.appendChild(el);
    // The live element stands for the game canvas: its box, its pixels.
    stubRect(el, 0, 0, 200, 100);
    Object.assign(el, {
      getContext: (k: string) => game.getContext(k),
      toDataURL: () => game.toDataURL(),
      width: 400,
      height: 200,
      pixel: (x: number, y: number) => game.pixel(x, y),
    });
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
      tag === 'canvas' ? (new SoftCanvas() as unknown as HTMLElement) : realCreate(tag)) as typeof document.createElement);
    const posted: Array<Record<string, unknown>> = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation((m: unknown) => {
      posted.push(m as Record<string, unknown>);
    });
    const insp = new ShotInspector(el as HTMLCanvasElement) as unknown as {
      takeScreenshot: (id?: string) => void;
    };
    return { insp, posted };
  }

  const settle = async (posted: unknown[], ms = 3000) => {
    const t0 = Date.now();
    while (posted.length === 0 && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
  };

  it('answers one SCREENSHOT_RESULT that echoes the requestId and says the HUD is in it', async () => {
    const { insp, posted } = harness();
    insp.takeScreenshot('req-7');
    await settle(posted);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'SCREENSHOT_RESULT', requestId: 'req-7', hud: 'included' });
    expect(String(posted[0].dataUrl)).toMatch(/^data:image\/jpeg/);
  });

  it('sends no requestId when the host sent none (older hosts)', async () => {
    const { insp, posted } = harness();
    insp.takeScreenshot();
    await settle(posted);
    expect(posted[0]).not.toHaveProperty('requestId');
  });

  it('a HUD that cannot be composited still answers, with the canvas and hud missing', async () => {
    const { insp, posted } = harness();
    addHud();
    // jsdom never loads the SVG image, so the real rasterizer runs out its time.
    insp.takeScreenshot('req-8');
    await settle(posted, 4000);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'SCREENSHOT_RESULT', requestId: 'req-8', hud: 'missing' });
    expect(posted[0].dataUrl).toBeTruthy();
  }, 8000);
});
