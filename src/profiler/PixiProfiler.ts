/**
 * PixiJS Profiler
 *
 * Engine-specific profiler for PixiJS games.
 * Uses WebGL draw call interception (Spector.js pattern) since PixiJS
 * doesn't expose renderer.info like Three.js does.
 *
 * Detection: the same page globals the inspector reads:
 *   win().__PIXI_APP__, win().PIXI
 *
 * Metrics source:
 *   - WebGL gl.drawElements/drawArrays interception → draw calls, triangles, points, lines
 *   - app.ticker.FPS / deltaMS                      → FPS and frame time
 *   - scene graph traversal (throttled)              → object counts
 *   - renderer.texture info                          → texture counts
 *   - GPUTimerQuery                                  → GPU-side timing (if available)
 *   - performance.memory                             → JS heap (Chrome only)
 */

import { ProfilerBase } from './core/ProfilerBase';
import type {
  FrameSample,
  ProfilerConfig,
  EngineInfo,
  HotObject,
} from './core/types';

// PixiJS type declarations (minimal, no dependency on Pixi's own types)
interface PixiNamespace {
  VERSION?: string;
  [key: string]: unknown;
}

interface PixiContainer {
  label?: string;
  name?: string;
  visible: boolean;
  children: PixiContainer[];
  parent?: PixiContainer | null;
  constructor: { name: string };
}

interface PixiTicker {
  add(fn: (dt: number) => void): void;
  remove(fn: (dt: number) => void): void;
  FPS: number;
  deltaMS: number;
  started: boolean;
}

interface PixiRenderer {
  width: number;
  height: number;
  resolution: number;
  view?: HTMLCanvasElement;
  canvas?: HTMLCanvasElement;
  type?: number; // 1 = WebGL, 2 = Canvas
  gl?: WebGLRenderingContext | WebGL2RenderingContext;
  texture?: {
    managedTextures?: unknown[];
  };
}

interface PixiApplication {
  stage: PixiContainer;
  renderer: PixiRenderer;
  ticker: PixiTicker;
  canvas?: HTMLCanvasElement;
  view?: HTMLCanvasElement;
}

// WebGL draw call counters
interface DrawCallCounters {
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;
}

/** The page globals the app is found on (the same ones the inspector reads). */
const win = () => window as unknown as {
  PIXI?: PixiNamespace;
  __PIXI_APP__?: PixiApplication;
};

export class PixiProfiler extends ProfilerBase {
  readonly engineType = 'pixi' as const;

  private app: PixiApplication | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private tickerCallback: ((dt: number) => void) | null = null;

  // WebGL interception state
  private originalDrawElements: WebGLRenderingContext['drawElements'] | null = null;
  private originalDrawArrays: WebGLRenderingContext['drawArrays'] | null = null;
  private originalDrawElementsInstanced: Function | null = null;
  private originalDrawArraysInstanced: Function | null = null;
  private counters: DrawCallCounters = { drawCalls: 0, triangles: 0, points: 0, lines: 0 };
  private lastFrameCounters: DrawCallCounters = { drawCalls: 0, triangles: 0, points: 0, lines: 0 };

  constructor(config?: Partial<ProfilerConfig>) {
    super(config);
    this.init();
  }

  // ============================================================================
  // Abstract Method Implementations
  // ============================================================================

  protected collectRenderStats(): Partial<FrameSample> {
    // Read counters from last frame (captured by WebGL interception)
    const c = this.lastFrameCounters;

    // Texture count from PixiJS managed textures
    let textureCount = 0;
    if (this.app?.renderer?.texture?.managedTextures) {
      textureCount = this.app.renderer.texture.managedTextures.length;
    }

    // Rough texture memory estimate (PixiJS doesn't expose byte sizes)
    const avgTexBytes = 256 * 256 * 4; // Assume average 256x256 RGBA texture
    const textureBytes = textureCount * avgTexBytes;

    return {
      drawCalls: c.drawCalls,
      triangles: c.triangles,
      points: c.points,
      lines: c.lines,
      textureCount,
      textureBytes,
      geometryCount: 0, // PixiJS doesn't have a geometry pool like Three.js
      geometryBytes: 0,
      programCount: 0, // Not easily accessible in PixiJS
    };
  }

