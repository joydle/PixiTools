/**
 * PixiJS Inspector
 *
 * Visual object inspection for PixiJS games.
 * Uses constructor hooking to track objects and bounds-based hit testing.
 */

import {
  InspectorBase,
  InspectorConfig,
  ObjectMetadata,
  SelectionCandidate,
  Bounds,
  SceneTreeNode,
  Position2D,
  Rotation2D,
  Scale2D,
  pixiProps,
} from './core';
import { TRACK, TRACK_BUFFER } from '../brand';

// PixiJS type declarations
declare global {
  interface Window {
    PIXI?: PixiNamespace;
    __PIXI_APP__?: PixiApplication;
    __PIXI_STAGE__?: PixiContainer;
    app?: PixiApplication;
    game?: PixiApplication;
    pixiApp?: PixiApplication;
  }
}

interface PixiNamespace {
  Container: new (...args: unknown[]) => PixiContainer;
  Sprite: new (...args: unknown[]) => PixiSprite;
  Graphics: new (...args: unknown[]) => PixiGraphics;
  Text: new (...args: unknown[]) => PixiText;
  AnimatedSprite: new (...args: unknown[]) => PixiAnimatedSprite;
  app?: PixiApplication;
}

interface PixiBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PixiContainerMetadata {
  [key: string]: unknown;
}

interface PixiContainer {
  label?: string;
  name?: string;
  position: { x: number; y: number };
  rotation: number;
  scale: { x: number; y: number };
  alpha: number;
  visible: boolean;
  children: PixiContainer[];
  parent?: PixiContainer | null;
  zIndex?: number;
  inspectorLayer?: number;
  metadata?: PixiContainerMetadata | null;
  constructor: { name: string };
  getBounds(): PixiBounds;
  containsPoint?(point: { x: number; y: number }): boolean;
}

interface PixiSprite extends PixiContainer {
  texture?: { label?: string };
}

interface PixiGraphics extends PixiContainer {}
interface PixiText extends PixiContainer {}
interface PixiAnimatedSprite extends PixiContainer {}

interface PixiTicker {
  stop(): void;
  start(): void;
  started: boolean;
}

interface PixiApplication {
  stage: PixiContainer;
  renderer: { width: number; height: number; render(stage: PixiContainer): void };
  ticker: PixiTicker;
}

export class PixiInspector extends InspectorBase {
  readonly engineType = 'pixi' as const;

  private app: PixiApplication | null = null;
  private stage: PixiContainer | null = null;
  private hooksInstalled = false;

  constructor(config?: InspectorConfig) {
    super(config);
    this.init();
  }

  // ============================================================================
  // Abstract Method Implementations
  // ============================================================================

  protected findObjectsAt(screenX: number, screenY: number): SelectionCandidate[] {
    // Find the app/stage
    const app = this.findPixiApp();
    if (!app || !app.stage) {
      this.log('findObjectsAt: No PIXI app/stage found');
      return [];
    }

    const canvas = this.getCanvas();
    if (!canvas) {
      this.log('findObjectsAt: No canvas found');
      return [];
    }

    // Convert screen coords to STAGE coords.
    // With autoDensity (common), canvas.width = cssWidth * DPR but getBounds()
    // returns stage coords (CSS pixels). Divide out the renderer resolution
    // so we compare apples-to-apples with getBounds().
    const rect = canvas.getBoundingClientRect();
    const resolution = (app as any).renderer?.resolution || 1;
    const x = (screenX - rect.left) * (canvas.width / rect.width) / resolution;
    const y = (screenY - rect.top) * (canvas.height / rect.height) / resolution;

    const candidates: SelectionCandidate[] = [];
    const canvasArea = (canvas.width / resolution) * (canvas.height / resolution);

    // Recursively search stage and collect all hits
    const searchContainer = (container: PixiContainer, depth: number = 0) => {
      if (!container.visible || depth > 20) return;

      // Check children first (reverse order for top-to-bottom rendering)
      if (container.children) {
        for (let i = container.children.length - 1; i >= 0; i--) {
          searchContainer(container.children[i], depth + 1);
        }
      }

      // Only check objects we're tracking
      if (this.tracker.has(container) && this.hitTest(container, x, y)) {
        const bounds = this.getObjectBoundsInternal(container);
        if (!bounds) return;

        const area = bounds.width * bounds.height;
        const layerPriority = this.detectLayerPriority(container, bounds, canvasArea);

        candidates.push({
          obj: container,
          layer: layerPriority,
          depth,
          area,
          zIndex: container.zIndex || 0,
        });
      }
    };

    searchContainer(app.stage, 0);

    this.log(`findObjectsAt(${Math.round(x)},${Math.round(y)}): ${candidates.length} candidates from scene tree`);

    // Intelligent sorting: layer priority > z-index > depth > size
    candidates.sort((a, b) => {
      // Priority 1: Layer priority (UI > Interactive > Environment > Background)
      if (a.layer !== b.layer) return b.layer - a.layer;

      // Priority 2: Z-index (if set by game)
      const aZ = (a as { zIndex?: number }).zIndex || 0;
      const bZ = (b as { zIndex?: number }).zIndex || 0;
      if (aZ !== bZ) return bZ - aZ;

      // Priority 3: Hierarchy depth (deeper = more specific)
      const aD = (a as { depth?: number }).depth || 0;
      const bD = (b as { depth?: number }).depth || 0;
      if (aD !== bD) return bD - aD;

      // Priority 4: Size (smaller = more specific)
      const aA = (a as { area?: number }).area || 0;
      const bA = (b as { area?: number }).area || 0;
      return aA - bA;
    });

    return candidates;
  }

