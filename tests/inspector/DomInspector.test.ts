// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DomInspector } from '../../src/inspector/core/DomInspector';

/** Build a DOM tree in <body>; return a helper that drives elementsFromPoint. */
function setup(html: string) {
  document.body.innerHTML = html;
  // jsdom has no elementsFromPoint — route it through a data-hit ordering:
  // elements carry data-hit="N" (0 = topmost). Return them sorted by that.
  (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = () => {
    const hits = Array.from(document.querySelectorAll<HTMLElement>('[data-hit]'));
    return hits.sort((a, b) => Number(a.dataset.hit) - Number(b.dataset.hit));
  };
  return new DomInspector();
}

describe('DomInspector — full coverage', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('selects a plain unlabeled <div> readout (was a dead zone)', () => {
    const insp = setup(`<div id="root"><div class="score-hud" data-hit="0">Score: 0</div></div>`);
    const hit = insp.findComponentAt(10, 10);
    expect(hit).not.toBeNull();
    expect(hit!.element.classList.contains('score-hud')).toBe(true);
  });

  it('selects an element in any container', () => {
    const insp = setup(`<div id="game-ui"><button data-hit="0">Play</button></div>`);
    const hit = insp.findComponentAt(10, 10);
    expect(hit).not.toBeNull();
    expect(hit!.element.tagName).toBe('BUTTON');
  });

  it('selects a bare <div> with no class/id via a role/tag fallback name', () => {
    const insp = setup(`<div data-hit="0" style="width:50px;height:20px">plain</div>`);
    const hit = insp.findComponentAt(5, 5);
    expect(hit).not.toBeNull();
    expect(hit!.name.length).toBeGreaterThan(0); // never empty, never null
  });

  it('prefers data-pixitools-component name when present', () => {
    const insp = setup(`<div data-pixitools-component="Best-Flight Readout" data-hit="0">135m</div>`);
    const hit = insp.findComponentAt(5, 5);
    expect(hit!.name).toBe('Best-Flight Readout');
  });

  it('walks up to an annotated ancestor from empty space inside it', () => {
    const insp = setup(
      `<div data-pixitools-component="TitleScreen"><div data-hit="0" style="width:200px;height:100px"></div></div>`,
    );
    const hit = insp.findComponentAt(5, 5);
    expect(hit!.name).toBe('TitleScreen');
  });

  it('never selects the inspector overlay canvas (chrome excluded)', () => {
    const insp = setup(
      `<canvas id="pixitools-inspector-overlay" data-hit="0"></canvas>` +
        `<div class="hud-panel" data-hit="1">HUD</div>`,
    );
    const hit = insp.findComponentAt(5, 5);
    // topmost is inspector chrome → skipped → the HUD beneath is selected
    expect(hit).not.toBeNull();
    expect(hit!.element.id).not.toBe('pixitools-inspector-overlay');
  });

  // The inspector puts a full-screen shield (z-index:99998, inset:0) ABOVE
  // everything while paused, so elementsFromPoint returns it as topmost at every
  // pixel. It must be excluded like the overlay canvas — otherwise every hover
  // selects the shield instead of the game element beneath it. Same for the
  // other inspector-owned chrome ids (dom-highlighter, init, screenshot-selection).
  it.each([
    'pixitools-inspector-shield',
    'pixitools-dom-highlighter',
    'pixitools-inspector-init',
    'pixitools-screenshot-selection',
  ])('never selects inspector chrome #%s', (chromeId) => {
    const insp = setup(
      `<div id="${chromeId}" data-hit="0"></div>` +
        `<div class="hud-panel" data-hit="1">HUD</div>`,
    );
    const hit = insp.findComponentAt(5, 5);
    expect(hit).not.toBeNull();
    expect(hit!.element.id).not.toBe(chromeId);
    expect(hit!.element.classList.contains('hud-panel')).toBe(true);
  });

  it('excludes a child of inspector chrome (e.g. selection box inside the overlay)', () => {
    const insp = setup(
      `<div id="pixitools-screenshot-selection"><div class="selection-box" data-hit="0"></div></div>` +
        `<button data-hit="1">Play</button>`,
    );
    const hit = insp.findComponentAt(5, 5);
    expect(hit).not.toBeNull();
    expect(hit!.element.tagName).toBe('BUTTON');
  });

  it('returns null for an FX-decorative element', () => {
    const insp = setup(`<div data-pixitools-component="Sparkles" data-pixitools-fx="true" data-hit="0"></div>`);
    expect(insp.findComponentAt(5, 5)).toBeNull();
  });

  it('Pass 2 honors data-pixitools-component on the interactive element itself', () => {
    // Topmost hit is a plain unannotated <span> INSIDE an annotated <button> —
    // Pass 1 (topmost-only) doesn't match, so this falls to Pass 2 (interactive
    // element anywhere in the stack). The button itself carries the annotation
    // and must win over inferRawName's generic "button" fallback.
    const insp = setup(
      `<button data-pixitools-component="Fire Button" data-hit="1">` +
        `<span data-hit="0">🔥</span>` +
        `</button>`,
    );
    const hit = insp.findComponentAt(5, 5);
    expect(hit).not.toBeNull();
    expect(hit!.name).toBe('Fire Button');
    expect(hit!.element.tagName).toBe('BUTTON');
  });

  it('Pass 2 returns null for an FX-annotated interactive element', () => {
    const insp = setup(
      `<button data-pixitools-component="Sparkle Button" data-pixitools-fx="true" data-hit="1">` +
        `<span data-hit="0">✨</span>` +
        `</button>`,
    );
    expect(insp.findComponentAt(5, 5)).toBeNull();
  });

  it('returns null when the only hit is a bare game canvas (defers to engine)', () => {
    const insp = setup(`<canvas id="game" data-hit="0"></canvas>`);
    // a bare <canvas> that is the GAME canvas (not inspector chrome, no DOM UI) → engine handles it
    expect(insp.findComponentAt(5, 5)).toBeNull();
  });

  it('defers a .canvas-host wrapper div to the engine (not a HUD element)', () => {
    // Real games wrap the game canvas in <div class="canvas-host"> (position:
    // absolute; inset:0 — full viewport). Clicking the 3D scene must pick a 3D
    // object via the engine, NOT select this full-viewport wrapper div.
    const insp = setup(
      `<div class="canvas-host" data-hit="0"><canvas data-hit="1"></canvas></div>`,
    );
    expect(insp.findComponentAt(200, 200)).toBeNull();
  });

  it('defers a bare div that only wraps the game canvas', () => {
    // A wrapper div whose sole meaningful content is the game canvas is scene
    // plumbing, not a selectable element — defer to the engine.
    const insp = setup(`<div id="game-root" data-hit="0"><canvas data-hit="1"></canvas></div>`);
    expect(insp.findComponentAt(50, 50)).toBeNull();
  });

  it('still selects a real HUD element that sits ABOVE the canvas wrapper', () => {
    // The wrapper defers, but a genuine HUD element on top still selects.
    const insp = setup(
      `<div class="canvas-host" data-hit="1"><canvas data-hit="2"></canvas></div>` +
        `<button class="hud-btn" data-hit="0">Play</button>`,
    );
    const hit = insp.findComponentAt(10, 10);
    expect(hit).not.toBeNull();
    expect(hit!.element.tagName).toBe('BUTTON');
  });

  it('defers the WHOLE canvas-ancestor chain, not just .canvas-host (#app fall-through)', () => {
    // Real games: #app > .canvas-host > canvas. Clicking the scene hits
    // [canvas, .canvas-host, #app, body]. The first fix deferred only .canvas-host
    // then fell through and selected #app. Every ANCESTOR of the canvas must defer.
    const insp = setup(
      `<div id="app" data-hit="2">` +
        `<div class="canvas-host" data-hit="1"><canvas data-hit="0"></canvas></div>` +
        `</div>`,
    );
    expect(insp.findComponentAt(300, 300)).toBeNull();
  });

  it('defers a generic wrapper chain even without the canvas-host class', () => {
    // #game > #stage > canvas — no known class, but all are canvas ancestors.
    const insp = setup(
      `<div id="game" data-hit="2"><div id="stage" data-hit="1"><canvas data-hit="0"></canvas></div></div>`,
    );
    expect(insp.findComponentAt(5, 5)).toBeNull();
  });
});

