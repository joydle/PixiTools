// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DomHighlighter } from '../../src/inspector/core/DomHighlighter';

function makeEl() {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ left: 40, top: 60, width: 120, height: 30, right: 160, bottom: 90, x: 40, y: 60, toJSON() {} }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('DomHighlighter — highlights on real games', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // The container now mounts on <html>, so clearing <body> doesn't remove it —
    // strip any leftover highlighter so each test starts clean.
    document.getElementById('pixitools-dom-highlighter')?.remove();
  });

  it('create() succeeds and mounts on <html> (not body)', () => {
    const h = new DomHighlighter();
    h.create();
    expect(h.isActive()).toBe(true);
    const container = document.getElementById('pixitools-dom-highlighter');
    expect(container).not.toBeNull();
    // Must mount on <html>, NOT <body> — a transformed <body> would double-scale
    // the fixed boxes.
    expect(container!.parentElement).toBe(document.documentElement);
  });

  it('showSelection draws a visible box but NO text label (panel names it)', () => {
    const h = new DomHighlighter();
    h.create();
    h.showSelection(makeEl(), 'HUD .howto');
    const container = document.getElementById('pixitools-dom-highlighter')!;
    // A selection box exists and carries a border (the highlight).
    const boxes = Array.from(container.querySelectorAll('div')).filter(
      (d) => /border/.test(d.getAttribute('style') || ''),
    );
    expect(boxes.length).toBeGreaterThan(0);
    // No on-scene label text — the edit panel header already names the element.
    expect(container.textContent).not.toContain('HUD .howto');
  });

  it('showHover DOES draw its label (hover has no panel to name the element)', () => {
    const h = new DomHighlighter();
    h.create();
    h.showHover(makeEl(), 'hover-label');
    const container = document.getElementById('pixitools-dom-highlighter')!;
    expect(container.textContent).toContain('hover-label');
  });

  it('positions the box at the element viewport rect (left:40, top:60)', () => {
    const h = new DomHighlighter();
    h.create();
    h.showSelection(makeEl(), 'X');
    const container = document.getElementById('pixitools-dom-highlighter')!;
    const box = container.querySelector('div') as HTMLElement;
    const style = box.getAttribute('style') || '';
    expect(style).toMatch(/left:\s*40px/);
    expect(style).toMatch(/top:\s*60px/);
    expect(style).toMatch(/width:\s*120px/);
  });

  // the container mounts on <html> and has
  // NO transform (a transform would make it a containing block and re-introduce
  // the double-scale trap). The boxes are position:fixed → true viewport coords.
  // jsdom has no layout, so this pins the CSS SCHEME that the live browser proved
  // correct against `transform: scale()` on <body>.
  it('container is a plain fixed layer (NO transform) on <html>', () => {
    const h = new DomHighlighter();
    h.create();
    const container = document.getElementById('pixitools-dom-highlighter')!;
    const style = container.getAttribute('style') || '';
    expect(style).toMatch(/position:\s*fixed/);
    // No transform — that was the round-2 mistake that double-scaled the box.
    expect(style).not.toMatch(/transform:/);
  });

  it('the selection box is position:fixed (true viewport coords)', () => {
    const h = new DomHighlighter();
    h.create();
    h.showSelection(makeEl(), 'sel');
    const container = document.getElementById('pixitools-dom-highlighter')!;
    const box = container.querySelector('div') as HTMLElement;
    expect(box.getAttribute('style') || '').toMatch(/position:\s*fixed/);
  });

  it('showHover also draws a box (dashed) without a shell', () => {
    const h = new DomHighlighter();
    h.create();
    h.showHover(makeEl(), 'hover');
    const container = document.getElementById('pixitools-dom-highlighter')!;
    const dashed = Array.from(container.querySelectorAll('div')).some((d) =>
      /dashed/.test(d.getAttribute('style') || ''),
    );
    expect(dashed).toBe(true);
  });
});
