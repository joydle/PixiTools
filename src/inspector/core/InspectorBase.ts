/**
 * Inspector Base - Abstract base class for all engine inspectors
 *
 * Provides shared functionality for pause/resume, object selection,
 * overlay rendering, and message handling.
 */

import {
  EngineType,
  ObjectMetadata,
  SelectionCandidate,
  TrackedObject,
  Bounds,
  SceneTreeNode,
  SourceRef,
  ResolvedSource,
  RuntimeError,
} from './types';
import { StackParser } from './StackParser';
import { MessageBridge } from './MessageBridge';
import { CanvasHighlighter, HighlightedObject } from './CanvasHighlighter';
import { ObjectTracker } from './ObjectTracker';
import { ErrorTracker } from './ErrorTracker';
import { ConsoleLogTracker } from './ConsoleLogTracker';
import { SourceMapResolver } from './SourceMapResolver';
import { DomInspector } from './DomInspector';
import { DomHighlighter } from './DomHighlighter';
import { compositeScreenshot, copyFrame, CompositeResult, HudState } from './compositeScreenshot';
import { NAME, ATTR_CHROME, id, globalSlot } from '../../brand';
import { postToHost } from '../../shared/host';

declare global {
  interface Window {
    __GAME_STATE__?: { isPaused?: boolean };
  }
}

export interface InspectorAPI {
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
  getSelected: () => unknown;
  getTracked: () => WeakMap<object, TrackedObject>;
  /** The same answers a click gives, for a tool that asks (a test, a script, a coding agent). */
  agent: AgentAPI;
}

/** One thing at a point or by a name: what it is, its state, and the line that made it. */
export interface AgentHit {
  /** A HUD/DOM element over the canvas, or an engine object in it. */
  kind: 'hud' | 'object';
  /** Its label or name, else the name the hook gave it (`Sprite_3`, the texture's file). */
  name: string;
  metadata: ObjectMetadata;
  /** Plain values the game hung on it (Three `userData`); absent when there are none. */
  data?: Record<string, unknown>;
}

/**
 * Read-only: it never pauses the game, selects, highlights or posts a message,
 * so asking changes nothing a person sees. Coordinates are CSS pixels of the
 * page (clientX/clientY), as a click would give them.
 */
export interface AgentAPI {
  version: 1;
  engine: EngineType;
  /** The engine's scene has been found (objects made before it are tracked too). */
  ready: () => boolean;
  /** HUD first (it sits above the canvas), then engine objects topmost first. */
  at: (x: number, y: number, limit?: number) => Promise<AgentHit[]>;
  /** Exact label/name, then the hook's name, then a case-insensitive part of either. */
  named: (name: string, limit?: number) => Promise<AgentHit[]>;
  tree: () => SceneTreeNode | null;
  /** Every runtime error so far, each with its source line once the map resolves. */
  errors: () => Promise<RuntimeError[]>;
  resolve: (ref: SourceRef) => Promise<ResolvedSource | null>;
}

export interface InspectorConfig {
  /** How often to check for scene readiness (ms) */
  sceneCheckInterval?: number;
  /** Timeout for scene detection (ms) */
  sceneCheckTimeout?: number;
  /** Enable debug logging */
  debug?: boolean;
  /**
   * Forward the game's console.log/warn to the host as CONSOLE_LOG. Off by
   * default: wrapping console moves every log's source link in the browser's
   * own devtools to this file. Runtime errors are always forwarded.
   */
  captureConsole?: boolean;
}

const DEFAULT_CONFIG: Required<InspectorConfig> = {
  sceneCheckInterval: 100,
  sceneCheckTimeout: 10000,
  debug: false,
  captureConsole: false,
};

/**
 * Encode a canvas for the SCREENSHOT_RESULT channel.
 *
 * A screenshot is posted to the host and often travels on as base64 inside a
 * JSON request body. A full-resolution WebGL canvas as lossless PNG is about
 * 8 MB of base64, which request-size limits refuse.
 *
 * JPEG at a capped width is ~200 KB for the same frame: ~40x smaller, and
 * lossless encoding buys a review image nothing.
 *
 * Transparency is the one thing JPEG cannot carry, so a canvas that needs an
 * alpha channel keeps PNG — downscaled, which is where most of the bytes are.
 */
export const SCREENSHOT_MAX_WIDTH = 1280;
export const SCREENSHOT_JPEG_QUALITY = 0.82;

export function encodeScreenshot(
  canvas: HTMLCanvasElement,
  opts: { alpha?: boolean } = {},
): string {
  const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / Math.max(1, canvas.width));
  const mime = opts.alpha ? 'image/png' : 'image/jpeg';

  // Already small enough and no resize needed: encode in place.
  if (scale === 1) {
    return mime === 'image/jpeg'
      ? canvas.toDataURL(mime, SCREENSHOT_JPEG_QUALITY)
      : canvas.toDataURL(mime);
  }

  try {
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * scale));
    out.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = out.getContext('2d');
    if (!ctx) {
      // No 2D context: better a large screenshot than none.
      return canvas.toDataURL(mime, SCREENSHOT_JPEG_QUALITY);
    }
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    return mime === 'image/jpeg'
      ? out.toDataURL(mime, SCREENSHOT_JPEG_QUALITY)
      : out.toDataURL(mime);
  } catch {
    return canvas.toDataURL(mime, SCREENSHOT_JPEG_QUALITY);
  }
}

/**
 * The plain values of a bag the game hung on an object (Three's `userData`):
 * strings, finite numbers, booleans and short arrays of them, one level deep,
 * so an agent's answer is small JSON and never a cycle. Nothing plain = undefined.
 */
