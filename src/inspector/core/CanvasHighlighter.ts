/**
 * CanvasHighlighter — draws selection/hover highlight boxes for CANVAS objects
 * (Pixi sprites, Three.js meshes) onto a transparent overlay canvas placed over
 * the game canvas.
 *
 * The sibling of `DomHighlighter`, which draws the same highlights for DOM/HUD
 * elements. Together they are the inspector's two highlight renderers — one per
 * target surface (canvas vs DOM). Keep their transform/positioning behavior in
 * sync (both mount on `document.documentElement` in true viewport coords so a
 * game ancestor's `transform: scale()` can't misposition the box).
 */

import { Bounds, OverlayColors, DEFAULT_OVERLAY_COLORS } from './types';
import { id } from '../../brand';

export interface HighlightedObject {
  bounds: Bounds;
  label?: string;
  isSelected?: boolean;
  isHovered?: boolean;
}

export class CanvasHighlighter {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private colors: OverlayColors;
  private animationFrame: number | null = null;
  private gameCanvas: HTMLCanvasElement | null = null;

  constructor(colors: OverlayColors = DEFAULT_OVERLAY_COLORS) {
    this.colors = colors;
  }

  /**
   * Create the overlay canvas on top of the game canvas
   */
  create(gameCanvas: HTMLCanvasElement | null): void {
    if (!gameCanvas) return;
    if (this.canvas) this.remove();

    this.canvas = document.createElement('canvas');
    this.canvas.id = id('inspector-overlay');
    this.gameCanvas = gameCanvas;
    this.positionCanvas();

    this.ctx = this.canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    // Scale context so we draw in CSS/stage pixels, canvas renders at DPR
    if (this.ctx) this.ctx.scale(dpr, dpr);

    // Mount on <html> (documentElement), NOT the game-canvas parent — real games
    // put `transform: scale()` on <body>/#app for responsive fit. Mounting the
    // overlay in the scaled parent and sizing it from the game's screen rect
    // double-transforms it, so the box lands off the object (as for the DOM
    // highlighter). `position: fixed` on <html> uses true viewport coords, so the
    // overlay sits exactly on the game canvas and its internal-coord drawing
    // aligns with the engine's object bounds.
    document.documentElement.appendChild(this.canvas);

    this.setupResizeObserver(gameCanvas);
  }