  protected getObjectMetadata(obj: unknown): ObjectMetadata {
    const container = obj as PixiContainer;
    const tracked = this.tracker.get(container);

    let bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
    try {
      const pBounds = container.getBounds();
      bounds = {
        x: pBounds.x,
        y: pBounds.y,
        width: pBounds.width,
        height: pBounds.height,
      };
    } catch {
      // Object may have been destroyed
    }

    const position: Position2D = {
      x: container.position.x,
      y: container.position.y,
    };

    const rotation: Rotation2D = {
      rotation: container.rotation,
    };

    const scale: Scale2D = {
      x: container.scale.x,
      y: container.scale.y,
    };

    // Use label if available (set by game code), otherwise metadata type
    const displayType = container.label || tracked?.type || container.constructor.name;

    return {
      type: displayType,
      typeName: container.constructor.name,
      layer: this.detectLayerPriority(container, bounds, this.getCanvas()?.width || 800 * (this.getCanvas()?.height || 600)),
      position,
      rotation,
      scale,
      alpha: container.alpha,
      visible: container.visible,
      childCount: container.children?.length || 0,
      bounds,
      parentLabel: container.parent?.label || 'Stage',
      sourceFile: tracked?.source?.file || null,
      sourceLine: tracked?.source?.line || null,
      sourceColumn: tracked?.source?.column || null,
      sourceLineRange: tracked?.source?.line
        ? this.stackParser.getCodeRange(tracked.source.line)
        : null,
      ...pixiProps(container),
    };
  }

  protected hookConstructors(): void {
    const tracker = this.tracker;
    const stackParser = this.stackParser;

    // Drain what the hooked pixi build buffered before the inspector started:
    // a game makes its first objects as its module loads, attach() comes later.
    const buffer = (window as any)[TRACK_BUFFER];
    if (buffer && Array.isArray(buffer)) {
      for (const entry of buffer) {
        tracker.track(entry.obj, entry.type, null);
      }
      this.log(`Drained ${buffer.length} buffered objects from early registration`);
      delete (window as any)[TRACK_BUFFER];
    }

    // Replace the buffering callback with the real one (or register fresh).
    // From now on, objects are tracked immediately with source locations.
    (window as any)[TRACK] = (obj: object, type: string) => {
      const source = stackParser.parse();
      tracker.track(obj, type, source);
    };

    // Where window.PIXI can be written (a UMD pixi), wrap its constructors too.
    // With the hooked build that is not needed: it calls the track hook itself.
    // No retry loop — the base class waitForScene() handles scene detection independently.
    if (typeof window.PIXI !== 'undefined' && !this.hooksInstalled) {
      this.hooksInstalled = true;
      this.hookPixiConstructors(window.PIXI);
    }
  }