describe('DomInspector — buildDomTree coverage', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function names(nodes: { name: string; children: unknown[] }[]): string[] {
    const out: string[] = [];
    const walk = (ns: { name: string; children: unknown[] }[]) => {
      for (const n of ns) {
        out.push(n.name);
        walk((n.children ?? []) as { name: string; children: unknown[] }[]);
      }
    };
    walk(nodes);
    return out;
  }

  it('builds a non-empty tree for a game whose HUD has no special container', () => {
    // Real games mount their HUD as class="overlay"/#app.
    document.body.innerHTML =
      `<canvas id="game"></canvas>` +
      `<div class="overlay">` +
      `  <div data-pixitools-component="TitleScreen"><button>Play</button></div>` +
      `  <div class="score-hud">Score: 0</div>` +
      `</div>`;
    const tree = new DomInspector().buildDomTree();
    expect(tree.length).toBeGreaterThan(0);
    const all = names(tree);
    expect(all).toContain('TitleScreen');
    expect(all.some((n) => n.includes('score-hud'))).toBe(true);
  });

  it('excludes the game canvas and inspector chrome from the tree', () => {
    document.body.innerHTML =
      `<canvas id="game"></canvas>` +
      `<canvas id="pixitools-inspector-overlay"></canvas>` +
      `<div id="pixitools-inspector-shield"></div>` +
      `<div class="hud-panel">HUD</div>`;
    const all = names(new DomInspector().buildDomTree());
    expect(all.some((n) => n.includes('hud-panel'))).toBe(true);
    expect(all).not.toContain('#game');
    expect(all).not.toContain('#pixitools-inspector-overlay');
    expect(all).not.toContain('#pixitools-inspector-shield');
  });

  it('tags an FX component as the fx layer', () => {
    document.body.innerHTML =
      `<div data-pixitools-component="Sparkles" data-pixitools-fx="true"></div>`;
    const tree = new DomInspector().buildDomTree() as { name: string; layer: string }[];
    const fx = tree.find((n) => n.name === 'Sparkles');
    expect(fx?.layer).toBe('fx');
  });
});