export function plainValues(bag: unknown, maxKeys = 24): Record<string, unknown> | undefined {
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return undefined;
  const plain = (v: unknown) =>
    typeof v === 'string' ? v.slice(0, 200) : typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) ? v : undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
    if (Object.keys(out).length >= maxKeys) break;
    const p = plain(v);
    if (p !== undefined) { out[k] = p; continue; }
    if (Array.isArray(v) && v.length <= 16) {
      const xs = v.map(plain);
      if (xs.every((x) => x !== undefined)) out[k] = xs;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export abstract class InspectorBase {
  // Engine identification
  abstract readonly engineType: EngineType;

  // Core utilities
  protected readonly stackParser: StackParser;
  protected readonly messages: MessageBridge;
  protected readonly canvasHighlighter: CanvasHighlighter;
  protected readonly tracker: ObjectTracker;
  protected readonly errorTracker: ErrorTracker;
  protected readonly consoleLogTracker: ConsoleLogTracker;
  protected readonly sourceMapResolver: SourceMapResolver;
  protected readonly domInspector: DomInspector;
  protected readonly domHighlighter: DomHighlighter;

  // State
  protected isPaused = false;
  /** onSceneReady has run: the engine's scene is found. */
  protected sceneReady = false;
  /** Whether current selection is a DOM/HUD component (vs canvas object) */
  private isDomSelection = false;
  protected pendingPause = false;
  protected selectedObject: unknown = null;
  protected hoveredObject: unknown = null;
  protected config: Required<InspectorConfig>;

  // Bound event handlers (for proper cleanup)
  private boundHandleClick: (e: MouseEvent) => void;
  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private boundHandleMouseOut: (e: MouseEvent) => void;
  private lastMouseMoveTime = 0;

  /** Full-screen shield that blocks ALL game input while paused */
  private inputShield: HTMLDivElement | null = null;

  /** Loading overlay shown while inspector initializes */
  private initOverlay: HTMLDivElement | null = null;

  constructor(config: InspectorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.stackParser = new StackParser();
    this.canvasHighlighter = new CanvasHighlighter();
    this.tracker = new ObjectTracker(this.stackParser);
    this.sourceMapResolver = new SourceMapResolver();
    this.domInspector = new DomInspector();
    this.domHighlighter = new DomHighlighter();

    // Bind event handlers
    this.boundHandleClick = this.handleClick.bind(this);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleMouseOut = this.handleMouseOut.bind(this);

    // Create message bridge and error tracker (need engineType, so defer to subclass)
    this.messages = null!; // Will be set in init()
    this.errorTracker = null!; // Will be set in init()
    this.consoleLogTracker = null!; // Will be set in init()
  }

  // ============================================================================
  // Abstract Methods - Each engine must implement
  // ============================================================================

  /**
   * Find all objects at a given screen position
   * Returns candidates sorted by layer (highest first)
   */
  protected abstract findObjectsAt(x: number, y: number): SelectionCandidate[];

  /**
   * Get metadata for a selected object
   */
  protected abstract getObjectMetadata(obj: unknown): ObjectMetadata;

  /**
   * Hook engine constructors to track object creation
   */
  protected abstract hookConstructors(): void;

  /**
   * Check if the game scene is ready for inspection
   */
  protected abstract isSceneReady(): boolean;

  /**
   * Get the game's canvas element
   */
  protected abstract getCanvas(): HTMLCanvasElement | null;

  /**
   * Get the screen bounds for an object (for overlay rendering)
   */
  protected abstract getObjectBounds(obj: unknown): Bounds | null;

  /**
   * Build the scene tree hierarchy
   */
  protected abstract buildSceneTree(): SceneTreeNode | null;

  /**
   * Find an object by name in the scene
   */
  protected abstract findObjectByName(name: string): unknown | null;

  /**
   * Focus camera on an object
   * @param target - Object name to focus on
   */
  protected abstract focusOnObject(target: string): void;

  /** Selects a thing by its tree name and sends OBJECT_SELECTED, as a click on it does. */
  private selectByName(target: string, path?: number[]): void {
    // A place in the scene tree names one object; a name can name several.
    const placed = path?.length ? this.findObjectByPath(path) : null;
    if (placed) return this.selectSceneObject(placed, target);
    const dom = this.domInspector.findComponentNamed(target);
    if (dom) {
      this.selectedObject = dom;
      this.isDomSelection = true;
      this.canvasHighlighter.clear();
      this.domHighlighter.showSelection(dom, target);
      this.messages.send({ type: 'OBJECT_SELECTED', metadata: this.domInspector.getComponentMetadata(dom, this.getCanvas()) });
      return;
    }
    const obj = this.findObjectByName(target);
    if (!obj) {
      this.log(`selectByName: "${target}" not found`);
      return;
    }
    this.selectSceneObject(obj, target);
  }

  private selectSceneObject(obj: unknown, target: string): void {
    this.isDomSelection = false;
    this.domHighlighter.clearSelection();
    this.selectedObject = obj;
    const metadata = this.getObjectMetadata(obj);
    if (this.isPaused) this.renderOverlay();
    void this.enrichMetadata(obj, metadata).then((enriched) => {
      this.messages.send({ type: 'OBJECT_SELECTED', metadata: enriched });
      this.log(`Selected by name: ${target}`);
    });
  }

  /**
   * Visit every object in the engine's scene (the agent's `named` lookup).
   * Engines without a scene graph visit nothing.
   */
  protected forEachSceneObject(_visit: (obj: unknown) => void): void {}

  /**
   * The object at a place in the scene tree `buildSceneTree` sent: child
   * indexes from its root. Engines without a scene graph find nothing.
   */
  protected findObjectByPath(_path: number[]): unknown | null {
    return null;
  }

  /**
   * Schedule a callback for the next animation frame — used by the capture path
   * (unpause → render one frame → screenshot → re-pause → send selection).
   *
   * Default = the global `requestAnimationFrame`. ThreeJsInspector FREEZES
   * `window.requestAnimationFrame` while paused (to halt the game loop), which
   * would TRAP these capture callbacks so `OBJECT_SELECTED` / screenshots never
   * fire. Three overrides this to use its saved un-patched `originalRAF`,
   * so the one capture frame still runs while the game stays paused. Pixi (ticker
   * pause, rAF untouched) uses the default.
   */
  protected scheduleFrame(callback: FrameRequestCallback): void {
    requestAnimationFrame(callback);
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Initialize the inspector
   * Called after subclass sets up engine-specific properties
   */
  /**
   * The running engine's version string, resolved from the live page
   * globals ("r171" for Three via THREE.REVISION, "8.6.2" for Pixi via
   * PIXI.VERSION). Undefined until the engine global attaches; the bridge
   * re-resolves on every send so it self-heals.
   */
  protected getEngineVersion(): string | undefined {
    const w = window as unknown as {
      THREE?: { REVISION?: string | number };
      PIXI?: { VERSION?: string };
    };
    if (this.engineType === 'threejs') {
      const rev = w.THREE?.REVISION;
      return rev !== undefined && rev !== null ? `r${rev}` : undefined;
    }
    if (this.engineType === 'pixi') {
      return w.PIXI?.VERSION ?? undefined;
    }
    return undefined;
  }

  protected init(): void {
    // Create message bridge now that engineType is available
    (this as unknown as { messages: MessageBridge }).messages = new MessageBridge(
      this.engineType,
      () => this.getEngineVersion(),
    );

    // Create error tracker and initialize global error handlers
    (this as unknown as { errorTracker: ErrorTracker }).errorTracker = new ErrorTracker(this.messages, this.sourceMapResolver);
    this.errorTracker.init();

    // Create console log tracker (intercepts console.log/warn, filters our own logs)
    (this as unknown as { consoleLogTracker: ConsoleLogTracker }).consoleLogTracker = new ConsoleLogTracker(this.messages);
    if (this.config.captureConsole) this.consoleLogTracker.init();

    // Hook constructors early to track all objects
    this.hookConstructors();

    // Set up message handlers
    this.setupMessageHandlers();

    // Wait for scene to be ready
    this.waitForScene();

    // Expose global API
    this.exposeGlobalAPI();

    this.log('Inspector initialized with error tracking');
  }

  /**
   * Wait for the game scene to be ready
   */
  private waitForScene(): void {
    const startTime = Date.now();

    const checkScene = setInterval(() => {
      if (this.isSceneReady()) {
        clearInterval(checkScene);
        this.onSceneReady();
      } else if (Date.now() - startTime > this.config.sceneCheckTimeout) {
        clearInterval(checkScene);
        this.log('Scene not found after timeout', 'warn');
      }
    }, this.config.sceneCheckInterval);
  }

  /**
   * Called when the scene is ready
   */
  protected onSceneReady(): void {
    this.log('Scene detected');
    this.sceneReady = true;

    // Notify editor that inspector is ready and which engine was detected
    this.messages.send({ type: 'INSPECTOR_READY' });
    this.sendEngineDetected();

    // Handle pending pause request
    if (this.pendingPause) {
      this.log('Executing pending pause');
      this.pause();
    }
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  private setupMessageHandlers(): void {
    this.messages.on('INSPECTOR_PAUSE', () => this.pause());
    this.messages.on('INSPECTOR_RESUME', () => this.resume());
    this.messages.on('CLEAR_SELECTION', () => this.clearSelection());
    this.messages.on('GET_SCENE_TREE', () => this.sendSceneTree());
    this.messages.on('REQUEST_SCREENSHOT', (msg) => this.takeScreenshot(msg.requestId));
    this.messages.on('REQUEST_AREA_SCREENSHOT', (msg) => this.startAreaSelection(msg.requestId));
    this.messages.on('DETECT_ENGINE', () => this.sendEngineDetected());
    // Select by name, as a click would: what a host's scene list or an agent
    // picks. FOCUS_OBJECT moves the camera to it; this changes nothing on screen
    // but the selection.
    this.messages.on('SELECT_OBJECT', (msg) => {
      if (msg.target || msg.path?.length) this.selectByName(msg.target ?? '', msg.path);
    });
    this.messages.on('FOCUS_OBJECT', (msg) => {
      if (msg.target) {
        this.log(`Focusing on "${msg.target}"`);
        this.focusOnObject(msg.target);
      }
    });
  }

  /**
   * Send ENGINE_DETECTED message to parent
   */
  private sendEngineDetected(): void {
    this.messages.send({ type: 'ENGINE_DETECTED', engine: this.engineType });
    this.log(`Engine detected: ${this.engineType}`);
  }

  /** One SCREENSHOT_RESULT, carrying the host's requestId when it sent one. */
  private postScreenshot(
    result: { dataUrl?: string; error?: string; hud?: HudState },
    requestId?: string,
  ): void {
    const msg: Record<string, unknown> = { type: 'SCREENSHOT_RESULT', ...result };
    if (requestId) msg.requestId = requestId;
    postToHost(msg);
  }

  /**
   * Hand `use` a 2D copy of the canvas's pixels. WebGL and WebGPU canvases may
   * clear their back buffer after presentation (toDataURL returns blank unless
   * read during a render frame), so those are copied inside one; the copy then
   * survives the async composite while the game keeps drawing.
   */
  private withFrame(
    canvas: HTMLCanvasElement,
    use: (frame: HTMLCanvasElement) => void,
    onError: (err: unknown) => void,
  ): void {
    const grab = () => {
      let frame: HTMLCanvasElement;
      try {
        frame = copyFrame(canvas);
      } catch (err) {
        onError(err);
        return;
      }
      use(frame);
    };
    if (!this.needsRafCapture(canvas)) {
      grab();
      return;
    }
    const wasPaused = this.isPaused;
    if (wasPaused && window.__GAME_STATE__) window.__GAME_STATE__.isPaused = false;
    this.scheduleFrame(() => {
      try {
        grab();
      } finally {
        if (wasPaused && window.__GAME_STATE__) window.__GAME_STATE__.isPaused = true;
      }
    });
  }

  /** Encode the composite; if that throws (a tainted picture slipped through), the bare frame. */
  private encodeShot(shot: CompositeResult, frame: HTMLCanvasElement): { dataUrl: string; hud: HudState } {
    try {
      return { dataUrl: encodeScreenshot(shot.canvas), hud: shot.hud };
    } catch (err) {
      if (shot.canvas === frame) throw err;
      this.log(`Composite would not encode (${err}); sending the canvas alone`, 'warn');
      return { dataUrl: encodeScreenshot(frame), hud: 'missing' };
    }
  }

  /**
   * Take a screenshot of what the player sees — the game canvas plus the DOM
   * (HUD, menus) drawn over it — and send it to the parent. `hud: 'missing'`
   * marks a capture whose DOM layer could not be composited (canvas only).
   */
  private takeScreenshot(requestId?: string): void {
    const canvas = this.getCanvas();
    if (!canvas) {
      this.log('No canvas available for screenshot, trying html2canvas fallback', 'warn');
      this.tryHtml2CanvasFallback(requestId, () => {
        this.postScreenshot({ error: 'No canvas' }, requestId);
      });
      return;
    }

    const sendError = (err: unknown) => {
      this.log(`Screenshot failed: ${err}, trying html2canvas fallback`, 'error');
      this.tryHtml2CanvasFallback(requestId, () => {
        this.postScreenshot({ error: String(err) }, requestId);
      });
    };

    this.withFrame(canvas, (frame) => {
      void compositeScreenshot({ gameCanvas: canvas, frame }).then((shot) => {
        if (shot.reason && shot.hud === 'missing') {
          this.log(`HUD not composited (${shot.reason}); sending the canvas alone`, 'warn');
        }
        let out: { dataUrl: string; hud: HudState };
        try {
          out = this.encodeShot(shot, frame);
        } catch (err) {
          sendError(err);
          return;
        }
        // A capture that looks blank (a tiny data URL): try html2canvas.
        if (out.dataUrl.length < 200) {
          this.log('Canvas capture returned blank image, trying html2canvas fallback', 'warn');
          this.tryHtml2CanvasFallback(requestId, () => {
            this.postScreenshot(out, requestId);
          });
          return;
        }
        this.postScreenshot(out, requestId);
        this.log(`Screenshot captured (hud ${out.hud})`);
      });
    }, sendError);
  }

  /**
   * Try html2canvas as a fallback for screenshot capture.
   * Dynamically loads html2canvas from CDN on first use (not bundled).
   * Falls back to onFallbackFail callback if loading fails or CSP blocks it.
   */
  private tryHtml2CanvasFallback(requestId: string | undefined, onFallbackFail: () => void): void {
    this.loadHtml2Canvas().then((html2canvas) => {
      if (!html2canvas) {
        onFallbackFail();
        return;
      }
      this.log('Using html2canvas fallback for screenshot');
      html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
      }).then((resultCanvas: HTMLCanvasElement) => {
        // html2canvas composites the DOM and may carry transparency.
        const dataUrl = encodeScreenshot(resultCanvas, { alpha: true });
        this.postScreenshot({ dataUrl, hud: 'included' }, requestId);
        this.log('Screenshot captured via html2canvas fallback');
      }).catch((err: unknown) => {
        this.log(`html2canvas fallback failed: ${err}`, 'error');
        onFallbackFail();
      });
    }).catch(() => onFallbackFail());
  }

  /** Cached html2canvas loader — loads once via script tag, reuses thereafter. */
  private html2canvasPromise: Promise<((el: HTMLElement, opts?: any) => Promise<HTMLCanvasElement>) | null> | null = null;

  private loadHtml2Canvas(): Promise<((el: HTMLElement, opts?: any) => Promise<HTMLCanvasElement>) | null> {
    // Already on window (pre-loaded or previous dynamic load)
    if (typeof (window as any).html2canvas === 'function') {
      return Promise.resolve((window as any).html2canvas);
    }

    // Return cached load promise to avoid multiple script tags
    if (this.html2canvasPromise) return this.html2canvasPromise;

    this.html2canvasPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.onload = () => {
        if (typeof (window as any).html2canvas === 'function') {
          this.log('html2canvas loaded dynamically');
          resolve((window as any).html2canvas);
        } else {
          resolve(null);
        }
      };
      script.onerror = () => {
        this.log('Failed to load html2canvas from CDN', 'warn');
        resolve(null);
      };
      document.head.appendChild(script);
    });

    return this.html2canvasPromise;
  }

  /**
   * Start area selection for screenshot.
   * Renders the selection UI inside the iframe using the same design
   * system as the parent SelectionOverlay (cyan dashed border, dark
   * backdrop, instruction banner and live dimensions label).
   */
  private startAreaSelection(requestId?: string): void {
    const canvas = this.getCanvas();
    if (!canvas) {
      this.log('No canvas available for area screenshot', 'warn');
      this.postScreenshot({ error: 'No canvas' }, requestId);
      return;
    }

    // --- Overlay root (dark backdrop + crosshair) ---
    const selectionOverlay = document.createElement('div');
    selectionOverlay.id = id('screenshot-selection');
    selectionOverlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      cursor: crosshair;
      z-index: 99999;
      background: rgba(0, 0, 0, 0.3);
    `;

    // --- Selection box (cyan dashed border matching parent design) ---
    const selectionBox = document.createElement('div');
    selectionBox.style.cssText = `
      position: absolute;
      border: 2px dashed #00f0ff;
      background: rgba(0, 240, 255, 0.1);
      box-shadow: 0 0 10px rgba(0, 240, 255, 0.3);
      display: none;
      pointer-events: none;
    `;
    selectionOverlay.appendChild(selectionBox);

    // --- Instruction banner ---
    const instructions = document.createElement('div');
    instructions.textContent = 'Click and drag to select area. Press ESC to cancel.';
    instructions.style.cssText = `
      position: absolute;
      top: 20px; left: 50%; transform: translateX(-50%);
      padding: 8px 16px;
      background: rgba(0, 0, 0, 0.8);
      color: #fff;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      pointer-events: none;
      white-space: nowrap;
    `;
    selectionOverlay.appendChild(instructions);

    // --- Dimensions label ---
    const dimsLabel = document.createElement('div');
    dimsLabel.style.cssText = `
      position: absolute;
      padding: 4px 8px;
      background: rgba(0, 0, 0, 0.8);
      color: #00f0ff;
      border-radius: 4px;
      font-size: 11px;
      font-family: ui-monospace, monospace;
      pointer-events: none;
      display: none;
      transform: translateX(-50%);
      white-space: nowrap;
    `;
    selectionOverlay.appendChild(dimsLabel);

    let startX = 0, startY = 0;
    let isSelecting = false;

    const onMouseDown = (e: MouseEvent) => {
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;
      selectionBox.style.display = 'block';
      selectionBox.style.left = `${startX}px`;
      selectionBox.style.top = `${startY}px`;
      selectionBox.style.width = '0';
      selectionBox.style.height = '0';
      dimsLabel.style.display = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isSelecting) return;
      const currentX = e.clientX;
      const currentY = e.clientY;
      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      selectionBox.style.left = `${left}px`;
      selectionBox.style.top = `${top}px`;
      selectionBox.style.width = `${width}px`;
      selectionBox.style.height = `${height}px`;

      // Update dimensions label
      if (width > 0 && height > 0) {
        dimsLabel.style.display = 'block';
        dimsLabel.style.left = `${left + width / 2}px`;
        dimsLabel.style.top = `${top + height + 10}px`;
        dimsLabel.textContent = `${Math.round(width)} x ${Math.round(height)}`;
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!isSelecting) return;
      isSelecting = false;

      const endX = e.clientX;
      const endY = e.clientY;
      // The selection in page CSS px; mapped to pixels once the capture is in.
      const sel = {
        left: Math.min(startX, endX),
        top: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY),
      };
      const rect = canvas.getBoundingClientRect();
      const density = rect.width > 0 ? canvas.width / rect.width : 1;

      cleanup();

      if (sel.width * density > 10 && sel.height * density > 10) {
        this.captureArea(canvas, sel, requestId);
      } else {
        this.postScreenshot({ error: 'Selection too small' }, requestId);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        this.postScreenshot({ error: 'Cancelled' }, requestId);
      }
    };

    const cleanup = () => {
      selectionOverlay.removeEventListener('mousedown', onMouseDown);
      selectionOverlay.removeEventListener('mousemove', onMouseMove);
      selectionOverlay.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      selectionOverlay.remove();
    };

    selectionOverlay.addEventListener('mousedown', onMouseDown);
    selectionOverlay.addEventListener('mousemove', onMouseMove);
    selectionOverlay.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(selectionOverlay);

    this.log('Area selection started - drag to select, Esc to cancel');
  }

  /**
   * Capture an area of what the player sees (the canvas plus its DOM layer),
   * `sel` in page CSS px. GPU canvases are read inside a render frame, as in
   * takeScreenshot().
   */
  private captureArea(
    canvas: HTMLCanvasElement,
    sel: { left: number; top: number; width: number; height: number },
    requestId?: string,
  ): void {
    const sendError = (err: unknown) => {
      this.log(`Area screenshot failed: ${err}`, 'error');
      this.postScreenshot({ error: String(err) }, requestId);
    };
    this.withFrame(canvas, (frame) => {
      void compositeScreenshot({ gameCanvas: canvas, frame }).then((shot) => {
        try {
          const src = shot.canvas;
          let x: number, y: number, w: number, h: number;
          if (shot.space === 'viewport') {
            x = sel.left * shot.scale;
            y = sel.top * shot.scale;
            w = sel.width * shot.scale;
            h = sel.height * shot.scale;
          } else {
            const rect = canvas.getBoundingClientRect();
            const sx = rect.width > 0 ? src.width / rect.width : 1;
            const sy = rect.height > 0 ? src.height / rect.height : 1;
            x = (sel.left - rect.left) * sx;
            y = (sel.top - rect.top) * sy;
            w = sel.width * sx;
            h = sel.height * sy;
          }
          x = Math.max(0, x);
          y = Math.max(0, y);
          w = Math.max(1, Math.min(src.width - x, w));
          h = Math.max(1, Math.min(src.height - y, h));
          const temp = document.createElement('canvas');
          temp.width = Math.round(w);
          temp.height = Math.round(h);
          const ctx = temp.getContext('2d');
          if (!ctx) throw new Error('Could not get 2D context');
          ctx.drawImage(src, x, y, w, h, 0, 0, temp.width, temp.height);
          const out = this.encodeShot({ ...shot, canvas: temp }, frame);
          this.postScreenshot(out, requestId);
          this.log(`Area screenshot captured: ${Math.round(w)}x${Math.round(h)} (hud ${out.hud})`);
        } catch (err) {
          sendError(err);
        }
      });
    }, sendError);
  }

  /**
   * Check if the canvas needs rAF-based capture (GPU-rendered with buffer clearing).
   * WebGL with preserveDrawingBuffer=false and WebGPU canvases clear their buffer
   * after presentation, so we must capture during a live render frame.
   */
  private needsRafCapture(canvas: HTMLCanvasElement): boolean {
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false })
      || canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false });

    if (gl) {
      const attribs = gl.getContextAttributes();
      return !!(attribs && !attribs.preserveDrawingBuffer);
    }

    // No WebGL — check if Canvas2D exists (if not, it's likely WebGPU)
    const ctx2d = canvas.getContext('2d');
    return !ctx2d;
  }

  /**
   * Capture a screenshot of a specific object's bounds from the canvas.
   * Bounds are in canvas-internal coordinates (game space), matching
   * the overlay coordinate system used by getObjectBounds().
   * Returns a data:image/png URL, or undefined on failure.
   */
  private captureObjectScreenshot(canvas: HTMLCanvasElement, bounds: Bounds): string | undefined {
    try {
      // bounds are in stage/CSS coordinates (from getBounds()).
      // canvas.drawImage operates in canvas-internal pixel coordinates.
      // With autoDensity, canvas pixels = CSS pixels × DPR, so scale bounds
      // by the ratio of canvas pixels to CSS size.
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const padX = Math.max(8, bounds.width * 0.1) * scaleX;
      const padY = Math.max(8, bounds.height * 0.1) * scaleY;

      const x = Math.max(0, bounds.x * scaleX - padX);
      const y = Math.max(0, bounds.y * scaleY - padY);
      const w = Math.min(canvas.width - x, bounds.width * scaleX + padX * 2);
      const h = Math.min(canvas.height - y, bounds.height * scaleY + padY * 2);

      if (w < 4 || h < 4) return undefined;

      const temp = document.createElement('canvas');
      temp.width = w;
      temp.height = h;
      const ctx = temp.getContext('2d');
      if (!ctx) return undefined;

      ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      return temp.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }

  private sendSceneTree(): void {
    const canvasTree = this.buildSceneTree();
    const domTree = this.domInspector.buildDomTree();

    // Merge canvas scene graph + DOM HUD tree into unified tree
    const children: SceneTreeNode[] = [];
    if (canvasTree) {
      children.push({ ...canvasTree, layer: 'canvas' });
    }
    if (domTree.length > 0) {
      children.push({
        name: 'UI Layer',
        type: 'overlay',
        layer: 'hud',
        children: domTree,
      });
    }

    if (children.length > 0) {
      const tree: SceneTreeNode = {
        name: 'Game',
        type: 'root',
        children,
      };
      this.messages.send({ type: 'SCENE_TREE', tree });
    }
  }

  // ============================================================================
  // Pause/Resume
  // ============================================================================

  public pause(): void {
    if (this.isPaused) return;

    // If scene not ready, queue the pause and show loading overlay
    if (!this.isSceneReady()) {
      this.log('Scene not ready yet, will pause when ready');
      this.pendingPause = true;
      this.showInitOverlay();
      return;
    }

    this.pendingPause = false;
    this.isPaused = true;

    // Pause game state if available
    if (window.__GAME_STATE__) {
      window.__GAME_STATE__.isPaused = true;
    }

    // Show init overlay — engine subclass retroactive tracking runs before
    // super.pause(), so by the time we get here tracking is already done.
    // The overlay gives visual feedback while we set up event handlers + render.
    this.showInitOverlay();

    // Create overlay
    this.canvasHighlighter.create(this.getCanvas());

    // Create DOM highlighter for HUD component selection
    this.domHighlighter.create();

    // Block ALL game input: insert a full-screen transparent shield inside the
    // game shell. It sits above the canvas + overlay so buttons, links, touch
    // zones etc. can't receive pointer events. The inspector's capture-phase
    // listeners still fire before the shield, so click-to-select works.
    this.createInputShield();

    // Attach event listeners to document (capture phase) so we can detect
    // clicks on both canvas objects and DOM overlay elements (HUD components).
    // stopPropagation in handlers prevents events from reaching game code.
    document.addEventListener('click', this.boundHandleClick, true);
    document.addEventListener('mousemove', this.boundHandleMouseMove, true);
    window.addEventListener('keydown', this.boundHandleKeyDown, true);
    // Clear a lingering hover box+label when the pointer leaves the game window
    // (no mousemove fires after exit, so the throttle can't clear the last hover
    // — this is what stranded the top-left label). `mouseout` to `null`
    // relatedTarget = left the document.
    document.addEventListener('mouseout', this.boundHandleMouseOut, true);

    // Initial render
    this.renderOverlay();

    // Notify editor
    this.messages.send({ type: 'GAME_PAUSED' });

    // Hide init overlay after a frame so the browser has painted the inspector UI.
    // Use setTimeout instead of rAF because engine inspectors (Three.js) may freeze
    // rAF before calling super.pause(), which would trap this callback forever.
    setTimeout(() => this.hideInitOverlay(), 50);

    this.log('Paused - Click objects to inspect');
  }

  public resume(): void {
    if (!this.isPaused) return;

    this.isPaused = false;

    // Remove init overlay if still showing
    this.hideInitOverlay();

    // Resume game state if available
    if (window.__GAME_STATE__) {
      window.__GAME_STATE__.isPaused = false;
    }

    // Remove input shield + event listeners
    this.removeInputShield();
    document.removeEventListener('click', this.boundHandleClick, true);
    document.removeEventListener('mousemove', this.boundHandleMouseMove, true);
    window.removeEventListener('keydown', this.boundHandleKeyDown, true);
    document.removeEventListener('mouseout', this.boundHandleMouseOut, true);
    const canvas = this.getCanvas();
    if (canvas) {
      canvas.style.cursor = 'default';
    }

    // Clear state
    this.selectedObject = null;
    this.hoveredObject = null;
    this.isDomSelection = false;

    // Remove overlays
    this.canvasHighlighter.remove();
    this.domHighlighter.remove();

    // Notify editor
    this.messages.send({ type: 'GAME_RESUMED' });

    this.log('Resumed');
  }

  /**
   * Clear the current selection without resuming the game.
   * Called when the host closes its view of the selection.
   */
  public clearSelection(): void {
    if (!this.isPaused) return;

    this.selectedObject = null;
    this.hoveredObject = null;
    this.isDomSelection = false;
    this.domHighlighter.clearSelection();
    this.renderOverlay();
    this.messages.send({ type: 'OBJECT_DESELECTED' });
    this.log('Selection cleared');
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /** A pointer event on our own UI (the panel) is the panel's, never a pick. */
  private isOwnChrome(e: Event): boolean {
    return e.composedPath().some((n) => n instanceof Element && n.hasAttribute(ATTR_CHROME));
  }

  private handleClick(e: MouseEvent): void {
    if (!this.isPaused) return;
    if (this.isOwnChrome(e)) return;

    // Block event from reaching game UI (buttons, links, touch zones)
    e.stopPropagation();
    e.preventDefault();

    // --- Phase 1: Check DOM overlay first (higher visual z-order) ---
    const domHit = this.domInspector.findComponentAt(e.clientX, e.clientY);
    this.log(`handleClick(${Math.round(e.clientX)},${Math.round(e.clientY)}): domHit=${domHit ? domHit.name : 'null'}`);
    if (domHit) {
      this.selectedObject = domHit.element;
      this.isDomSelection = true;
      const metadata = this.domInspector.getComponentMetadata(domHit.element, this.getCanvas());
      this.canvasHighlighter.clear();
      // Clear the hover box first — the hover drawn just before this click was on
      // the same element and would otherwise linger on top of the selection box.
      this.domHighlighter.clearHover();
      this.domHighlighter.showSelection(domHit.element, domHit.name);
      this.messages.send({
        type: 'OBJECT_SELECTED',
        metadata,
        clickX: e.clientX,
        clickY: e.clientY,
      });
      this.log(`Selected HUD: ${domHit.name}`);
      return;
    }

    // --- Phase 2: Fall through to canvas object selection ---
    this.isDomSelection = false;
    this.domHighlighter.clearSelection();

    const candidates = this.findObjectsAt(e.clientX, e.clientY);

    if (candidates.length > 0) {
      const selected = candidates[0];
      this.selectedObject = selected.obj;

      const metadata = this.getObjectMetadata(selected.obj);
      const canvas = this.getCanvas();
      const objBounds = canvas ? this.getObjectBounds(selected.obj) : null;
      const hasBounds = !!(objBounds && objBounds.width > 0 && objBounds.height > 0);

      const sendSelection = async (screenshot?: string) => {
        // Enrich metadata with resolved source map info (lazy, cached)
        const enriched = await this.enrichMetadata(selected.obj, metadata);
        this.messages.send({
          type: 'OBJECT_SELECTED',
          metadata: enriched,
          clickX: e.clientX,
          clickY: e.clientY,
          screenshot,
        });
        this.log(`Selected: ${enriched.type}`);
      };

      if (canvas && hasBounds && this.needsRafCapture(canvas)) {
        // GPU-rendered canvas: buffer cleared between frames.
        // Temporarily unpause → render one frame → capture → re-pause.
        if (window.__GAME_STATE__) {
          window.__GAME_STATE__.isPaused = false;
        }
        this.scheduleFrame(() => {
          let screenshot: string | undefined;
          try {
            screenshot = this.captureObjectScreenshot(canvas, objBounds!);
          } catch { /* ignore capture errors */ }
          finally {
            if (window.__GAME_STATE__) {
              window.__GAME_STATE__.isPaused = true;
            }
          }
          sendSelection(screenshot);
        });
      } else {
        // Canvas2D or preserveDrawingBuffer=true: capture synchronously
        const screenshot = (canvas && hasBounds)
          ? this.captureObjectScreenshot(canvas, objBounds!)
          : undefined;
        sendSelection(screenshot);
      }
    } else {
      this.selectedObject = null;
      this.messages.send({ type: 'OBJECT_DESELECTED' });
    }

    this.renderOverlay();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isPaused) return;
    if (this.isOwnChrome(e)) return;

    // Block event from reaching game UI
    e.stopPropagation();

    // Throttle to ~30fps to avoid excessive scene-tree traversals — but the
    // throttle must gate only the EXPENSIVE traversal below, never the cheap
    // hover-clear. If the throttle `return`s above clearHover(), the last
    // mousemove that carries the cursor off an element is dropped and the hover
    // box+label strand on screen until the next event (which may never come if
    // the pointer left the game). So bail out of the throttle window only AFTER
    // ensuring a stale hover can still be cleared on the trailing edge.
    const now = performance.now();
    if (now - this.lastMouseMoveTime < 32) return;
    this.lastMouseMoveTime = now;

    const canvas = this.getCanvas();

    // Check DOM overlay first for hover
    const domHit = this.domInspector.findComponentAt(e.clientX, e.clientY);
    if (domHit) {
      this.hoveredObject = domHit.element;
      // Always clear any prior hover highlight first — otherwise a hover label
      // drawn BEFORE the element was selected lingers on top of the selection
      // box (you saw "button: …" twice, cleared only on mouse-leave). Then draw
      // a fresh hover ONLY when this element isn't the current selection (the
      // selection box + edit-panel header already identify it).
      this.domHighlighter.clearHover();
      const isSelected = this.isDomSelection && this.selectedObject === domHit.element;
      if (!isSelected) {
        this.domHighlighter.showHover(domHit.element, domHit.name);
      }
      document.body.style.cursor = 'pointer';
      // Clear canvas hover highlights
      if (!this.isDomSelection) {
        this.canvasHighlighter.clear();
      }
      return;
    }

    // Fall through to canvas hover
    this.domHighlighter.clearHover();
    const candidates = this.findObjectsAt(e.clientX, e.clientY);

    if (candidates.length > 0) {
      this.hoveredObject = candidates[0].obj;
      if (canvas) canvas.style.cursor = 'pointer';
      document.body.style.cursor = 'pointer';
    } else {
      this.hoveredObject = null;
      if (canvas) canvas.style.cursor = 'default';
      document.body.style.cursor = 'default';
    }

    this.renderOverlay();
  }

  /**
   * Clear the hover highlight when the pointer leaves the game window entirely.
   * `mousemove` stops firing on exit, so without this the last-drawn hover
   * box+label strand on screen (the stuck top-left label). A `mouseout` whose
   * `relatedTarget` is null (or an EventTarget outside the document) means the
   * cursor left the document — drop the hover then. Selection is untouched.
   */
  private handleMouseOut(e: MouseEvent): void {
    if (!this.isPaused) return;
    // Only when actually leaving the document/window, not on inner element
    // boundaries (those still get a fresh mousemove that manages hover).
    if (e.relatedTarget !== null) return;
    this.domHighlighter.clearHover();
    this.hoveredObject = null;
    this.canvasHighlighter.clear();
    this.renderOverlay();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isPaused) return;

    // The browser's own shortcuts (reload, devtools) and keys typed into our
    // panel are not the game's.
    if (e.metaKey || e.ctrlKey || /^F\d+$/.test(e.key) || this.isOwnChrome(e)) return;

    // Block ALL keyboard input from reaching the game while paused
    e.stopPropagation();
    e.preventDefault();

    if (e.key === 'Escape') {
      if (this.selectedObject) {
        this.selectedObject = null;
        this.isDomSelection = false;
        this.domHighlighter.clear();
        this.messages.send({ type: 'OBJECT_DESELECTED' });
        this.renderOverlay();
      }
    }
  }

  // ============================================================================
  // Init Overlay — shown while inspector prepares
  // ============================================================================

  /**
   * Show a loading overlay while the inspector scans the scene tree
   * and sets up event handlers.
   */
  protected showInitOverlay(): void {
    this.hideInitOverlay();

    const shell = document.body;
    const el = document.createElement('div');
    el.id = id('inspector-init');
    el.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(10, 10, 15, 0.35);
      backdrop-filter: blur(1px);
      -webkit-backdrop-filter: blur(1px);
      transition: opacity 0.2s ease;
      opacity: 1;
    `;

    const label = document.createElement('div');
    label.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      background: rgba(18, 18, 26, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4), 0 0 40px rgba(0, 240, 255, 0.08);
      color: rgba(255, 255, 255, 0.65);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 500;
    `;

    const logo = document.createElement('div');
    logo.style.cssText = `
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-top-color: rgba(255, 255, 255, 0.8);
    `;
    logo.animate?.([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 800, iterations: Infinity });

    label.appendChild(logo);
    label.appendChild(document.createTextNode('Setting up inspector…'));
    el.appendChild(label);
    shell.appendChild(el);
    this.initOverlay = el;
  }

  /**
   * Fade out and remove the init overlay.
   */
  protected hideInitOverlay(): void {
    const el = this.initOverlay;
    if (!el) return;
    this.initOverlay = null;

    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }

  // ============================================================================
  // Input Shield — blocks ALL game input while paused
  // ============================================================================

  /**
   * Creates a transparent full-screen div over the page that absorbs
   * all pointer events. This prevents game buttons, touch zones, links, etc.
   * from firing while the inspector is active. The inspector's own capture-phase
   * listeners still work because they fire before the shield's handlers.
   */
  private createInputShield(): void {
    this.removeInputShield();

    const shell = document.body;
    const shield = document.createElement('div');
    shield.id = id('inspector-shield');
    shield.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 99998;
      cursor: crosshair;
    `;
    // Absorb all pointer events so game UI can't respond
    shield.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); }, true);
    shield.addEventListener('pointerup', (e) => { e.stopPropagation(); e.preventDefault(); }, true);
    shield.addEventListener('touchstart', (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, passive: false });
    shield.addEventListener('touchmove', (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, passive: false });
    shield.addEventListener('touchend', (e) => { e.stopPropagation(); e.preventDefault(); }, true);
    shield.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); }, true);
    shield.addEventListener('mouseup', (e) => { e.stopPropagation(); e.preventDefault(); }, true);
    shield.addEventListener('contextmenu', (e) => { e.stopPropagation(); e.preventDefault(); }, true);

    shell.appendChild(shield);
    this.inputShield = shield;
  }

  private removeInputShield(): void {
    if (this.inputShield) {
      this.inputShield.remove();
      this.inputShield = null;
    }
  }

  // ============================================================================
  // Overlay Rendering
  // ============================================================================

  private renderOverlay(): void {
    const highlights: HighlightedObject[] = [];

    // DOM/HUD selections and hovers belong to the DomHighlighter — the engine
    // bounds path must never see a DOM node. Feeding an HTMLElement into e.g.
    // three's Box3.setFromObject throws "updateWorldMatrix is not a function"
    // on every mousemove. A DOM node can sit in selectedObject
    // (handleClick phase 1) or linger in hoveredObject (throttle/Escape paths).
    const selected =
      this.isDomSelection || this.selectedObject instanceof Element
        ? null
        : this.selectedObject;
    const hovered =
      this.hoveredObject instanceof Element ? null : this.hoveredObject;

    // Add selected object
    if (selected) {
      const bounds = this.getObjectBounds(selected);
      if (bounds) {
        // Get label from metadata (which uses object.name, label, etc.) - NOT just tracker
        const metadata = this.getObjectMetadata(selected);
        highlights.push({
          bounds,
          label: metadata.type || 'Unknown',
          isSelected: true,
        });
      }
    }

    // Add hovered object (if different from selected)
    if (hovered && hovered !== selected) {
      const bounds = this.getObjectBounds(hovered);
      if (bounds) {
        // Get label from metadata (which uses object.name, label, etc.) - NOT just tracker
        const metadata = this.getObjectMetadata(hovered);
        highlights.push({
          bounds,
          label: metadata.type,
          isHovered: true,
        });
      }
    }

    this.canvasHighlighter.render(highlights);
  }

  // ============================================================================
  // Global API
  // ============================================================================

  private exposeGlobalAPI(): void {
    const api: InspectorAPI = {
      pause: () => this.pause(),
      resume: () => this.resume(),
      isPaused: () => this.isPaused,
      getSelected: () => this.selectedObject,
      getTracked: () => this.tracker['objects'] as WeakMap<object, TrackedObject>,
      agent: {
        version: 1,
        engine: this.engineType,
        ready: () => this.sceneReady,
        at: (x, y, limit = 6) => this.agentAt(x, y, limit),
        named: (name, limit = 10) => this.agentNamed(name, limit),
        tree: () => this.buildSceneTree(),
        errors: async () => {
          await this.errorTracker.settled();
          return this.errorTracker.getErrors().map((e) => ({ ...e }));
        },
        resolve: (ref) => this.sourceMapResolver.resolve(ref),
      },
    };
    globalSlot().inspector = api;
  }

  // ============================================================================
  // Agent API — read-only answers for a tool (never pauses, selects or draws)
  // ============================================================================

  private async agentHit(obj: unknown, kind: AgentHit['kind']): Promise<AgentHit> {
    const base = kind === 'hud'
      ? this.domInspector.getComponentMetadata(obj as HTMLElement, this.getCanvas())
      : this.getObjectMetadata(obj);
    const metadata = await this.enrichMetadata(obj, base);
    const o = obj as { label?: unknown; name?: unknown; __n?: unknown; userData?: unknown };
    const name = [o.label, o.name, o.__n, metadata.type].find((v) => typeof v === 'string' && v) as string ?? metadata.type;
    const data = plainValues(o.userData);
    return data ? { kind, name, metadata, data } : { kind, name, metadata };
  }

  private async agentAt(x: number, y: number, limit: number): Promise<AgentHit[]> {
    const out: AgentHit[] = [];
    const dom = this.domInspector.findComponentAt(x, y);
    if (dom) out.push(await this.agentHit(dom.element, 'hud'));
    const seen = new Set<unknown>();
    for (const c of this.findObjectsAt(x, y)) {
      if (out.length >= limit) break;
      if (seen.has(c.obj)) continue;
      seen.add(c.obj);
      out.push(await this.agentHit(c.obj, 'object'));
    }
    return out;
  }

  private async agentNamed(name: string, limit: number): Promise<AgentHit[]> {
    const want = name.toLowerCase();
    const tiers: unknown[][] = [[], [], []];
    const seen = new Set<unknown>();
    this.forEachSceneObject((obj) => {
      if (seen.has(obj)) return;
      seen.add(obj);
      const o = obj as { label?: unknown; name?: unknown; __n?: unknown };
      const own = [o.label, o.name].filter((v): v is string => typeof v === 'string' && v !== '');
      const auto = typeof o.__n === 'string' ? o.__n : '';
      if (own.includes(name)) tiers[0].push(obj);
      else if (auto === name) tiers[1].push(obj);
      else if ([...own, auto].some((v) => v && v.toLowerCase().includes(want))) tiers[2].push(obj);
    });
    const picked = tiers.flat().slice(0, limit);
    const out: AgentHit[] = [];
    for (const obj of picked) out.push(await this.agentHit(obj, 'object'));
    return out;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Enrich metadata with source map resolution.
   * Reads obj.__src (compact {f,l,c} from captureSource()),
   * fills in sourceColumn, and resolves original source via .map files.
   */
  protected async enrichMetadata(obj: unknown, metadata: ObjectMetadata): Promise<ObjectMetadata> {
    const src = (obj as any)?.__src as SourceRef | undefined;
    if (!src) return metadata;

    // Fill in sourceColumn from compact source ref
    if (metadata.sourceColumn == null) {
      metadata.sourceColumn = src.c || null;
    }

    // Fallback: if tracker didn't have source, use __src
    if (!metadata.sourceFile) {
      try {
        const pathname = new URL(src.f).pathname;
        metadata.sourceFile = pathname.split('/').pop() || pathname;
      } catch {
        metadata.sourceFile = src.f;
      }
    }
    if (!metadata.sourceLine) {
      metadata.sourceLine = src.l;
    }

    // Resolve source map (lazy, cached)
    try {
      const resolved = await this.sourceMapResolver.resolve(src);
      if (resolved) {
        metadata.originalSource = resolved.source;
        metadata.originalLine = resolved.line;
        metadata.originalSourceLine = resolved.sourceLine || null;
      }
    } catch {
      // Source map resolution is best-effort
    }

    return metadata;
  }

  protected log(message: string, level: 'log' | 'warn' | 'error' = 'log'): void {
    if (this.config.debug || level !== 'log') {
      console[level](`[${NAME}] ${message}`);
    }
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.resume();
    this.domHighlighter.remove();
    this.errorTracker.destroy();
    this.consoleLogTracker.destroy();
    this.messages.destroy();
    delete globalSlot().inspector;
  }
}