  /**
   * Fallback: hook PIXI constructors at runtime (for standalone/UMD usage without hooked bundle)
   */
  private hookPixiConstructors(PIXI: PixiNamespace): void {
    const tracker = this.tracker;
    const stackParser = this.stackParser;
    const inferType = this.inferObjectType.bind(this);

    try {
      const descriptor = Object.getOwnPropertyDescriptor(PIXI, 'Container');
      if (descriptor && !descriptor.writable && !descriptor.configurable) {
        this.log('PIXI is a frozen module namespace: source lines need the hooked build');
        return;
      }

      // Hook Container
      const OriginalContainer = PIXI.Container;
      (PIXI as unknown as Record<string, unknown>).Container = function(this: PixiContainer, ...args: unknown[]) {
        const instance = Reflect.construct(OriginalContainer, args, new.target || OriginalContainer);
        const source = stackParser.parse();
        tracker.track(instance, inferType(instance), source);
        return instance;
      };
      (PIXI.Container as unknown as { prototype: unknown }).prototype = OriginalContainer.prototype;
      Object.setPrototypeOf(PIXI.Container, OriginalContainer);

      // Hook Sprite
      const OriginalSprite = PIXI.Sprite;
      (PIXI as unknown as Record<string, unknown>).Sprite = function(this: PixiSprite, ...args: unknown[]) {
        const instance = Reflect.construct(OriginalSprite, args, new.target || OriginalSprite);
        const source = stackParser.parse();
        const type = instance.label || instance.texture?.label || 'sprite';
        tracker.track(instance, type, source);
        return instance;
      };
      (PIXI.Sprite as unknown as { prototype: unknown }).prototype = OriginalSprite.prototype;
      Object.setPrototypeOf(PIXI.Sprite, OriginalSprite);

      // Hook Graphics
      const OriginalGraphics = PIXI.Graphics;
      (PIXI as unknown as Record<string, unknown>).Graphics = function(this: PixiGraphics, ...args: unknown[]) {
        const instance = Reflect.construct(OriginalGraphics, args, new.target || OriginalGraphics);
        const source = stackParser.parse();
        tracker.track(instance, instance.label || 'graphics', source);
        return instance;
      };
      (PIXI.Graphics as unknown as { prototype: unknown }).prototype = OriginalGraphics.prototype;
      Object.setPrototypeOf(PIXI.Graphics, OriginalGraphics);

      // Hook Text
      const OriginalText = PIXI.Text;
      (PIXI as unknown as Record<string, unknown>).Text = function(this: PixiText, ...args: unknown[]) {
        const instance = Reflect.construct(OriginalText, args, new.target || OriginalText);
        const source = stackParser.parse();
        tracker.track(instance, instance.label || 'text', source);
        return instance;
      };
      (PIXI.Text as unknown as { prototype: unknown }).prototype = OriginalText.prototype;
      Object.setPrototypeOf(PIXI.Text, OriginalText);

      // Hook AnimatedSprite
      const OriginalAnimatedSprite = PIXI.AnimatedSprite;
      (PIXI as unknown as Record<string, unknown>).AnimatedSprite = function(this: PixiAnimatedSprite, ...args: unknown[]) {
        const instance = Reflect.construct(OriginalAnimatedSprite, args, new.target || OriginalAnimatedSprite);
        const source = stackParser.parse();
        tracker.track(instance, instance.label || 'animated_sprite', source);
        return instance;
      };
      (PIXI.AnimatedSprite as unknown as { prototype: unknown }).prototype = OriginalAnimatedSprite.prototype;
      Object.setPrototypeOf(PIXI.AnimatedSprite, OriginalAnimatedSprite);

      this.log('PixiJS runtime hooks installed (fallback mode)');
    } catch (e) {
      this.log(`PIXI cannot be wrapped (${e}): source lines need the hooked build`);
    }
  }

  protected isSceneReady(): boolean {
    // Try to find a PIXI app (works with both namespace and named imports)
    const app = this.findPixiApp();
    if (app && app.stage) return true;

    // Fallback: look for any canvas (supports PixiJS v8 named imports where window.PIXI isn't set)
    const canvas = this.findGameCanvas();
    return !!canvas;
  }

  protected getCanvas(): HTMLCanvasElement | null {
    return this.findGameCanvas();
  }

  protected getObjectBounds(obj: unknown): Bounds | null {
    return this.getObjectBoundsInternal(obj as PixiContainer);
  }

