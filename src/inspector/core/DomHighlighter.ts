/**
 * DOM Highlighter - Lightweight DOM-based highlight overlay for HUD components
 *
 * Uses absolutely-positioned <div> elements (not canvas drawing) to highlight
 * selected/hovered DOM/HUD components.
 *
 * The sibling of `CanvasHighlighter`, which draws the same highlights for CANVAS
 * objects (Pixi sprites, Three.js meshes). Together they are the inspector's two
 * highlight renderers — one per target surface (DOM vs canvas). Visual style is
 * shared (cyan = selection, yellow = hover); keep transform/positioning behavior
 * in sync (both mount on `document.documentElement`).
 */

import { DEFAULT_OVERLAY_COLORS } from './types';
import { id } from '../../brand';

export class DomHighlighter {
  private container: HTMLDivElement | null = null;
  private selectionEl: HTMLDivElement | null = null;
  private hoverEl: HTMLDivElement | null = null;
  private labelEl: HTMLDivElement | null = null;

  /**
   * Create the highlighter container on `<html>`, not `<body>`: games put
   * `transform: scale()` on `<body>` (or `#app`) for responsive fit, and a
   * container inside the scaled body is itself scaled, so a `position: fixed`
   * box set to an element's (already scaled) screen rect is scaled a second
   * time and lands off target. `<html>` sits above the transformed body, so a
   * fixed box there uses true viewport coordinates.
   */
  create(): void {
    if (this.container) return;
    const host = document.documentElement;
    if (!host) return;

    this.container = document.createElement('div');
    this.container.id = id('dom-highlighter');
    // Full-viewport, non-interactive, above everything. No `transform` here — a
    // transform would make this a containing block and re-introduce the scaling
    // trap; on `<html>` a plain fixed container already sits in viewport space.
    this.container.style.cssText = `
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147483000;
    `;
    host.appendChild(this.container);
  }

  /**
   * Show selection highlight around a DOM element
   */
  showSelection(el: HTMLElement, label: string): void {
    if (!this.container) return;
    this.clearSelection();

    // Container is on `<html>` (above any body transform), `position: fixed`, so
    // a `position: fixed` box at the element's screen rect lands exactly on it —
    // true viewport coords, no double-scale.
    const rect = el.getBoundingClientRect();
    const x = rect.left;
    const y = rect.top;

    // Selection box
    this.selectionEl = document.createElement('div');
    this.selectionEl.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 3px solid ${DEFAULT_OVERLAY_COLORS.selected};
      border-radius: 2px;
      pointer-events: none;
      box-sizing: border-box;
    `;

    // Corner markers
    const corners = this.createCornerMarkers(DEFAULT_OVERLAY_COLORS.selected);
    for (const corner of corners) {
      this.selectionEl.appendChild(corner);
    }

    this.container.appendChild(this.selectionEl);

    // No text label on SELECTION — selecting always opens the edit panel, whose
    // header already names the element ("HUD BUTTON: …"), so an on-scene label
    // here just duplicated it. The box + corner brackets still show WHAT is
    // selected; `label` is kept in the signature (callers pass it) but unused.
    // (Hover keeps its label — hover has no panel to name the element.)
    void label;
  }

  /**
   * Show hover highlight around a DOM element
   */
  showHover(el: HTMLElement, label: string): void {
    if (!this.container) return;
    this.clearHover();

    const rect = el.getBoundingClientRect();

    // Guard against a zero/degenerate rect. A detached, `display:none`, or
    // not-yet-laid-out element reports {0,0,0,0}; drawing a hover box there
    // pins a 0×0 fixed box at the viewport origin, and its (non-empty) text
    // label then renders as a stuck black chip in the TOP-LEFT corner that
    // nothing clears until the next mousemove — which may never come if the
    // pointer left the game (#stuck-topleft-label). Skip drawing entirely.
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = rect.left;
    const y = rect.top;

    this.hoverEl = document.createElement('div');
    this.hoverEl.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px dashed ${DEFAULT_OVERLAY_COLORS.hovered};
      border-radius: 2px;
      pointer-events: none;
      box-sizing: border-box;
    `;
    this.container.appendChild(this.hoverEl);

    // Label for hover — use local coords (0, -24) since it's a child of hoverEl
    // (which is `position: fixed`, so absolute children are relative to it).
    const hoverLabel = this.createLabel(0, -24, label, false);
    this.hoverEl.appendChild(hoverLabel);
  }