  protected collectSceneStats(): {
    totalObjects: number;
    visibleObjects: number;
    lightsCount: number;
    camerasCount: number;
  } {
    if (!this.app?.stage) {
      return { totalObjects: 0, visibleObjects: 0, lightsCount: 0, camerasCount: 0 };
    }

    let total = 0;
    let visible = 0;

    // Iterative traversal to avoid stack overflow
    const stack: PixiContainer[] = [this.app.stage];
    while (stack.length > 0) {
      const container = stack.pop()!;
      total++;
      if (container.visible) visible++;
      if (container.children) {
        for (let i = container.children.length - 1; i >= 0; i--) {
          stack.push(container.children[i]);
        }
      }
    }

    // PixiJS is 2D — no concept of lights or cameras
    return { totalObjects: total, visibleObjects: visible, lightsCount: 0, camerasCount: 0 };
  }

  protected hookRenderLoop(): void {
    if (!this.app || this.tickerCallback) return;

    // Hook WebGL draw calls for counting (Spector.js pattern)
    this.hookWebGLCalls();

    // Hook into PIXI ticker for per-frame measurement
    this.tickerCallback = () => {
      // Capture counters from this frame
      this.lastFrameCounters = { ...this.counters };

      // Reset counters for next frame
      this.counters.drawCalls = 0;
      this.counters.triangles = 0;
      this.counters.points = 0;
      this.counters.lines = 0;

      // GPU timer
      this.gpuTimer?.beginFrame();
      // Note: GPU timer end happens at the start of next frame since PIXI
      // has already submitted all draw calls by the time ticker fires
      this.gpuTimer?.endFrame();

      // For PixiJS, we don't have direct render call timing.
      // Use ticker.deltaMS as a rough CPU time estimate (it's the frame budget).
      const cpuTimeEstimate = this.app?.ticker?.deltaMS ?? 16.67;
      this.onFrameEnd(cpuTimeEstimate);
    };

    this.app.ticker.add(this.tickerCallback);
    this.log('Hooked PixiJS ticker for frame timing');
  }

  protected unhookRenderLoop(): void {
    // Remove ticker callback
    if (this.app && this.tickerCallback) {
      this.app.ticker.remove(this.tickerCallback);
      this.tickerCallback = null;
    }

    // Restore original WebGL functions
    this.unhookWebGLCalls();

    this.log('Unhooked PixiJS ticker');
  }

  protected isEngineReady(): boolean {
    const app = this.findPixiApp();
    return !!(app?.stage && app?.renderer && app?.ticker);
  }