  protected buildSceneTree(): SceneTreeNode | null {
    const app = this.findPixiApp();
    if (!app?.stage) return null;

    const tree = this.buildNodeTree(app.stage, 0);
    // The app's own root rarely has a label: call it what it is.
    if (tree && !app.stage.label) tree.name = 'stage';
    return tree;
  }

  // ============================================================================
  // Scene Ready Handler Override
  // ============================================================================

  protected override onSceneReady(): void {
    this.app = this.findPixiApp();
    this.stage = this.app?.stage || null;

    if (this.stage) {
      // Retroactively track any scene objects that weren't caught by the
      // hooked constructors (e.g., PIXI-internal containers, stage itself).
      const retroCount = this.retroactiveTrack(this.stage, 0);
      if (retroCount > 0) {
        this.log(`Retroactively tracked ${retroCount} scene objects`);
      }
      this.log(`Stage ready: ${this.tracker.getCount()} tracked objects`);
    } else {
      this.log('No explicit stage found, using canvas-based detection');
    }

    super.onSceneReady();
  }

  /**
   * Walk the scene tree and track any untracked objects.
   * Safety net for objects created by PIXI internals or before hooks were active.
   */
  private retroactiveTrack(container: PixiContainer, depth: number): number {
    if (depth > 15) return 0;
    let count = 0;

    if (!this.tracker.has(container)) {
      const type = container.label || container.constructor?.name || 'container';
      this.tracker.track(container, type, null);
      count++;
    }

    if (container.children) {
      for (const child of container.children) {
        count += this.retroactiveTrack(child, depth + 1);
      }
    }

    return count;
  }

  // ============================================================================
  // Pause/Resume — stop PIXI ticker to freeze the game without game code changes
  // ============================================================================

  private tickerWasRunning = false;

  public override pause(): void {
    // Stop the PIXI ticker BEFORE base pause (freezes game loop immediately)
    const app = this.app || this.findPixiApp();
    if (app?.ticker) {
      this.tickerWasRunning = app.ticker.started;
      if (this.tickerWasRunning) {
        app.ticker.stop();
        this.log('PIXI ticker stopped');
      }
    }

    // Re-scan stage tree at pause time to catch objects added after initial
    // onSceneReady (e.g., objects created in React useEffect or during gameplay).
    const stage = app?.stage || this.stage;
    if (stage) {
      const retroCount = this.retroactiveTrack(stage, 0);
      if (retroCount > 0) {
        this.log(`Tracked ${retroCount} new objects at pause time`);
      }
      this.log(`Total tracked: ${this.tracker.getCount()} objects`);
    }

    super.pause();
  }

  public override resume(): void {
    super.resume();

    // Restart the PIXI ticker AFTER base resume
    const app = this.app || this.findPixiApp();
    if (app?.ticker && this.tickerWasRunning) {
      app.ticker.start();
      this.log('PIXI ticker restarted');
    }
  }

  // ============================================================================
  // PixiJS Specific Helpers
  // ============================================================================

  /**
   * Find the PIXI Application instance from various common locations
   */
  private findPixiApp(): PixiApplication | null {
    // Check explicit globals first
    if (window.__PIXI_APP__) return window.__PIXI_APP__;

    // Check common variable names used by games
    const w = window as unknown as Record<string, unknown>;
    if (w.app && this.isPixiApp(w.app)) return w.app as PixiApplication;
    if (w.game && this.isPixiApp(w.game)) return w.game as PixiApplication;
    if (w.pixiApp && this.isPixiApp(w.pixiApp)) return w.pixiApp as PixiApplication;

    // Check if PIXI global has an app reference
    if (window.PIXI) {
      const pixi = window.PIXI as unknown as Record<string, unknown>;
      if (pixi.app && this.isPixiApp(pixi.app)) return pixi.app as PixiApplication;
    }

    // Scan window for PIXI.Application instances
    for (const key in window) {
      try {
        const val = w[key];
        if (val && this.isPixiApp(val)) {
          return val as PixiApplication;
        }
      } catch {
        // Skip inaccessible properties
      }
    }

    return null;
  }

  /**
   * Check if an object looks like a PIXI Application
   */
  private isPixiApp(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const app = obj as Record<string, unknown>;
    // PIXI.Application has stage, renderer, and ticker
    return !!(app.stage && app.renderer && app.ticker);
  }

