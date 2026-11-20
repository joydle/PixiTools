/**
 * What the player sees: the game canvas plus the DOM drawn over it.
 *
 * A game's HUD, menus and end screens are often DOM over the canvas. A capture
 * of the canvas alone showed a clean play view while the player saw a broken
 * HUD on top of it (Lanternfall #4), so the screenshot a person sends to chat
 * composites the page's DOM layer over the canvas frame.
 *
 * How: the page's body is cloned with every element's computed style inlined
 * (pictures, background images and fonts as data URLs, nested canvases and
 * videos as pictures), put in an SVG `<foreignObject>` and rasterized by the
 * browser as an image. Two layers, so stacking stays right without a layout
 * engine of our own:
 *
 *   under  — the canvas's ancestors' own painting (the page background) and
 *            any element the browser reports BELOW the canvas;
 *   canvas — the captured frame, at its box on the page;
 *   over   — everything else (the HUD), with the ancestors' painting removed.
 *
 * The output is the viewport at the canvas's pixel density. When nothing is
 * drawn over the canvas the frame itself is the answer (`hud: 'included'`:
 * the canvas IS what the player sees). Any failure — a tainted picture, a
 * rasterization error, more DOM than the budget, the timeout — returns the
 * bare frame marked `hud: 'missing'`, so the host can say the HUD is not in it.
 *
 * Known limits: shadow DOM content and cross-origin iframes are left out (their
 * boxes stay, empty); a picture or font the page cannot fetch (CORS) is
 * dropped from the composite rather than failing it; a scrolled inner
 * container shows its top; animations are frozen at their current value.
 */

import { SLUG, ATTR_CHROME } from '../../brand';

export type HudState = 'included' | 'missing';

/** Turns an SVG document of `width`×`height` CSS px into something drawImage takes. */
export type Rasterize = (
  svg: string,
  width: number,
  height: number,
) => Promise<CanvasImageSource>;

export interface CompositeResult {
  /** The picture to encode. */
  canvas: HTMLCanvasElement;
  hud: HudState;
  /**
   * `viewport`: the canvas covers the page's viewport (x × `scale` = pixel x).
   * `canvas`: the bare game frame, in the game canvas's own pixels.
   */
  space: 'viewport' | 'canvas';
  /** Output pixels per CSS px (viewport space). */
  scale: number;
  /** Why the HUD is missing, for the log. */
  reason?: string;
}

export interface CompositeOptions {
  /** The live game canvas (for its box on the page; its clone is left out). */
  gameCanvas: HTMLCanvasElement;
  /** The frame to draw: a copy of the game canvas taken while it held pixels. */
  frame: HTMLCanvasElement;
  doc?: Document;
  win?: Window;
  rasterize?: Rasterize;
  timeoutMs?: number;
  createCanvas?: () => HTMLCanvasElement;
  /** A URL as a data URL, or null when it cannot be read (CORS, 404, not a picture). */
  fetchAsDataUrl?: (url: string) => Promise<string | null>;
  /** A stylesheet's text, or null (for cross-origin sheets whose rules are closed to script). */
  fetchText?: (url: string) => Promise<string | null>;
}

export const COMPOSITE_TIMEOUT_MS = 1800;
/** More elements than this and the composite is not attempted (`hud: 'missing'`). */
export const COMPOSITE_MAX_ELEMENTS = 4000;
/** Embedded web fonts, total base64 bytes. Past it, text falls back to system fonts. */
export const COMPOSITE_FONT_BUDGET = 3 * 1024 * 1024;
/** Output pixels per CSS px, at most (encodeScreenshot downsizes after). */
const MAX_SCALE = 3;

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'BASE',
]);
const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** The inspector's and the devtools' own UI: never part of what the player sees. */
export function isDevtoolsElement(el: Element): boolean {
  const id = el.id || '';
  return id.startsWith(`${SLUG}-`) || el.hasAttribute(ATTR_CHROME);
}

type Role = 'ancestor' | 'behind' | 'above';

interface Plan {
  /** Elements to leave out entirely, by original element. */
  role: Map<Element, Role>;
  visibleOverlay: boolean;
  visibleUnder: boolean;
  elements: number;
}

/**
 * Compose the frame with the DOM over it. Never rejects: a failure is the bare
 * frame with `hud: 'missing'`.
 */