  /** Size + place the overlay canvas over the game canvas in TRUE viewport coords. */
  private positionCanvas(): void {
    if (!this.canvas || !this.gameCanvas) return;
    const rect = this.gameCanvas.getBoundingClientRect(); // screen rect (post-transform)
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      pointer-events: none;
      z-index: 9999;
    `;
    // Re-apply the DPR context scale after a width/height change resets it.
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
  }

  /**
   * Remove the overlay canvas
   */
  remove(): void {
    this.shown = [];
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
      this.ctx = null;
    }
    this.gameCanvas = null;
  }

  /**
   * Clear the overlay
   */
  clear(): void {
    if (!this.ctx || !this.canvas) return;
    // canvas.width/height are DPR-scaled; context is also scaled by DPR.
    // Use save/restore to clear in raw pixel space.
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  /**
   * Render highlighted objects
   */
  /** What is drawn now: a resize clears the canvas, so it is drawn again after one. */
  private shown: HighlightedObject[] = [];

  render(objects: HighlightedObject[]): void {
    this.shown = objects;
    if (!this.ctx || !this.canvas) return;

    this.clear();

    for (const obj of objects) {
      if (obj.isSelected) {
        this.drawSelection(obj.bounds, obj.label);
      } else if (obj.isHovered) {
        this.drawHover(obj.bounds, obj.label);
      }
    }
  }

  /**
   * Draw selection highlight (solid border)
   */
  private drawSelection(bounds: Bounds, label?: string): void {
    if (!this.ctx) return;

    const { x, y, width, height } = bounds;

    // Draw selection box
    this.ctx.strokeStyle = this.colors.selected;
    this.ctx.lineWidth = 3;
    this.ctx.setLineDash([]);
    this.ctx.strokeRect(x, y, width, height);

    // Draw corner markers
    const cornerSize = 10;
    this.ctx.fillStyle = this.colors.selected;

    // Top-left
    this.ctx.fillRect(x - 2, y - 2, cornerSize, 4);
    this.ctx.fillRect(x - 2, y - 2, 4, cornerSize);

    // Top-right
    this.ctx.fillRect(x + width - cornerSize + 2, y - 2, cornerSize, 4);
    this.ctx.fillRect(x + width - 2, y - 2, 4, cornerSize);

    // Bottom-left
    this.ctx.fillRect(x - 2, y + height - 2, cornerSize, 4);
    this.ctx.fillRect(x - 2, y + height - cornerSize + 2, 4, cornerSize);

    // Bottom-right
    this.ctx.fillRect(x + width - cornerSize + 2, y + height - 2, cornerSize, 4);
    this.ctx.fillRect(x + width - 2, y + height - cornerSize + 2, 4, cornerSize);

    // Draw label
    if (label) {
      this.drawLabel(x, y - 25, label, true);
    }
  }

  /**
   * Draw hover highlight (dashed border)
   */
  private drawHover(bounds: Bounds, label?: string): void {
    if (!this.ctx) return;

    const { x, y, width, height } = bounds;

    // Draw hover box with dashed line
    this.ctx.strokeStyle = this.colors.hovered;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 5]);
    this.ctx.strokeRect(x, y, width, height);

    // Draw label
    if (label) {
      this.drawLabel(x, y - 20, label, false);
    }
  }

  /**
   * Draw a label above the object
   */
  private drawLabel(x: number, y: number, text: string, isSelected: boolean): void {
    if (!this.ctx) return;

    const padding = 4;
    const fontSize = 12;

    this.ctx.font = `${fontSize}px monospace`;
    const metrics = this.ctx.measureText(text);
    const labelWidth = metrics.width + padding * 2;
    const labelHeight = fontSize + padding * 2;

    // Ensure label stays in bounds (canvas.width is DPR-scaled, divide back to CSS coords)
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = (this.canvas?.width || 0) / dpr;
    const adjustedX = Math.max(0, Math.min(x, cssWidth - labelWidth));
    const adjustedY = Math.max(labelHeight, y);

    // Draw background
    this.ctx.fillStyle = this.colors.label;
    this.ctx.fillRect(adjustedX, adjustedY - labelHeight, labelWidth, labelHeight);

    // Draw text
    this.ctx.fillStyle = this.colors.labelText;
    this.ctx.fillText(text, adjustedX + padding, adjustedY - padding);

    // Draw indicator if selected
    if (isSelected) {
      this.ctx.fillStyle = this.colors.selected;
      this.ctx.fillRect(adjustedX, adjustedY - labelHeight, 3, labelHeight);
    }
  }

  /**
   * Draw dotted connection lines (for nested objects)
   */
  drawConnectionLine(from: Bounds, to: Bounds): void {
    if (!this.ctx) return;

    const fromCenter = {
      x: from.x + from.width / 2,
      y: from.y + from.height / 2,
    };

    const toCenter = {
      x: to.x + to.width / 2,
      y: to.y + to.height / 2,
    };

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([3, 3]);

    this.ctx.beginPath();
    this.ctx.moveTo(fromCenter.x, fromCenter.y);
    this.ctx.lineTo(toCenter.x, toCenter.y);
    this.ctx.stroke();
  }

  /**
   * Set up resize observer to keep overlay in sync with game canvas
   */
  private setupResizeObserver(gameCanvas: HTMLCanvasElement): void {
    const resizeObserver = new ResizeObserver(() => {
      // Re-place + re-size the overlay in true viewport coords whenever the game
      // canvas resizes (positionCanvas reads the current screen rect).
      if (this.canvas && this.gameCanvas) {
        this.positionCanvas();
        this.render(this.shown);
      }
    });

    resizeObserver.observe(gameCanvas);
  }

  /**
   * Update overlay colors
   */
  setColors(colors: Partial<OverlayColors>): void {
    this.colors = { ...this.colors, ...colors };
  }

  /**
   * Check if overlay is active
   */
  isActive(): boolean {
    return this.canvas !== null;
  }
}