  /**
   * Find the PIXI game canvas
   */
  private findGameCanvas(): HTMLCanvasElement | null {
    const canvases = document.querySelectorAll('canvas');

    // Look for canvas with PIXI markers
    for (const canvas of canvases) {
      const c = canvas as HTMLCanvasElement & {
        __pixi_app?: unknown;
        __PIXI_APP__?: unknown;
      };
      if (c.__pixi_app || c.__PIXI_APP__ || canvas.getAttribute('data-pixi')) {
        return canvas;
      }
    }

    // Fallback to first canvas
    return canvases[0] || null;
  }

  /**
   * Hit test - check if point is inside object bounds
   */
  private hitTest(container: PixiContainer, x: number, y: number): boolean {
    const bounds = this.getObjectBoundsInternal(container);
    if (!bounds) return false;

    // Skip empty containers (width/height = 0)
    if (bounds.width === 0 || bounds.height === 0) {
      return false;
    }

    return (
      x >= bounds.x &&
      x <= bounds.x + bounds.width &&
      y >= bounds.y &&
      y <= bounds.y + bounds.height
    );
  }

  /**
   * Get object bounds
   */
  private getObjectBoundsInternal(container: PixiContainer): Bounds | null {
    try {
      if (typeof container.getBounds === 'function') {
        const b = container.getBounds();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }
    } catch {
      // Object may have been destroyed
    }
    return null;
  }

  /**
   * Detect layer priority for sorting
   * Higher priority = more likely to be what user wants to select
   */
  private detectLayerPriority(container: PixiContainer, bounds: Bounds, canvasArea: number): number {
    // 1. Explicit override (a game can set obj.inspectorLayer = N)
    if (typeof container.inspectorLayer === 'number') {
      return container.inspectorLayer;
    }

    // 2. Size-based heuristic (100% deterministic)
    const objArea = bounds.width * bounds.height;

    // Very large objects (>50% canvas) = likely background
    if (objArea > canvasArea * 0.5) {
      return 50;
    }

    // Small objects (<2000px² ~= 45×45) = likely interactive (players, UI, pickups)
    if (objArea < 2000) {
      return 500;
    }

    // 3. Default priority for medium-sized objects
    return 200;
  }

  /**
   * Infer object type from constructor name and properties
   */
  private inferObjectType(obj: PixiContainer): string {
    // Priority 1: Use obj.label if it exists
    if (obj.label && obj.label.trim() !== '') {
      return obj.label;
    }

    // Priority 2: Check parent label for context
    if (obj.parent?.label) {
      const parentLabel = obj.parent.label.toLowerCase();
      if (parentLabel.includes('player')) return 'Player';
      if (parentLabel.includes('enemy')) return 'Enemy';
      if (parentLabel.includes('car')) return 'Car';
      if (parentLabel.includes('bot')) return 'Bot';
    }

    // Fallback to constructor name
    return obj.constructor.name;
  }

  private buildNodeTree(node: PixiContainer, depth: number): SceneTreeNode | null {
    if (!node || depth > 15) return null;

    const children: SceneTreeNode[] = [];

    if (node.children) {
      for (const child of node.children) {
        const childTree = this.buildNodeTree(child, depth + 1);
        if (childTree) children.push(childTree);
      }
    }

    return {
      name: node.label || this.typeName(node),
      type: this.typeName(node),
      children,
    };
  }

  /** The class name, or "Container" where a minified Pixi build has shortened it to a letter or two. */
  private typeName(node: PixiContainer): string {
    const name = node.constructor?.name ?? '';
    return name.length > 2 ? name : 'Container';
  }

  protected findObjectByName(name: string): unknown | null {
    // The scene tree's names lead back here (SELECT_OBJECT, a host's scene list).
    const stage = (this.app || this.findPixiApp())?.stage || this.stage;
    return stage ? this.resolveObject(name, stage) : null;
  }

  protected override findObjectByPath(path: number[]): unknown | null {
    // The same root and children `buildSceneTree` walks, so an index is a place.
    let node: PixiContainer | undefined = (this.app || this.findPixiApp())?.stage || this.stage || undefined;
    for (const index of path) node = node?.children?.[index];
    return node ?? null;
  }