  protected getGLContext(): WebGLRenderingContext | WebGL2RenderingContext | null {
    if (this.gl) return this.gl;

    // Try renderer.gl first (PixiJS v7/v8 internal)
    if (this.app?.renderer?.gl) {
      this.gl = this.app.renderer.gl;
      return this.gl;
    }

    // Fallback: get from canvas
    const canvas = this.getCanvas();
    if (canvas) {
      this.gl = (
        canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) ||
        canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false })
      );
      return this.gl;
    }

    return null;
  }

  protected getCanvas(): HTMLCanvasElement | null {
    return this.app?.canvas || this.app?.view || this.findGameCanvas();
  }

  protected getEngineInfo(): EngineInfo {
    const r = this.app?.renderer;
    const canvas = this.getCanvas();
    const gl = this.getGLContext();
    const isWebGL2 = gl instanceof WebGL2RenderingContext;

    return {
      name: 'PixiJS',
      version: win().PIXI?.VERSION ? String(win().PIXI?.VERSION) : 'unknown',
      renderer: r?.type === 2 ? 'Canvas2D' : (isWebGL2 ? 'WebGL2' : 'WebGL'),
      canvasWidth: canvas?.width ?? r?.width ?? 0,
      canvasHeight: canvas?.height ?? r?.height ?? 0,
      pixelRatio: r?.resolution ?? (window.devicePixelRatio || 1),
      maxTextureSize: gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) as number : undefined,
      antialias: gl ? !!gl.getContextAttributes()?.antialias : undefined,
    };
  }

  protected getHotObjects(): HotObject[] | null {
    if (!this.app?.stage) return null;

    const objects: HotObject[] = [];
    const stack: PixiContainer[] = [this.app.stage];

    while (stack.length > 0) {
      const container = stack.pop()!;
      const typeName = container.constructor?.name ?? 'Unknown';

      // Only include leaf nodes or named containers (skip generic containers)
      const isInteresting = typeName !== 'Container' || container.label || container.name;
      if (isInteresting && container !== this.app!.stage) {
        objects.push({
          name: container.label || container.name || typeName,
          type: typeName,
          triangles: typeName === 'Sprite' ? 2 : (typeName === 'Graphics' ? 10 : 0), // Sprites = 2 tris (quad)
          drawCalls: 1,
          textureBytes: 0, // Can't easily estimate per-sprite
          visible: container.visible,
          position: {
            x: (container as unknown as { position: { x: number; y: number } }).position?.x ?? 0,
            y: (container as unknown as { position: { x: number; y: number } }).position?.y ?? 0,
          },
        });
      }

      if (container.children) {
        for (let i = container.children.length - 1; i >= 0; i--) {
          stack.push(container.children[i]);
        }
      }
    }

    // Sort by children count (containers with most children are most expensive)
    return objects.slice(0, 20);
  }

  // ============================================================================
  // Engine Ready Handler
  // ============================================================================

  protected override onEngineReady(): void {
    this.app = this.findPixiApp();

    if (this.app) {
      this.log(`PixiJS ${win().PIXI?.VERSION ?? ''} detected`);
      this.log(`Stage: ${this.app.stage.children.length} top-level objects`);
    }

    super.onEngineReady();
  }

  // ============================================================================
  // WebGL Draw Call Interception (Spector.js pattern)
  // ============================================================================

  private hookWebGLCalls(): void {
    const gl = this.getGLContext();
    if (!gl) {
      this.log('No WebGL context — draw call counting unavailable', 'warn');
      return;
    }

    const counters = this.counters;

    // GL draw mode constants
    const GL_POINTS = 0;
    const GL_LINES = 1;
    const GL_LINE_LOOP = 2;
    const GL_LINE_STRIP = 3;
    const GL_TRIANGLES = 4;
    const GL_TRIANGLE_STRIP = 5;
    const GL_TRIANGLE_FAN = 6;

    // Helper to count primitives from draw mode and vertex count
    const countPrimitives = (mode: number, count: number) => {
      counters.drawCalls++;
      switch (mode) {
        case GL_TRIANGLES:
          counters.triangles += count / 3;
          break;
        case GL_TRIANGLE_STRIP:
        case GL_TRIANGLE_FAN:
          counters.triangles += Math.max(0, count - 2);
          break;
        case GL_LINES:
          counters.lines += count / 2;
          break;
        case GL_LINE_LOOP:
          counters.lines += count;
          break;
        case GL_LINE_STRIP:
          counters.lines += Math.max(0, count - 1);
          break;
        case GL_POINTS:
          counters.points += count;
          break;
      }
    };

    // Hook drawElements
    this.originalDrawElements = gl.drawElements.bind(gl);
    gl.drawElements = (mode: number, count: number, type: number, offset: number) => {
      countPrimitives(mode, count);
      return this.originalDrawElements!(mode, count, type, offset);
    };

    // Hook drawArrays
    this.originalDrawArrays = gl.drawArrays.bind(gl);
    gl.drawArrays = (mode: number, first: number, count: number) => {
      countPrimitives(mode, count);
      return this.originalDrawArrays!(mode, first, count);
    };

    // Hook instanced draw calls (WebGL2)
    if ('drawElementsInstanced' in gl) {
      const gl2 = gl as WebGL2RenderingContext;
      this.originalDrawElementsInstanced = gl2.drawElementsInstanced.bind(gl2);
      gl2.drawElementsInstanced = (mode: number, count: number, type: number, offset: number, instanceCount: number) => {
        countPrimitives(mode, count * instanceCount);
        return (this.originalDrawElementsInstanced as Function)(mode, count, type, offset, instanceCount);
      };
    }

    if ('drawArraysInstanced' in gl) {
      const gl2 = gl as WebGL2RenderingContext;
      this.originalDrawArraysInstanced = gl2.drawArraysInstanced.bind(gl2);
      gl2.drawArraysInstanced = (mode: number, first: number, count: number, instanceCount: number) => {
        countPrimitives(mode, count * instanceCount);
        return (this.originalDrawArraysInstanced as Function)(mode, first, count, instanceCount);
      };
    }

    this.log('WebGL draw call interception active');
  }

  private unhookWebGLCalls(): void {
    const gl = this.gl;
    if (!gl) return;

    if (this.originalDrawElements) {
      gl.drawElements = this.originalDrawElements;
      this.originalDrawElements = null;
    }

    if (this.originalDrawArrays) {
      gl.drawArrays = this.originalDrawArrays;
      this.originalDrawArrays = null;
    }

    if (this.originalDrawElementsInstanced && 'drawElementsInstanced' in gl) {
      (gl as WebGL2RenderingContext).drawElementsInstanced = this.originalDrawElementsInstanced as WebGL2RenderingContext['drawElementsInstanced'];
      this.originalDrawElementsInstanced = null;
    }

    if (this.originalDrawArraysInstanced && 'drawArraysInstanced' in gl) {
      (gl as WebGL2RenderingContext).drawArraysInstanced = this.originalDrawArraysInstanced as WebGL2RenderingContext['drawArraysInstanced'];
      this.originalDrawArraysInstanced = null;
    }

    this.log('WebGL draw call interception removed');
  }

  // ============================================================================
  // PixiJS App Detection (same pattern as PixiInspector)
  // ============================================================================

  private findPixiApp(): PixiApplication | null {
    const known = win().__PIXI_APP__;
    if (known) return known;

    const w = window as unknown as Record<string, unknown>;
    if (w.app && this.isPixiApp(w.app)) return w.app as PixiApplication;
    if (w.game && this.isPixiApp(w.game)) return w.game as PixiApplication;
    if (w.pixiApp && this.isPixiApp(w.pixiApp)) return w.pixiApp as PixiApplication;

    if (win().PIXI) {
      const pixi = win().PIXI as unknown as Record<string, unknown>;
      if (pixi.app && this.isPixiApp(pixi.app)) return pixi.app as PixiApplication;
    }

    for (const key in window) {
      try {
        const val = w[key];
        if (val && this.isPixiApp(val)) return val as PixiApplication;
      } catch {
        // Skip inaccessible properties
      }
    }

    return null;
  }

  private isPixiApp(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const app = obj as Record<string, unknown>;
    return !!(app.stage && app.renderer && app.ticker);
  }

  private findGameCanvas(): HTMLCanvasElement | null {
    const canvases = document.querySelectorAll('canvas');
    for (const canvas of canvases) {
      const c = canvas as HTMLCanvasElement & { __pixi_app?: unknown; __PIXI_APP__?: unknown };
      if (c.__pixi_app || c.__PIXI_APP__ || canvas.getAttribute('data-pixi')) {
        return canvas;
      }
    }
    return canvases[0] || null;
  }
}