export async function compositeScreenshot(opts: CompositeOptions): Promise<CompositeResult> {
  const timeoutMs = opts.timeoutMs ?? COMPOSITE_TIMEOUT_MS;
  const bare = (reason: string, hud: HudState = 'missing'): CompositeResult => ({
    canvas: opts.frame,
    hud,
    space: 'canvas',
    scale: 1,
    reason,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CompositeResult>((resolve) => {
    timer = setTimeout(() => resolve(bare('timeout')), timeoutMs);
  });
  try {
    return await Promise.race([compose(opts, bare), timeout]);
  } catch (err) {
    return bare(err instanceof Error ? err.message : String(err));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function compose(
  opts: CompositeOptions,
  bare: (reason: string, hud?: HudState) => CompositeResult,
): Promise<CompositeResult> {
  const doc = opts.doc ?? document;
  const win = opts.win ?? (doc.defaultView as Window);
  const body = doc.body;
  if (!body) return bare('no body', 'included');

  const plan = planLayers(doc, win, opts.gameCanvas);
  if (plan.elements > COMPOSITE_MAX_ELEMENTS) return bare('too many elements');
  // Nothing over the canvas: the frame is what the player sees.
  if (!plan.visibleOverlay) return bare('nothing over the canvas', 'included');

  const vw = Math.max(1, Math.round(win.innerWidth || doc.documentElement.clientWidth || 1));
  const vh = Math.max(1, Math.round(win.innerHeight || doc.documentElement.clientHeight || 1));
  const rect = opts.gameCanvas.getBoundingClientRect();
  const density = rect.width > 0 ? opts.frame.width / rect.width : 1;
  const scale = Math.min(MAX_SCALE, Math.max(1, Number.isFinite(density) ? density : 1));

  const fetchAsDataUrl = opts.fetchAsDataUrl ?? defaultFetchAsDataUrl;
  const cache = new Map<string, Promise<string | null>>();
  const inline = (url: string) => {
    let p = cache.get(url);
    if (!p) {
      p = url.startsWith('data:') ? Promise.resolve(url) : fetchAsDataUrl(url).catch(() => null);
      cache.set(url, p);
    }
    return p;
  };
  const createCanvas = opts.createCanvas ?? (() => doc.createElement('canvas'));

  const families = new Set<string>();
  const over = await buildLayer(doc, win, opts.gameCanvas, plan, 'over', inline, createCanvas, families);
  const under = plan.visibleUnder
    ? await buildLayer(doc, win, opts.gameCanvas, plan, 'under', inline, createCanvas, families)
    : null;
  const fontCss = await embedFonts(doc, families, inline, opts.fetchText ?? defaultFetchText);

  const rasterize = opts.rasterize ?? defaultRasterize;
  const out = createCanvas();
  out.width = Math.round(vw * scale);
  out.height = Math.round(vh * scale);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  if (under) {
    const img = await rasterize(svgDocument(under, fontCss, vw, vh, scale), vw, vh);
    ctx.drawImage(img, 0, 0, out.width, out.height);
  }
  ctx.drawImage(
    opts.frame,
    rect.left * scale,
    rect.top * scale,
    (rect.width || vw) * scale,
    (rect.height || vh) * scale,
  );
  const img = await rasterize(svgDocument(over, fontCss, vw, vh, scale), vw, vh);
  ctx.drawImage(img, 0, 0, out.width, out.height);
  // A tainted composite cannot be encoded; find out here, where the fallback is.
  ctx.getImageData(0, 0, 1, 1);
  return { canvas: out, hud: 'included', space: 'viewport', scale };
}

// ----------------------------------------------------------------------------
// Which element paints where
// ----------------------------------------------------------------------------

function planLayers(doc: Document, win: Window, gameCanvas: HTMLCanvasElement): Plan {
  const role = new Map<Element, Role>();
  const plan: Plan = { role, visibleOverlay: false, visibleUnder: false, elements: 0 };
  const canvasRect = gameCanvas.getBoundingClientRect();
  const stackAt =
    typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint.bind(doc) : null;

  const visit = (el: Element, inherited: Role | null) => {
    if (SKIP_TAGS.has(el.tagName) || isDevtoolsElement(el) || el === gameCanvas) return;
    plan.elements++;
    if (plan.elements > COMPOSITE_MAX_ELEMENTS) return;
    let r: Role;
    if (inherited) {
      r = inherited;
    } else if (el.contains(gameCanvas)) {
      r = 'ancestor';
    } else {
      r = isBehindCanvas(el, gameCanvas, canvasRect, stackAt) ? 'behind' : 'above';
    }
    role.set(el, r);
    const cs = win.getComputedStyle(el);
    const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
    if (r === 'ancestor') {
      if (shown && paintsItself(el, cs)) plan.visibleUnder = true;
      if (shown && hasOwnText(el)) plan.visibleOverlay = true;
    } else if (shown && (paintsItself(el, cs) || hasOwnText(el))) {
      if (r === 'above') plan.visibleOverlay = true;
      else plan.visibleUnder = true;
    }
    if (cs.display === 'none') return;
    for (const child of Array.from(el.children)) visit(child, r === 'ancestor' ? null : r);
  };
  visit(doc.body, null);
  return plan;
}

/** The browser's own stacking at the element's middle, where it overlaps the canvas. */
function isBehindCanvas(
  el: Element,
  gameCanvas: HTMLCanvasElement,
  canvasRect: DOMRect,
  stackAt: ((x: number, y: number) => Element[]) | null,
): boolean {
  if (!stackAt) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const left = Math.max(r.left, canvasRect.left);
  const right = Math.min(r.right, canvasRect.right);
  const top = Math.max(r.top, canvasRect.top);
  const bottom = Math.min(r.bottom, canvasRect.bottom);
  if (right <= left || bottom <= top) return false;
  const stack = stackAt((left + right) / 2, (top + bottom) / 2);
  const ci = stack.indexOf(gameCanvas);
  if (ci < 0) return false;
  // `pointer-events: none` elements (most HUDs) are not in the stack: above.
  const ei = stack.findIndex((s) => s === el || el.contains(s));
  return ei > ci;
}

function paintsItself(el: Element, cs: CSSStyleDeclaration): boolean {
  if (/^(IMG|CANVAS|VIDEO|SVG|svg|INPUT|TEXTAREA|SELECT|BUTTON|PROGRESS|METER)$/.test(el.tagName)) {
    return true;
  }
  const bg = cs.backgroundColor;
  if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) return true;
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
  if (cs.boxShadow && cs.boxShadow !== 'none') return true;
  const bw = parseFloat(cs.borderTopWidth || '0') + parseFloat(cs.borderLeftWidth || '0')
    + parseFloat(cs.borderRightWidth || '0') + parseFloat(cs.borderBottomWidth || '0');
  return bw > 0 && (cs.borderTopStyle || 'none') !== 'none';
}

function hasOwnText(el: Element): boolean {
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === 3 && (n.textContent || '').trim()) return true;
  }
  return false;
}

// ----------------------------------------------------------------------------
// One layer as XHTML with inlined styles
// ----------------------------------------------------------------------------

interface Layer {
  html: string;
  pseudoCss: string;
  rootStyle: string;
}

async function buildLayer(
  doc: Document,
  win: Window,
  gameCanvas: HTMLCanvasElement,
  plan: Plan,
  layer: 'under' | 'over',
  inline: (url: string) => Promise<string | null>,
  createCanvas: () => HTMLCanvasElement,
  families: Set<string>,
): Promise<Layer> {
  const pending: Promise<void>[] = [];
  const pseudo: string[] = [];
  let pseudoN = 0;

  const styleText = (cs: CSSStyleDeclaration, overrides: Record<string, string>) => {
    let text = '';
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      if (prop in overrides) continue;
      if (/^(animation|transition)/.test(prop)) continue;
      const value = cs.getPropertyValue(prop);
      if (value === '') continue;
      text += `${prop}:${value}${cs.getPropertyPriority(prop) ? ' !important' : ''};`;
    }
    for (const [k, v] of Object.entries(overrides)) text += `${k}:${v};`;
    return text;
  };

  /** CSS url()s in a style string → data URLs (or none). */
  const inlineUrls = (clone: Element, css: string) => {
    if (!/url\(/.test(css)) return;
    pending.push((async () => {
      let out = css;
      const re = /url\((['"]?)(.*?)\1\)/g;
      for (const m of Array.from(css.matchAll(re))) {
        const abs = absolute(m[2], doc);
        const data = abs ? await inline(abs) : null;
        out = out.split(m[0]).join(data ? `url("${data}")` : 'none');
      }
      clone.setAttribute('style', out);
    })());
  };

  const visit = (orig: Element, clone: Element) => {
    const role = plan.role.get(orig);
    const cs = win.getComputedStyle(orig);
    const overrides: Record<string, string> = {};
    if (layer === 'under') {
      if (role === 'above') overrides.visibility = 'hidden';
      if (role === 'ancestor') {
        overrides.color = 'transparent';
        overrides['text-shadow'] = 'none';
      }
    } else {
      if (role === 'behind') overrides.visibility = 'hidden';
      if (role === 'ancestor') {
        overrides['background-color'] = 'transparent';
        overrides['background-image'] = 'none';
        overrides['box-shadow'] = 'none';
        overrides['border-color'] = 'transparent';
        overrides['outline-style'] = 'none';
      }
    }
    if (cs.fontFamily) families.add(cs.fontFamily);
    const css = styleText(cs, overrides);
    clone.setAttribute('style', css);
    clone.removeAttribute('class');
    inlineUrls(clone, css);

    for (const which of ['::before', '::after'] as const) {
      let pcs: CSSStyleDeclaration | null = null;
      try {
        pcs = win.getComputedStyle(orig, which);
      } catch {
        pcs = null;
      }
      const content = pcs?.content;
      if (!content || content === 'none' || content === 'normal') continue;
      const cls = `fpx-p${++pseudoN}`;
      clone.setAttribute('class', `${clone.getAttribute('class') || ''} ${cls}`.trim());
      pseudo.push(`.${cls}${which}{${styleText(pcs!, {})}}`);
    }

    const tag = orig.tagName;
    if (tag === 'IMG') {
      const img = orig as HTMLImageElement;
      clone.removeAttribute('srcset');
      clone.removeAttribute('sizes');
      clone.removeAttribute('loading');
      const src = img.currentSrc || img.src;
      clone.setAttribute('src', TRANSPARENT_PIXEL);
      if (src) {
        pending.push(inline(src).then((d) => {
          if (d) clone.setAttribute('src', d);
        }));
      }
    } else if (tag === 'CANVAS' || tag === 'VIDEO') {
      // Replaced with a picture of its current frame (or an empty box).
      let data: string | null = null;
      try {
        if (tag === 'CANVAS') {
          data = (orig as HTMLCanvasElement).toDataURL('image/png');
        } else {
          const v = orig as HTMLVideoElement;
          const c = createCanvas();
          c.width = v.videoWidth || 1;
          c.height = v.videoHeight || 1;
          c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height);
          data = c.toDataURL('image/png');
        }
      } catch {
        data = null;
      }
      const img = doc.createElementNS(XHTML_NS, 'img');
      img.setAttribute('style', css);
      img.setAttribute('src', data || TRANSPARENT_PIXEL);
      clone.replaceWith(img);
      return;
    } else if (tag === 'IFRAME') {
      clone.removeAttribute('src');
      clone.removeAttribute('srcdoc');
    } else if (tag === 'INPUT') {
      const v = (orig as HTMLInputElement).value;
      if (v != null) clone.setAttribute('value', v);
      if ((orig as HTMLInputElement).checked) clone.setAttribute('checked', 'checked');
    } else if (tag === 'TEXTAREA') {
      clone.textContent = (orig as HTMLTextAreaElement).value;
    }

    // Children in lockstep with the clone (deep clone keeps the structure).
    const oKids = Array.from(orig.childNodes);
    const cKids = Array.from(clone.childNodes);
    for (let i = 0; i < oKids.length; i++) {
      const o = oKids[i];
      const c = cKids[i];
      if (!c) continue;
      if (o.nodeType === 8) {
        c.remove();
        continue;
      }
      if (o.nodeType !== 1) continue;
      const el = o as Element;
      if (el === gameCanvas) {
        // Keep its box, paint nothing: the frame is drawn there separately.
        const box = doc.createElementNS(XHTML_NS, 'div');
        box.setAttribute('style', styleText(win.getComputedStyle(el), {
          'background-color': 'transparent',
          'background-image': 'none',
          'box-shadow': 'none',
          'border-color': 'transparent',
          visibility: 'hidden',
        }));
        c.replaceWith(box);
        continue;
      }
      if (!plan.role.has(el)) {
        // Skipped tags, devtools UI, display:none subtrees past the plan.
        if (SKIP_TAGS.has(el.tagName) || isDevtoolsElement(el)) {
          c.remove();
          continue;
        }
        (c as Element).setAttribute('style', 'display:none');
        continue;
      }
      visit(el, c as Element);
    }
  };

  const bodyClone = doc.body.cloneNode(true) as HTMLElement;
  visit(doc.body, bodyClone);
  await Promise.all(pending);

  const htmlCs = win.getComputedStyle(doc.documentElement);
  // The viewport's own background (html's, or body's propagated) paints under the canvas.
  let rootStyle = 'margin:0;padding:0;overflow:hidden;position:relative;';
  if (layer === 'under') {
    rootStyle += `background-color:${htmlCs.backgroundColor || 'transparent'};`;
  }
  const sx = win.scrollX || 0;
  const sy = win.scrollY || 0;
  const scroller = sx || sy ? `transform:translate(${-sx}px,${-sy}px);` : '';
  const html = new XMLSerializer().serializeToString(bodyClone);
  return {
    html: scroller ? `<div xmlns="${XHTML_NS}" style="${scroller}">${html}</div>` : html,
    pseudoCss: pseudo.join(''),
    rootStyle,
  };
}

function svgDocument(layer: Layer, fontCss: string, vw: number, vh: number, scale: number): string {
  const style = escapeXmlText(fontCss + layer.pseudoCss);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(vw * scale)}" height="${Math.round(vh * scale)}" viewBox="0 0 ${vw} ${vh}">` +
    `<foreignObject x="0" y="0" width="${vw}" height="${vh}">` +
    `<div xmlns="${XHTML_NS}" style="width:${vw}px;height:${vh}px;${layer.rootStyle}">` +
    (style ? `<style>${style}</style>` : '') +
    layer.html +
    `</div></foreignObject></svg>`
  );
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function absolute(url: string, doc: Document): string | null {
  try {
    return new URL(url, doc.baseURI).href;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Fonts
// ----------------------------------------------------------------------------

/** The page's @font-face rules for the families in use, with their files as data URLs. */
async function embedFonts(
  doc: Document,
  families: Set<string>,
  inline: (url: string) => Promise<string | null>,
  fetchText: (url: string) => Promise<string | null>,
): Promise<string> {
  const used = new Set<string>();
  for (const f of families) {
    for (const part of f.split(',')) used.add(part.trim().replace(/^['"]|['"]$/g, '').toLowerCase());
  }
  const rules: Array<{ css: string; base: string }> = [];
  const sheets = Array.from(doc.styleSheets || []);
  for (const sheet of sheets) {
    const base = sheet.href || doc.baseURI;
    let cssRules: CSSRuleList | null = null;
    try {
      cssRules = sheet.cssRules;
    } catch {
      cssRules = null;
    }
    if (cssRules) {
      for (const rule of Array.from(cssRules)) {
        if (rule.cssText.startsWith('@font-face')) rules.push({ css: rule.cssText, base });
      }
    } else if (sheet.href) {
      const text = await fetchText(sheet.href).catch(() => null);
      for (const m of (text || '').match(/@font-face\s*{[^}]*}/g) || []) {
        rules.push({ css: m, base: sheet.href });
      }
    }
  }
  let budget = COMPOSITE_FONT_BUDGET;
  let out = '';
  for (const { css, base } of rules) {
    const fam = /font-family:\s*(['"]?)([^;'"]+)\1/i.exec(css)?.[2]?.trim().toLowerCase();
    if (!fam || !used.has(fam)) continue;
    let rule = css;
    let ok = true;
    for (const m of Array.from(css.matchAll(/url\((['"]?)(.*?)\1\)/g))) {
      let abs: string | null = null;
      try {
        abs = new URL(m[2], base).href;
      } catch {
        abs = null;
      }
      const data = abs ? await inline(abs) : null;
      if (!data || data.length > budget) {
        ok = false;
        break;
      }
      budget -= data.length;
      rule = rule.split(m[0]).join(`url("${data}")`);
    }
    if (ok) out += rule;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Browser defaults
// ----------------------------------------------------------------------------

async function defaultFetchAsDataUrl(url: string): Promise<string | null> {
  const res = await fetch(url, { mode: 'cors', credentials: 'same-origin' });
  if (!res.ok) return null;
  const blob = await res.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

async function defaultFetchText(url: string): Promise<string | null> {
  const res = await fetch(url, { mode: 'cors', credentials: 'same-origin' });
  return res.ok ? res.text() : null;
}

export const defaultRasterize: Rasterize = (svg) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Safari paints a foreignObject image blank until it has decoded once.
      const ready = typeof img.decode === 'function' ? img.decode().catch(() => undefined) : Promise.resolve();
      ready.then(() => resolve(img));
    };
    img.onerror = () => reject(new Error('the DOM layer did not rasterize'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

/** A 2D copy of the canvas's pixels now (inside a render frame for WebGL/WebGPU). */
export function copyFrame(
  canvas: HTMLCanvasElement,
  createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas'),
): HTMLCanvasElement {
  const copy = createCanvas();
  copy.width = Math.max(1, canvas.width);
  copy.height = Math.max(1, canvas.height);
  const ctx = copy.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(canvas, 0, 0);
  return copy;
}
