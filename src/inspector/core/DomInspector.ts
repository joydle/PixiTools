/**
 * DOM Inspector - Hit-detection and metadata extraction for HUD/DOM elements
 *
 * Geometry-first: any rendered element that is not ours is selectable. A
 * pixel resolves in priority order (first match wins):
 * 1. the component attribute (`data-<tool>-component`) on the topmost element
 * 2. an interactive element anywhere in the hit stack (button/input/…)
 * 3. the nearest annotated ancestor (parent-walk)
 * 4. a derived name for the topmost element (never a dead zone)
 *
 * Uses `document.elementsFromPoint()` (returns ALL elements regardless of
 * `pointer-events` CSS) over the whole document, not scoped to one container:
 * games mount their HUD under any class or id. Our own UI and the game canvas
 * self-exclude. `buildDomTree` roots at `<body>` for the same reason.
 */

import type { ObjectMetadata, Bounds, SceneTreeNode } from './types';
import { ATTR_COMPONENT, ATTR_PROPS, ATTR_FX, ATTR_CHROME, id } from '../../brand';

export interface DomHit {
  element: HTMLElement;
  name: string;
}

/** Tags too generic to select on their own */
const SKIP_TAGS = new Set(['DIV', 'SPAN', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'P']);

/** Tags that never draw. */
const NOT_RENDERED = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT']);

/** Tags that are always meaningful (interactive / semantic) */
const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'LABEL', 'PROGRESS', 'METER', 'CANVAS', 'VIDEO', 'IMG', 'SVG']);

/**
 * Every node the inspector itself puts on the page: the highlight canvas, the
 * input shield and the setup splash (`<tool>-inspector-*`), the DOM
 * highlighter and the screenshot crop layer. Used with `closest()` so their
 * descendants are excluded too.
 */
const INSPECTOR_CHROME_SELECTOR =
  `[id^="${id('inspector-')}"], #${id('dom-highlighter')}, #${id('screenshot-selection')}`;

export class DomInspector {
  /**
   * Find the topmost selectable element at screen coordinates.
   *
   * Priority: annotated component > raw interactive/classed element.
   * Falls through to raw HTML so AI-written `<button class="fire-btn">`
   * is selectable without any annotation.
   */
  /**
   * Our own UI must never be selected as the game's: the highlight canvas, the
   * full-screen input shield (above the game at every pixel while paused), the
   * DOM highlighter, the splash, the crop layer, and anything carrying the
   * chrome attribute (the panel). They attach to `<body>`/`<html>`, not under
   * one container, so the check is by id prefix and attribute.
   */
  private isInspectorChrome(el: HTMLElement): boolean {
    return el.closest(INSPECTOR_CHROME_SELECTOR) !== null || el.hasAttribute(ATTR_CHROME);
  }

  /** Is this the bare GAME canvas (no DOM UI to select — defer to engine)? */
  private isGameCanvas(el: HTMLElement): boolean {
    return el.tagName === 'CANVAS' && !this.isInspectorChrome(el);
  }

  /**
   * Is `el` scene-plumbing that wraps the game canvas — i.e. the canvas ITSELF or
   * any ANCESTOR of it (`.canvas-host`, `#app`, `#root`, `body`, custom wrappers)?
   * Such elements are full-viewport containers the scene sits inside, never real
   * HUD elements (a HUD button/title lives under `.overlay`, a SIBLING of the
   * canvas host, not an ancestor of the canvas). Clicking the scene must pick a
   * scene OBJECT via the engine, so every canvas ancestor defers.
   *
   * Structural (ancestor) test — robust where class-name matching wasn't: the
   * earlier `.canvas-host`-only check deferred that div but then fell through to
   * `#app`, selecting the next container up. `gameCanvas` is the game canvas found
   * in the hit stack (null if the click didn't land on a canvas — then only the
   * `.canvas-host`/`.canvas-container` class fallback applies).
   */
  private isCanvasAncestor(el: HTMLElement, gameCanvas: HTMLElement | null): boolean {
    // Class fallback for engines/layouts where the canvas isn't in the hit stack.
    if (el.classList.contains('canvas-host') || el.classList.contains('canvas-container')) {
      return true;
    }
    if (!gameCanvas) return false;
    // el is the canvas itself or contains it → it's a canvas wrapper/ancestor.
    return el === gameCanvas || el.contains(gameCanvas);
  }