/** Give an element a real layout box in jsdom (getBoundingClientRect is all-zero by default). */
function rect(el: HTMLElement | null, w: number, h: number) {
  if (!el) throw new Error('rect: element not found');
  (el as any).getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}),
  });
}

describe('DomInspector — transparent full-viewport wrappers defer to the engine', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const VW = window.innerWidth;
  const VH = window.innerHeight;

  it('a transparent full-viewport HUD wrapper over the canvas defers (engine raycast wins)', () => {
    // Real generated-game shape: .overlay > .screen stretches over the whole
    // game but paints nothing — clicking the 3D scene must NOT select it.
    const insp = setup(
      `<div class="root">` +
      `<div class="canvas-host"><canvas id="game" data-hit="1"></canvas></div>` +
      `<div class="overlay"><div class="screen" data-hit="0"></div></div>` +
      `</div>`,
    );
    rect(document.querySelector('.screen'), VW, VH);
    expect(insp.findComponentAt(400, 300)).toBeNull();
  });

  it('a full-viewport wrapper WITH painted background stays selectable (scrim/panel)', () => {
    const insp = setup(
      `<canvas id="game" data-hit="1"></canvas>` +
      `<div class="screen game-over" data-hit="0" style="background-color: rgb(10, 10, 20)"></div>`,
    );
    rect(document.querySelector('.screen'), VW, VH);
    const hit = insp.findComponentAt(400, 300);
    expect(hit).not.toBeNull();
    expect(hit!.element.classList.contains('screen')).toBe(true);
  });

  it('an ANNOTATED transparent full-viewport wrapper stays selectable by author intent', () => {
    const insp = setup(
      `<canvas id="game" data-hit="1"></canvas>` +
      `<div data-pixitools-component="TitleScreen" data-hit="0"></div>`,
    );
    rect(document.querySelector('[data-pixitools-component]'), VW, VH);
    const hit = insp.findComponentAt(400, 300);
    expect(hit).not.toBeNull();
    expect(hit!.name).toBe('TitleScreen');
  });

  it('a HUD leaf above the wrapper is still selected where it actually renders', () => {
    const insp = setup(
      `<canvas id="game" data-hit="2"></canvas>` +
      `<div class="screen" data-hit="1"><div class="distance-box" data-hit="0" style="background-color: rgb(139, 94, 60)">17m</div></div>`,
    );
    rect(document.querySelector('.screen'), VW, VH);
    rect(document.querySelector('.distance-box'), 120, 80);
    const hit = insp.findComponentAt(60, VH - 60);
    expect(hit).not.toBeNull();
    expect(hit!.element.classList.contains('distance-box')).toBe(true);
  });

  it('a small transparent div is NOT treated as a wrapper (stays selectable)', () => {
    const insp = setup(`<div class="hint-area" data-hit="0">steer with arrows</div>`);
    rect(document.querySelector('.hint-area'), 200, 40);
    const hit = insp.findComponentAt(20, 10);
    expect(hit).not.toBeNull();
    expect(hit!.element.classList.contains('hint-area')).toBe(true);
  });
});

describe('DomInspector — a tree name leads back to its element (SELECT_OBJECT)', () => {
  it('finds every HUD node the tree lists, by the name it lists it under', () => {
    const insp = setup(`<div id="hud"><div data-pixitools-component="ScoreBox">12</div><button id="play-btn">Play</button><div><span>plain</span></div></div>`);
    const names: string[] = [];
    const walk = (nodes: { name: string; children: unknown[] }[]) => { for (const n of nodes) { names.push(n.name); walk(n.children as never); } };
    walk(insp.buildDomTree() as never);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(insp.findComponentNamed(name), name).not.toBeNull();
    expect(insp.findComponentNamed('ScoreBox')?.textContent).toBe('12');
    expect(insp.findComponentNamed('no such thing')).toBeNull();
  });
});