  protected override forEachSceneObject(visit: (obj: unknown) => void): void {
    const stage = (this.app || this.findPixiApp())?.stage;
    const walk = (node: PixiContainer, depth: number) => {
      if (depth > 30) return;
      visit(node);
      for (const child of node.children || []) walk(child, depth + 1);
    };
    if (stage) walk(stage, 0);
  }

  /**
   * Pan + zoom the STAGE so the named object is centered and comfortably framed.
   * The PIXI ticker is stopped while paused, so we drive `renderer.render(stage)`
   * ourselves each frame (Pixi doesn't patch rAF, so `window.requestAnimationFrame`
   * is safe here). Mutating `stage.position`/`stage.scale` is a viewport transform
   * that the game overwrites on resume — a non-destructive inspection convenience.
   * `prefers-reduced-motion` → snap. Unresolved target → no-op (games with their
   * own FOCUS_OBJECT listener are unaffected; this augments).
   */
  protected focusOnObject(target: string): void {
    const app = this.app || this.findPixiApp();
    const stage = app?.stage || this.stage;
    if (!app || !stage || typeof app.renderer?.render !== 'function') {
      this.log(`focusOnObject: pixi refs unavailable`);
      return;
    }
    const obj = this.resolveObject(target, stage);
    if (!obj) {
      this.log(`focusOnObject: "${target}" not found on stage`);
      return;
    }

    // Global bounds of the object (screen-space, current transform).
    const b = obj.getBounds();
    if (!b || b.width <= 0 || b.height <= 0) {
      this.log(`focusOnObject: "${target}" has empty bounds`);
      return;
    }
    const vw = app.renderer.width;
    const vh = app.renderer.height;
    // Zoom to fit the object in ~55% of the viewport (framed, not cramped),
    // clamped so we never zoom past 3x or below the current scale meaningfully.
    const objCx = b.x + b.width / 2;
    const objCy = b.y + b.height / 2;
    const fit = Math.min((vw * 0.55) / b.width, (vh * 0.55) / b.height);
    const startScale = stage.scale.x || 1;
    const endScale = Math.max(0.2, Math.min(startScale * fit, startScale * 3));

    // We want the object's global center to land at the viewport center after
    // scaling about the stage origin. Global point g maps under stage transform
    // (pos + scale*local); solving for the new stage.position that centers the
    // object at (vw/2, vh/2) given the scale change factor k = endScale/startScale:
    //   newPos = viewportCenter - k * (objCenter - oldPos)
    const k = endScale / startScale;
    const startPos = { x: stage.position.x, y: stage.position.y };
    const endPos = {
      x: vw / 2 - k * (objCx - startPos.x),
      y: vh / 2 - k * (objCy - startPos.y),
    };

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const applyPose = (px: number, py: number, s: number) => {
      stage.position.x = px;
      stage.position.y = py;
      stage.scale.x = s;
      stage.scale.y = s;
      app.renderer.render(stage);
    };

    if (prefersReduced) {
      applyPose(endPos.x, endPos.y, endScale);
      return;
    }

    const durationMs = 420;
    let startTs = 0;
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const step = (ts: number) => {
      if (!startTs) startTs = ts;
      const t = Math.min(1, (ts - startTs) / durationMs);
      const e = easeInOut(t);
      applyPose(
        startPos.x + (endPos.x - startPos.x) * e,
        startPos.y + (endPos.y - startPos.y) * e,
        startScale + (endScale - startScale) * e,
      );
      if (t < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
    this.log(`focusOnObject: framing "${obj.label || obj.name || obj.constructor.name}"`);
  }

  /**
   * Resolve a FOCUS_OBJECT target to a live display object. Prefers the current
   * selection when its label/name matches, else the first stage node whose
   * label or name equals the target.
   */
  private resolveObject(target: string, stage: PixiContainer): PixiContainer | null {
    const sel = this.selectedObject as PixiContainer | null;
    if (sel && typeof sel === 'object' && 'getBounds' in sel && (sel.label === target || sel.name === target)) {
      return sel;
    }
    let found: PixiContainer | null = null;
    const walk = (node: PixiContainer) => {
      if (found) return;
      if (node.label === target || node.name === target) {
        found = node;
        return;
      }
      for (const child of node.children) walk(child);
    };
    walk(stage);
    return found;
  }
}