  /**
   * A transparent, full-viewport layout wrapper — the `.overlay` → `.screen`
   * HUD trees games build stretch across the whole game but paint
   * nothing themselves. Being full-screen they are the topmost hit at EVERY
   * pixel, so with full coverage they swallowed every scene click
   * before the engine raycast could run ("always HUD .root/.screen"
   * follow-up). Skip them as candidates: their painted CHILDREN (a scrim, a
   * title card, a readout) still win exactly where they render, and an
   * explicitly annotated wrapper (the component attribute) stays selectable
   * by author intent. The canvas-ANCESTOR chain has its own deferral — this
   * covers the sibling overlay subtree the canvas is NOT inside.
   */
  private isTransparentViewportWrapper(el: HTMLElement): boolean {
    if (el.hasAttribute(ATTR_COMPONENT)) return false;
    if (INTERACTIVE_TAGS.has(el.tagName)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < window.innerWidth * 0.9 || rect.height < window.innerHeight * 0.9) {
      return false;
    }
    const cs = getComputedStyle(el);
    // Painted background → a real surface (scrim, panel), not a wrapper.
    const bg = cs.backgroundColor;
    if (bg && bg !== 'transparent' && !/^rgba\([^)]*,\s*0\s*\)$/.test(bg)) return false;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return false;
    if (cs.boxShadow && cs.boxShadow !== 'none') return false;
    if (parseFloat(cs.borderTopWidth || '0') > 0) return false;
    // Own text (not children's) → it renders content itself.
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3 && n.textContent && n.textContent.trim()) return false;
    }
    return true;
  }

  findComponentAt(x: number, y: number): DomHit | null {
    const stack = document.elementsFromPoint(x, y);

    // Candidates = visible, non-chrome elements at this point, topmost first.
    // Transparent full-viewport wrappers are dropped here too — see
    // isTransparentViewportWrapper.
    const candidates: HTMLElement[] = [];
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (this.isInspectorChrome(el)) continue;
      if (this.isTransparentViewportWrapper(el)) continue;
      candidates.push(el);
    }

    // Defer the game canvas AND every ANCESTOR of it in the hit stack to the
    // engine. When you click the 3D/2D scene the DOM stack is
    // [canvas, .canvas-host, #app, body, …] — the canvas plus the chain of
    // full-viewport containers it sits inside. NONE of those is a real HUD
    // element (a HUD button/title is a sibling under .overlay, never an ANCESTOR
    // of the canvas), so selecting any of them is wrong — the click belongs to a
    // scene OBJECT, picked by the engine raycast. A structural ancestor test is
    // robust where class-name matching (.canvas-host) was not: it also catches
    // #app / #root / body and any custom wrapper. If nothing survives, return
    // null so the engine handles it.
    const gameCanvas = candidates.find((el) => this.isGameCanvas(el)) ?? null;
    const nonCanvas = candidates.filter(
      (el) => !this.isGameCanvas(el) && !this.isCanvasAncestor(el, gameCanvas),
    );
    if (nonCanvas.length === 0) return null;

    // Selection priority (most specific wins):
    //
    // 1. Direct the component attribute on topmost candidate
    // 2. Interactive element (button/input/a/…) — even inside annotated parent
    // 3. Walk up to nearest annotated ancestor (the component attribute)
    // 4. Topmost candidate ALWAYS resolves to a name (no dead zone)

    // --- Pass 1: direct the component attribute on the topmost candidate ---
    const top = nonCanvas[0];
    const direct = top.getAttribute(ATTR_COMPONENT);
    if (direct) {
      if (this.isFxComponent(top)) return null;
      return { element: top, name: direct };
    }

    // --- Pass 2: interactive element anywhere in the stack ---
    // Honor an annotation on the interactive element itself (e.g. an
    // annotated <button> reached via a plain unannotated <span> on top of
    // it in the hit stack) — same annotated/FX semantics as Pass 1/3,
    // just scoped to the element ITSELF, not an ancestor walk.
    for (const el of nonCanvas) {
      if (INTERACTIVE_TAGS.has(el.tagName)) {
        const annotated = el.getAttribute(ATTR_COMPONENT);
        if (annotated && this.isFxComponent(el)) return null;
        return { element: el, name: annotated ?? this.inferRawName(el) };
      }
    }

    // --- Pass 3: walk up from the topmost to the nearest annotated ancestor ---
    let current: HTMLElement | null = top;
    while (current) {
      const name = current.getAttribute(ATTR_COMPONENT);
      if (name) {
        if (this.isFxComponent(current)) return null;
        return { element: current, name };
      }
      current = current.parentElement;
    }

    // --- Pass 4: the topmost candidate ALWAYS resolves to a name (no dead zone) ---
    return { element: top, name: this.inferRawName(top) };
  }

  /**
   * Build ObjectMetadata from a DOM element (annotated or raw).
   * Converts viewport bounds to canvas-relative coordinates.
   */
  getComponentMetadata(el: HTMLElement, gameCanvas?: HTMLCanvasElement | null): ObjectMetadata {
    const name =
      el.getAttribute(ATTR_COMPONENT) ||
      this.inferRawName(el) ||
      'UI Element';
    const propsStr = el.getAttribute(ATTR_PROPS);
    const componentProps = propsStr ? this.safeParseJson(propsStr) : this.inferRawProps(el);
    const domRect = el.getBoundingClientRect();
    const bounds = gameCanvas
      ? this.toCanvasBounds(domRect, gameCanvas)
      : { x: domRect.left, y: domRect.top, width: domRect.width, height: domRect.height };

    return {
      type: name,
      typeName: name,
      layer: 1000, // UI layer
      position: { x: Math.round(domRect.left), y: Math.round(domRect.top) },
      scale: { x: 1, y: 1 },
      alpha: this.getComputedAlpha(el),
      visible: el.offsetParent !== null || el.style.position === 'fixed',
      childCount: el.querySelectorAll(`[${ATTR_COMPONENT}]`).length,
      bounds,
      parentLabel: this.getParentLabel(el),
      sourceFile: null,
      sourceLine: null,
      sourceColumn: null,
      sourceLineRange: null,
      isDomComponent: true,
      cssClass: el.className || undefined,
      componentProps,
    };
  }

  /**
   * Build a scene tree from DOM overlay components.
   * Returns top-level nodes (not wrapped in a root).
   */
  buildDomTree(): SceneTreeNode[] {
    // Root at <body>: games mount their HUD under any class or id. walkDomTree
    // skips our own UI and the game canvas via the same gates findComponentAt uses.
    return this.walkDomTree(document.body);
  }

  /**
   * The HUD element a tree node names: the same walk the tree is built by, so a
   * name the host shows from SCENE_TREE always leads back to its element.
   */
  findComponentNamed(name: string, root: HTMLElement = document.body): HTMLElement | null {
    for (const child of Array.from(root.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (this.isInspectorChrome(child) || this.isGameCanvas(child)) continue;
      const annotated = child.getAttribute(ATTR_COMPONENT);
      if (annotated === name) return child;
      if (!annotated && this.hasStrongIdentity(child) && this.inferRawName(child) === name) return child;
      const deeper = this.findComponentNamed(name, child);
      if (deeper) return deeper;
    }
    return null;
  }

  /** Check if element is a decorative FX component */
  isFxComponent(el: HTMLElement): boolean {
    return el.getAttribute(ATTR_FX) === 'true';
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private walkDomTree(root: HTMLElement): SceneTreeNode[] {
    const nodes: SceneTreeNode[] = [];

    for (const child of Array.from(root.children)) {
      if (!(child instanceof HTMLElement)) continue;
      // Never list our own chrome or the game canvas in the HUD tree — same
      // exclusions findComponentAt applies (the tree roots at <body>).
      if (this.isInspectorChrome(child) || this.isGameCanvas(child)) continue;
      // Nothing a player sees.
      if (NOT_RENDERED.has(child.tagName)) continue;

      const annotated = child.getAttribute(ATTR_COMPONENT);
      // The element the game canvas sits in is the scene's frame, not HUD: list
      // what else is inside it, not the frame itself.
      if (!annotated && child.querySelector(':scope > canvas')) {
        nodes.push(...this.walkDomTree(child));
        continue;
      }
      if (annotated) {
        const isFx = this.isFxComponent(child);
        nodes.push({
          name: annotated,
          type: annotated,
          layer: isFx ? 'fx' : 'hud',
          children: this.walkDomTree(child),
        });
      } else if (this.hasStrongIdentity(child)) {
        // Raw element with a strong identity — list it as its own node.
        const rawName = this.inferRawName(child);
        nodes.push({
          name: rawName,
          type: child.tagName.toLowerCase(),
          layer: 'hud',
          children: this.walkDomTree(child),
        });
      } else {
        // Generic container (bare div/span/…) — flatten into its children.
        nodes.push(...this.walkDomTree(child));
      }
    }

    return nodes;
  }

  /** Convert viewport DOMRect to canvas-internal coordinates */
  private toCanvasBounds(domRect: DOMRect, canvas: HTMLCanvasElement): Bounds {
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / canvasRect.width;
    const scaleY = canvas.height / canvasRect.height;

    return {
      x: (domRect.left - canvasRect.left) * scaleX,
      y: (domRect.top - canvasRect.top) * scaleY,
      width: domRect.width * scaleX,
      height: domRect.height * scaleY,
    };
  }

  private getComputedAlpha(el: HTMLElement): number {
    const opacity = getComputedStyle(el).opacity;
    return opacity ? parseFloat(opacity) : 1;
  }

  private getParentLabel(el: HTMLElement): string {
    let parent = el.parentElement;
    while (parent) {
      const name = parent.getAttribute(ATTR_COMPONENT);
      if (name) return name;
      parent = parent.parentElement;
    }
    return 'overlay';
  }

  private safeParseJson(str: string): Record<string, unknown> {
    try {
      return JSON.parse(str);
    } catch {
      return {};
    }
  }

  // ---------------------------------------------------------------------------
  // Raw HTML fallback — makes AI-written elements selectable without annotations
  // ---------------------------------------------------------------------------

  /**
   * Derive a human-readable name for a raw (unannotated) HTML element.
   * Total — a rendered element ALWAYS gets a name (never null), so a visible
   * element is never a selection dead zone.
   *
   * Priority: id > interactive-tag hint > meaningful class > role/aria > text > tag
   */
  private inferRawName(el: HTMLElement): string {
    // 1. id is always meaningful
    if (el.id) return `#${el.id}`;

    // 2. Interactive tags are always selectable
    const tag = el.tagName;
    if (INTERACTIVE_TAGS.has(tag)) {
      // Use text content for buttons, labels
      const text = el.textContent?.trim().slice(0, 24);
      if (text) return `${tag.toLowerCase()}: "${text}"`;
      // Use type/placeholder for inputs
      if (tag === 'INPUT') {
        const input = el as HTMLInputElement;
        return `input[${input.type}]${input.placeholder ? ` "${input.placeholder}"` : ''}`;
      }
      return tag.toLowerCase();
    }

    // 3. Meaningful class name (skip utility-only classes like "flex", "p-4")
    const cls = this.getMeaningfulClass(el);
    if (cls) return `.${cls}`;

    // 4. Role / aria-label give a human label for an otherwise-generic element.
    const role = el.getAttribute('role');
    if (role) return role;
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.slice(0, 32);

    // 5. Final fallback: a short text hint, else the tag name. NEVER null.
    const text = el.textContent?.trim();
    if (text && text.length <= 24) return `"${text}"`;
    return tag.toLowerCase();
  }

  /**
   * Does this element carry a strong identity worth listing as its own scene-tree
   * node? id, interactive/uncommon tag, or a meaningful class. Used by
   * `walkDomTree` so the tree doesn't balloon with every bare container div even
   * though `inferRawName` (for selection) is now total.
   */
  private hasStrongIdentity(el: HTMLElement): boolean {
    if (el.id) return true;
    if (INTERACTIVE_TAGS.has(el.tagName)) return true;
    if (this.getMeaningfulClass(el)) return true;
    return !SKIP_TAGS.has(el.tagName); // uncommon tag
  }

  /**
   * Extract a meaningful class from an element's classList.
   * Filters out utility/framework classes (tailwind, single-letter, etc.)
   */
  private getMeaningfulClass(el: HTMLElement): string | null {
    for (const cls of el.classList) {
      // Skip short utility classes (p-4, m-2, w-full, etc.)
      if (cls.length < 4) continue;
      // Skip classes that look like utilities (contain only lowercase + hyphens + digits)
      if (/^[a-z][-a-z0-9]{0,2}$/.test(cls)) continue;
      // Accept anything with a semantic-looking name
      return cls;
    }
    return null;
  }

  /**
   * Build a minimal props object from a raw element's attributes.
   * Extracts text content, role, aria-label, etc.
   */
  private inferRawProps(el: HTMLElement): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    const text = el.textContent?.trim();
    if (text && text.length <= 60) props.text = text;
    if (el.getAttribute('role')) props.role = el.getAttribute('role');
    if (el.getAttribute('aria-label')) props['aria-label'] = el.getAttribute('aria-label');
    if (el.id) props.id = el.id;
    if (el.className) props.class = el.className;
    return props;
  }
}