  /**
   * Clear selection highlight only
   */
  clearSelection(): void {
    if (this.selectionEl) {
      this.selectionEl.remove();
      this.selectionEl = null;
    }
    if (this.labelEl) {
      this.labelEl.remove();
      this.labelEl = null;
    }
  }

  /**
   * Clear hover highlight only
   */
  clearHover(): void {
    if (this.hoverEl) {
      this.hoverEl.remove();
      this.hoverEl = null;
    }
  }

  /**
   * Clear all highlights
   */
  clear(): void {
    this.clearSelection();
    this.clearHover();
  }

  /**
   * Remove the entire highlighter from DOM
   */
  remove(): void {
    this.clear();
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  /**
   * Check if highlighter is active
   */
  isActive(): boolean {
    return this.container !== null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private createLabel(
    x: number,
    y: number,
    text: string,
    isSelected: boolean,
    fixed = false,
  ): HTMLDivElement {
    const label = document.createElement('div');
    const indicatorColor = isSelected ? DEFAULT_OVERLAY_COLORS.selected : DEFAULT_OVERLAY_COLORS.hovered;

    // Selection label is a direct child of the fixed container → fixed (viewport
    // coords). Hover label is a child of the fixed hover box → absolute (local).
    label.style.cssText = `
      position: ${fixed ? 'fixed' : 'absolute'};
      left: ${Math.max(0, x)}px;
      top: ${Math.max(0, y)}px;
      background: ${DEFAULT_OVERLAY_COLORS.label};
      color: ${DEFAULT_OVERLAY_COLORS.labelText};
      font: 12px monospace;
      padding: 2px 6px;
      border-left: 3px solid ${indicatorColor};
      white-space: nowrap;
      pointer-events: none;
    `;
    label.textContent = text;
    return label;
  }

  private createCornerMarkers(color: string): HTMLDivElement[] {
    const size = 10;
    const thickness = 3;
    const corners: HTMLDivElement[] = [];

    const positions = [
      // top-left
      { left: -1, top: -1, bTop: thickness, bLeft: thickness, bRight: 0, bBottom: 0, w: size, h: size },
      // top-right
      { right: -1, top: -1, bTop: thickness, bRight: thickness, bLeft: 0, bBottom: 0, w: size, h: size },
      // bottom-left
      { left: -1, bottom: -1, bBottom: thickness, bLeft: thickness, bRight: 0, bTop: 0, w: size, h: size },
      // bottom-right
      { right: -1, bottom: -1, bBottom: thickness, bRight: thickness, bLeft: 0, bTop: 0, w: size, h: size },
    ];

    for (const pos of positions) {
      const corner = document.createElement('div');
      corner.style.cssText = `
        position: absolute;
        width: ${pos.w}px;
        height: ${pos.h}px;
        border-color: ${color};
        border-style: solid;
        border-width: ${pos.bTop || 0}px ${pos.bRight || 0}px ${pos.bBottom || 0}px ${pos.bLeft || 0}px;
        pointer-events: none;
        ${'left' in pos ? `left: ${pos.left}px;` : ''}
        ${'right' in pos ? `right: ${pos.right}px;` : ''}
        ${'top' in pos ? `top: ${pos.top}px;` : ''}
        ${'bottom' in pos ? `bottom: ${pos.bottom}px;` : ''}
      `;
      corners.push(corner);
    }

    return corners;
  }
}
