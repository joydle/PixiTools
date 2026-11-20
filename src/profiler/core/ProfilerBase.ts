/**
 * ProfilerBase - Abstract base class for all engine profilers
 *
 * Provides shared functionality for frame sampling, aggregation, warning
 * detection, HUD overlay, and PostMessage communication.
 *
 * Each engine (Three.js, PixiJS) extends this class and implements
 * the abstract methods for engine-specific metric collection.
 *
 * Architecture mirrors InspectorBase:
 * - Template Method pattern (abstract methods for engine specifics)
 * - Same lifecycle: construct → init → waitForEngine → onEngineReady → sample loop
 * - Same PostMessage IPC via MessageBridge
 */

import type {
  EngineType,
  FrameSample,
  FrameStats,
  FramePacingMetrics,
  BottleneckAnalysis,
  LoafEntry,
  MinMaxAvg,
  ProfilerSnapshot,
  ProfilerWarning,
  ProfilerConfig,
  EngineInfo,
  HotObject,
  WarningCategory,
  WarningSeverity,
  PerformanceScore,
  PerformanceIssue,
} from './types';
import { DEFAULT_CONFIG, formatProfilerReport, scoreToGrade, ISSUE_CATEGORY_ICONS } from './types';
import { TimeWindowedRingBuffer } from './TimeWindowedRingBuffer';
import { percentile } from './percentiles';
import { computeBurnRate } from './burnRate';
import type { WindowedStats } from './types';
import { MessageBridge } from './MessageBridge';
import { GPUTimerQuery } from './GPUTimerQuery';
import { NAME, globalSlot } from '../../brand';

declare global {
  interface Window {
  }
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
}

export interface ProfilerAPI {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  getSnapshot: () => ProfilerSnapshot;
  getReport: () => string;
}

export abstract class ProfilerBase {
  // Engine identification
  abstract readonly engineType: EngineType;

  // Core utilities
  protected messages!: MessageBridge;
  protected ringBuffer: TimeWindowedRingBuffer<FrameSample>;
  protected gpuTimer: GPUTimerQuery | null = null;

  // State
  protected config: ProfilerConfig;
  protected isRunning = false;
  protected profilingStartTime = 0;
  protected lastSampleSentTime = 0;
  protected lastFrameTimestamp = 0;
  protected accumulatedCpuTime = 0;
  protected sampleAccumulator: FrameSample[] = [];
  protected warnings: ProfilerWarning[] = [];
  private warningHashes = new Set<string>();
  private sceneStatsCache: { totalObjects: number; visibleObjects: number; lightsCount: number; camerasCount: number } | null = null;
  private sceneStatsCacheTime = 0;
  private readonly SCENE_STATS_CACHE_MS = 200; // Throttle scene traversal to 5x/sec

  // Microtask-based frame boundary detection (replaces fragile 2ms debounce).
  // Multi-camera / multi-pass setups call render() multiple times per display frame.
  // We accumulate all render() calls and emit ONE sample via queueMicrotask, which
  // fires after all synchronous code in the game's rAF callback completes but before
  // the browser paints. This avoids rAF callback ordering issues where our emit
  // callback and the game's animate callback compete for execution order.
  private pendingFrameEmit = false;

  // Accumulated render stats across multi-pass rendering within a single display frame.
  // Three.js autoReset wipes renderer.info at the start of each render() call, so we
  // must capture and accumulate stats after each pass in onFrameEnd().
  private frameRenderStats: Partial<FrameSample> = {};

  // WebGL state change tracking (batching efficiency)
  private stateChangeCounters = { programSwitches: 0, textureSwitches: 0, fboSwitches: 0 };
  private lastFrameStateChanges = { programSwitches: 0, textureSwitches: 0, fboSwitches: 0 };
  private originalUseProgram: ((program: WebGLProgram | null) => void) | null = null;
  private originalBindTexture: ((target: number, texture: WebGLTexture | null) => void) | null = null;
  private originalBindFramebuffer: ((target: number, framebuffer: WebGLFramebuffer | null) => void) | null = null;

  // Performance score EMA smoothing (prevents flicker)
  private lastComputedScore = -1;

  // Long Animation Frame (LoAF) tracking
  private loafObserver: PerformanceObserver | null = null;
  private loafEntries: LoafEntry[] = [];

  // ============================================================================
  // Abstract Methods - Each engine must implement
  // ============================================================================

  /**
   * Collect current frame's render stats from the engine.
   * Should be cheap — reads from engine's internal counters (e.g., renderer.info).
   */
  protected abstract collectRenderStats(): Partial<FrameSample>;

  /**
   * Collect scene graph statistics.
   * May involve scene traversal — called throttled (not every frame).
   */
  protected abstract collectSceneStats(): {
    totalObjects: number;
    visibleObjects: number;
    lightsCount: number;
    camerasCount: number;
  };

  /**
   * Hook into the engine's render loop for frame timing.
   * Must call this.onFrameEnd() at the end of each frame.
   */
  protected abstract hookRenderLoop(): void;

  /**
   * Unhook from the engine's render loop.
   */
  protected abstract unhookRenderLoop(): void;

  /**
   * Check if the engine is ready for profiling.
   */
  protected abstract isEngineReady(): boolean;

  /**
   * Get the WebGL/WebGPU rendering context for GPU timer queries.
   */
  protected abstract getGLContext(): WebGLRenderingContext | WebGL2RenderingContext | null;

  /**
   * Get the game's canvas element.
   */
  protected abstract getCanvas(): HTMLCanvasElement | null;

  /**
   * Get engine-specific information (name, version, renderer type, etc.).
   */
  protected abstract getEngineInfo(): EngineInfo;

  /**
   * Get the top objects by rendering cost (optional — for detailed reports).
   * Returns null if not supported by this engine.
   */
  protected abstract getHotObjects(): HotObject[] | null;

  // ============================================================================
  // Constructor & Initialization
  // ============================================================================

  constructor(config: Partial<ProfilerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ringBuffer = new TimeWindowedRingBuffer<FrameSample>(this.config.bufferSize);
  }

  /**
   * Initialize the profiler.
   * Called after subclass sets up engine-specific properties.
   */
  protected init(): void {
    // Create message bridge (engineType is now available)
    this.messages = new MessageBridge(this.engineType);

    // Set up message handlers
    this.setupMessageHandlers();

    // Wait for engine to be ready
    this.waitForEngine();

    // Expose global API
    this.exposeGlobalAPI();

    this.log('Profiler initialized');
  }

  private waitForEngine(): void {
    const startTime = Date.now();
    const fastPhase = 15000; // fast 100ms polls for 15s…
    let slow = false;

    const check = () => {
      if (this.isEngineReady()) {
        this.onEngineReady();
        return;
      }
      // …then never give up: menu-first games construct the renderer only when
      // gameplay starts, which can be minutes after load. A slow no-op poll is
      // free; giving up loses the whole profiler for the session.
      if (!slow && Date.now() - startTime > fastPhase) {
        slow = true;
        this.log('Engine not detected yet — continuing to poll slowly (menu-first game?)', 'warn');
      }
      setTimeout(check, slow ? 2000 : 100);
    };

    setTimeout(check, 100);
  }

  protected onEngineReady(): void {
    this.log('Engine detected');

    // Initialize GPU timer
    const gl = this.getGLContext();
    if (gl) {
      this.gpuTimer = new GPUTimerQuery(gl);
      if (this.gpuTimer.available) {
        this.log('GPU timer query available');
      }
    }

    // Notify parent
    this.messages.send({ type: 'PROFILER_READY' });
    this.messages.send({ type: 'PROFILER_ENGINE_DETECTED', engine: this.engineType });

    // Auto-start profiling
    this.start();
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  private setupMessageHandlers(): void {
    this.messages.on('PROFILER_START', (msg) => {
      if (msg.config) {
        this.updateConfig(msg.config);
      }
      this.start();
    });

    this.messages.on('PROFILER_STOP', () => {
      this.stop();
    });

    this.messages.on('PROFILER_REQUEST_SNAPSHOT', () => {
      const snapshot = this.buildSnapshot();
      this.messages.send({ type: 'PROFILER_SNAPSHOT', snapshot });
    });

    this.messages.on('PROFILER_SET_CONFIG', (msg) => {
      if (msg.config) {
        this.updateConfig(msg.config);
      }
    });
  }

  // ============================================================================
  // Start / Stop
  // ============================================================================

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.profilingStartTime = performance.now();
    this.lastSampleSentTime = performance.now();
    this.lastFrameTimestamp = 0;
    this.accumulatedCpuTime = 0;
    this.frameRenderStats = {};
    this.pendingFrameEmit = false;
    this.sampleAccumulator = [];
    this.warnings = [];
    this.warningHashes.clear();

    // Hook render loop
    this.hookRenderLoop();

    // Hook WebGL state changes for batching analysis
    this.hookStateChangeTracking();

    // Start Long Animation Frame observer
    this.startLoafObserver();

    this.log('Profiling started');
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    // Unhook render loop
    this.unhookRenderLoop();

    // Unhook WebGL state changes
    this.unhookStateChangeTracking();

    // Stop LoAF observer
    this.stopLoafObserver();

    this.log('Profiling stopped');
  }

  // ============================================================================
  // Frame Sampling — called by engine subclass after each frame
  // ============================================================================

  /**
   * Called by the engine subclass after each renderer.render() call.
   * Multiple calls per display frame are expected (shadow passes, multi-camera,
   * post-processing). We accumulate CPU time AND render stats, then schedule
   * ONE sample emission via queueMicrotask.
   *
   * Why queueMicrotask instead of requestAnimationFrame?
   * - rAF callbacks registered during another rAF run in the NEXT frame, causing
   *   our emit to interleave with the game's animate loop (every-other-frame bug).
   * - Microtasks fire after all synchronous code in the current task completes,
   *   so all renderer.render() calls accumulate first, then we emit once.
   *
   * @param renderTime - CPU-side duration of this render call in ms
   */
  protected onFrameEnd(renderTime: number): void {
    if (!this.isRunning) return;

    // Accumulate CPU render time across all render() calls in this display frame
    this.accumulatedCpuTime += renderTime;

    // Accumulate render stats from this pass.
    // For Three.js: autoReset wipes renderer.info at start of each render(), so we
    // capture stats after each pass and sum the additive fields.
    // For PixiJS: only one onFrameEnd() per frame, so this is a simple passthrough.
    let pass: Partial<FrameSample>;
    try {
      pass = this.collectRenderStats();
    } catch {
      pass = {}; // Engine state invalid — skip this pass
    }
    const acc = this.frameRenderStats;

    // Additive stats: sum across all passes in this display frame
    acc.drawCalls = (acc.drawCalls || 0) + (pass.drawCalls || 0);
    acc.triangles = (acc.triangles || 0) + (pass.triangles || 0);
    acc.points = (acc.points || 0) + (pass.points || 0);
    acc.lines = (acc.lines || 0) + (pass.lines || 0);

    // Resource counts: take latest value (don't change between passes)
    if (pass.textureCount !== undefined) acc.textureCount = pass.textureCount;
    if (pass.textureBytes !== undefined) acc.textureBytes = pass.textureBytes;
    if (pass.geometryCount !== undefined) acc.geometryCount = pass.geometryCount;
    if (pass.geometryBytes !== undefined) acc.geometryBytes = pass.geometryBytes;
    if (pass.programCount !== undefined) acc.programCount = pass.programCount;

    // Schedule a single sample emission via microtask.
    // All synchronous render() calls complete first, THEN this fires.
    if (!this.pendingFrameEmit) {
      this.pendingFrameEmit = true;
      queueMicrotask(() => this.emitFrameSample());
    }
  }

  /**
   * Emit one profiler sample per display frame (called from microtask).
   * Fires after all synchronous renderer.render() calls in the game's rAF
   * callback have completed, so frameRenderStats is fully accumulated.
   */
  private emitFrameSample(): void {
    this.pendingFrameEmit = false;
    if (!this.isRunning) return;

    const now = performance.now();
    const deltaTime = this.lastFrameTimestamp > 0 ? now - this.lastFrameTimestamp : 16.67;
    this.lastFrameTimestamp = now;

    // Capture and reset state change counters for this frame
    this.lastFrameStateChanges = { ...this.stateChangeCounters };
    this.stateChangeCounters.programSwitches = 0;
    this.stateChangeCounters.textureSwitches = 0;
    this.stateChangeCounters.fboSwitches = 0;

    // Use accumulated render stats from all passes, then reset
    const sample = this.buildFrameSample(deltaTime, this.accumulatedCpuTime, this.frameRenderStats);
    this.accumulatedCpuTime = 0;
    this.frameRenderStats = {};
    this.ringBuffer.push(sample);
    this.sampleAccumulator.push(sample);

    // Send aggregated sample to parent at configured interval
    if (now - this.lastSampleSentTime >= this.config.sampleInterval) {
      const stats = this.aggregateStats(this.sampleAccumulator);
      const newWarnings = this.detectWarnings(stats);

      this.messages.send({
        type: 'PROFILER_SAMPLE',
        stats,
        warnings: newWarnings,
      });

      // Send individual warnings
      for (const warning of newWarnings) {
        this.messages.send({ type: 'PROFILER_WARNING', warning });
      }

      this.sampleAccumulator = [];
      this.lastSampleSentTime = now;
    }
  }

  private buildFrameSample(frameTime: number, cpuTime: number, renderStats: Partial<FrameSample>): FrameSample {
    const sceneStats = this.getSceneStatsCached();
    const gpuTime = this.gpuTimer?.getResult() ?? null;

    // JS heap memory (Chrome only)
    let jsHeapUsed: number | null = null;
    let jsHeapTotal: number | null = null;
    if (performance.memory) {
      jsHeapUsed = performance.memory.usedJSHeapSize;
      jsHeapTotal = performance.memory.totalJSHeapSize;
    }

    return {
      timestamp: performance.now(),
      frameTime,
      fps: frameTime > 0 ? 1000 / frameTime : 0,
      cpuTime,
      drawCalls: renderStats.drawCalls || 0,
      triangles: renderStats.triangles || 0,
      points: renderStats.points || 0,
      lines: renderStats.lines || 0,
      textureCount: renderStats.textureCount || 0,
      textureBytes: renderStats.textureBytes || 0,
      geometryCount: renderStats.geometryCount || 0,
      geometryBytes: renderStats.geometryBytes || 0,
      programCount: renderStats.programCount || 0,
      programSwitches: this.lastFrameStateChanges.programSwitches,
      textureSwitches: this.lastFrameStateChanges.textureSwitches,
      fboSwitches: this.lastFrameStateChanges.fboSwitches,
      totalObjects: sceneStats.totalObjects,
      visibleObjects: sceneStats.visibleObjects,
      lightsCount: sceneStats.lightsCount,
      camerasCount: sceneStats.camerasCount,
      gpuTime,
      jsHeapUsed,
      jsHeapTotal,
    };
  }

  /**
   * Cache scene stats to avoid traversing the scene graph every frame.
   * Scene stats (object counts, lights) change infrequently compared to render stats.
   */
  private getSceneStatsCached(): { totalObjects: number; visibleObjects: number; lightsCount: number; camerasCount: number } {
    const now = performance.now();
    if (!this.sceneStatsCache || now - this.sceneStatsCacheTime > this.SCENE_STATS_CACHE_MS) {
      try {
        this.sceneStatsCache = this.collectSceneStats();
      } catch {
        this.sceneStatsCache = { totalObjects: 0, visibleObjects: 0, lightsCount: 0, camerasCount: 0 };
      }
      this.sceneStatsCacheTime = now;
    }
    return this.sceneStatsCache;
  }

  // ============================================================================
  // Stats Aggregation
  // ============================================================================

  private aggregateStats(samples: FrameSample[]): FrameStats {
    if (samples.length === 0) {
      return this.emptyStats();
    }

    const last = samples[samples.length - 1];

    const fpsValues = samples.map(s => s.fps);
    const frameTimeValues = samples.map(s => s.frameTime);
    const cpuTimeValues = samples.map(s => s.cpuTime);

    const cpuStats = this.computeMinMaxAvg(cpuTimeValues);

    const stats: FrameStats = {
      fps: this.computeMinMaxAvg(fpsValues),
      frameTime: this.computeMinMaxAvg(frameTimeValues),
      cpuTime: cpuStats,
      drawCalls: last.drawCalls,
      triangles: last.triangles,
      points: last.points,
      lines: last.lines,
      textureCount: last.textureCount,
      textureMemoryMB: last.textureBytes / 1024 / 1024,
      geometryCount: last.geometryCount,
      geometryMemoryMB: last.geometryBytes / 1024 / 1024,
      programCount: last.programCount,
      programSwitches: last.programSwitches,
      textureSwitches: last.textureSwitches,
      fboSwitches: last.fboSwitches,
      totalObjects: last.totalObjects,
      visibleObjects: last.visibleObjects,
      lightsCount: last.lightsCount,
      camerasCount: last.camerasCount,
      gpuTime: last.gpuTime,
      jsHeapUsedMB: last.jsHeapUsed !== null ? last.jsHeapUsed / 1024 / 1024 : null,
      framePacing: this.computeFramePacing(samples),
      bottleneck: this.classifyBottleneck(cpuStats.avg, last.gpuTime, this.computeMinMaxAvg(frameTimeValues).avg, last.drawCalls),
      sampleCount: samples.length,
    };

    // Compute simplified performance score for non-coders
    stats.performanceScore = this.computePerformanceScore(stats);

    return stats;
  }

  private computeMinMaxAvg(values: number[]): MinMaxAvg {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;

    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }

    return {
      current: values[values.length - 1],
      min,
      max,
      avg: sum / values.length,
    };
  }

  private emptyStats(): FrameStats {
    return {
      fps: { current: 0, min: 0, max: 0, avg: 0 },
      frameTime: { current: 0, min: 0, max: 0, avg: 0 },
      cpuTime: { current: 0, min: 0, max: 0, avg: 0 },
      drawCalls: 0, triangles: 0, points: 0, lines: 0,
      textureCount: 0, textureMemoryMB: 0,
      geometryCount: 0, geometryMemoryMB: 0,
      programCount: 0,
      programSwitches: 0, textureSwitches: 0, fboSwitches: 0,
      totalObjects: 0, visibleObjects: 0, lightsCount: 0, camerasCount: 0,
      gpuTime: null, jsHeapUsedMB: null,
      framePacing: this.emptyFramePacing(),
      bottleneck: { type: 'unknown', description: 'Insufficient data', confidence: 0, suggestion: '' },
      sampleCount: 0,
    };
  }

  // ============================================================================
  // Warning Detection
  // ============================================================================

  private detectWarnings(stats: FrameStats): ProfilerWarning[] {
    const newWarnings: ProfilerWarning[] = [];
    const now = performance.now();
    const t = this.config.thresholds;

    // FPS warnings
    if (stats.fps.avg > 0 && stats.fps.avg < t.fps.yellow) {
      this.addWarning(newWarnings, 'fps',
        stats.fps.avg < t.fps.yellow / 2 ? 'critical' : 'warning',
        `Average FPS is ${stats.fps.avg.toFixed(1)} (below ${t.fps.yellow})`,
        stats.fps.avg, t.fps.yellow,
        'Consider reducing draw calls, lowering resolution, or simplifying geometry. Use LOD (Level of Detail) for distant objects.',
        now,
      );
    }

    // Frame time
    if (stats.frameTime.avg > t.frameTime.yellow) {
      this.addWarning(newWarnings, 'frame_time',
        stats.frameTime.avg > t.frameTime.yellow * 2 ? 'critical' : 'warning',
        `Average frame time is ${stats.frameTime.avg.toFixed(1)}ms (above ${t.frameTime.yellow}ms)`,
        stats.frameTime.avg, t.frameTime.yellow,
        'Profile individual systems. Common causes: expensive shaders, too many lights with shadows, unoptimized physics, GC pauses.',
        now,
      );
    }

    // Draw calls
    if (stats.drawCalls > t.drawCalls.yellow) {
      this.addWarning(newWarnings, 'draw_calls',
        stats.drawCalls > t.drawCalls.yellow * 3 ? 'critical' : 'warning',
        `Draw calls: ${stats.drawCalls.toLocaleString()} (above ${t.drawCalls.yellow})`,
        stats.drawCalls, t.drawCalls.yellow,
        'Batch similar materials, use instanced rendering (InstancedMesh/InstancedBufferGeometry), merge static geometry, use texture atlases.',
        now,
      );
    }

    // Triangles
    if (stats.triangles > t.triangles.yellow) {
      this.addWarning(newWarnings, 'triangles',
        stats.triangles > t.triangles.yellow * 3 ? 'critical' : 'warning',
        `Triangle count: ${stats.triangles.toLocaleString()} (above ${t.triangles.yellow.toLocaleString()})`,
        stats.triangles, t.triangles.yellow,
        'Use LOD, reduce polygon count on distant/small objects, enable frustum culling, consider simpler geometry for non-hero assets.',
        now,
      );
    }

    // Texture memory
    if (stats.textureMemoryMB > t.textureMemoryMB.yellow) {
      this.addWarning(newWarnings, 'texture_memory',
        stats.textureMemoryMB > t.textureMemoryMB.yellow * 2 ? 'critical' : 'warning',
        `Texture memory: ${stats.textureMemoryMB.toFixed(1)}MB (above ${t.textureMemoryMB.yellow}MB)`,
        stats.textureMemoryMB, t.textureMemoryMB.yellow,
        'Use compressed textures (KTX2/Basis), reduce texture resolution, use power-of-2 sizes, share textures via atlases, dispose unused textures.',
        now,
      );
    }

    // Geometry memory
    if (stats.geometryMemoryMB > t.geometryMemoryMB.yellow) {
      this.addWarning(newWarnings, 'geometry_memory',
        stats.geometryMemoryMB > t.geometryMemoryMB.yellow * 2 ? 'critical' : 'warning',
        `Geometry memory: ${stats.geometryMemoryMB.toFixed(1)}MB (above ${t.geometryMemoryMB.yellow}MB)`,
        stats.geometryMemoryMB, t.geometryMemoryMB.yellow,
        'Share geometry between meshes, use BufferGeometry instead of Geometry, dispose unused geometries, use instancing for repeated shapes.',
        now,
      );
    }

    // Shader count
    if (stats.programCount > 50) {
      this.addWarning(newWarnings, 'shader_count', 'warning',
        `Shader programs: ${stats.programCount} (many unique materials)`,
        stats.programCount, 50,
        'Reduce material variations, share materials between objects, consider using a single uber-shader with defines.',
        now,
      );
    }

    // GPU time
    if (stats.gpuTime !== null && stats.gpuTime > 16) {
      this.addWarning(newWarnings, 'gpu_time',
        stats.gpuTime > 33 ? 'critical' : 'warning',
        `GPU time: ${stats.gpuTime.toFixed(1)}ms (above 16ms budget)`,
        stats.gpuTime, 16,
        'Simplify shaders, reduce overdraw, lower shadow map resolution, use fewer real-time lights, consider baked lighting.',
        now,
      );
    }

    return newWarnings;
  }

  private addWarning(
    list: ProfilerWarning[],
    category: WarningCategory,
    severity: WarningSeverity,
    message: string,
    value: number,
    threshold: number,
    suggestion: string,
    timestamp: number,
  ): void {
    const hash = `${category}-${severity}`;
    if (this.warningHashes.has(hash)) return;

    this.warningHashes.add(hash);
    const warning: ProfilerWarning = {
      id: `${category}-${Date.now()}`,
      severity,
      category,
      message,
      value,
      threshold,
      timestamp,
      suggestion,
    };

    list.push(warning);
    this.warnings.push(warning);
  }

  // ============================================================================
  // Frame Pacing — smoothness beyond raw FPS
  // ============================================================================

  private computeFramePacing(samples: FrameSample[]): FramePacingMetrics {
    if (samples.length < 2) return this.emptyFramePacing();

    const frameTimes = samples.map(s => s.frameTime);
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;

    // Standard deviation
    const variance = frameTimes.reduce((sum, ft) => sum + (ft - avg) ** 2, 0) / frameTimes.length;
    const stdDev = Math.sqrt(variance);

    // Consistency: % of frames within 10% of 16.67ms target
    const target = 16.67;
    const tolerance = target * 0.1;
    const onTarget = frameTimes.filter(ft => Math.abs(ft - target) <= tolerance).length;
    const consistencyPercent = (onTarget / frameTimes.length) * 100;

    // Janks per minute: frames > 2x average
    const jankThreshold = avg * 2;
    const jankCount = frameTimes.filter(ft => ft > jankThreshold).length;
    const durationSec = samples.length > 0
      ? (samples[samples.length - 1].timestamp - samples[0].timestamp) / 1000
      : 1;
    const janksPerMinute = durationSec > 0 ? (jankCount / durationSec) * 60 : 0;

    // Longest smooth streak (frames within 1.5x of average)
    const smoothThreshold = avg * 1.5;
    let longestStreak = 0;
    let currentStreak = 0;
    for (const ft of frameTimes) {
      if (ft <= smoothThreshold) {
        currentStreak++;
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      } else {
        currentStreak = 0;
      }
    }

    // Histogram: [0-8ms, 8-16ms, 16-33ms, 33-50ms, 50ms+]
    const histogram: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const ft of frameTimes) {
      if (ft < 8) histogram[0]++;
      else if (ft < 16) histogram[1]++;
      else if (ft < 33) histogram[2]++;
      else if (ft < 50) histogram[3]++;
      else histogram[4]++;
    }

    // Trend: compare worst-frame p99 across first/second halves AGAINST the
    // target frame time (configured via `thresholds.frameTime.green`, default
    // 18 ms ≈ 55fps). Only fire "degrading" when the worst frames in the
    // second half are both materially worse than the first half AND actually
    // missing the target — otherwise stable, even if variance drifted, since
    // imperceptible jitter on a smooth run shouldn't surface as a warning.
    //
    // Replaces a raw variance-ratio comparison that fired on minor noise
    // when both halves were well within budget.
    let varianceTrend: 'stable' | 'degrading' | 'improving' = 'stable';
    const MIN_SAMPLES_FOR_TREND = 120; // ~2s @60fps; below this it's noise
    const REL_RATIO_DEGRADING = 1.20;  // 20% worse p99
    const REL_RATIO_IMPROVING = 0.83;  // ~17% better p99
    if (frameTimes.length >= MIN_SAMPLES_FOR_TREND) {
      const targetFrameMs = this.config.thresholds.frameTime.green;
      const mid = Math.floor(frameTimes.length / 2);
      const firstHalf = frameTimes.slice(0, mid).sort((a, b) => a - b);
      const secondHalf = frameTimes.slice(mid).sort((a, b) => a - b);
      const firstP99 = firstHalf[Math.floor(firstHalf.length * 0.99)] ?? 0;
      const secondP99 = secondHalf[Math.floor(secondHalf.length * 0.99)] ?? 0;

      if (secondP99 > firstP99 * REL_RATIO_DEGRADING && secondP99 > targetFrameMs) {
        varianceTrend = 'degrading';
      } else if (secondP99 < firstP99 * REL_RATIO_IMPROVING && firstP99 > targetFrameMs) {
        varianceTrend = 'improving';
      }
    }

    return { frameTimeStdDev: stdDev, consistencyPercent, janksPerMinute, longestSmoothStreak: longestStreak, histogram, varianceTrend };
  }

  private emptyFramePacing(): FramePacingMetrics {
    return {
      frameTimeStdDev: 0, consistencyPercent: 0, janksPerMinute: 0,
      longestSmoothStreak: 0, histogram: [0, 0, 0, 0, 0], varianceTrend: 'stable',
    };
  }

  // ============================================================================
  // Bottleneck Classification
  // ============================================================================

  private classifyBottleneck(avgCpuTime: number, gpuTime: number | null, avgFrameTime: number, drawCalls: number): BottleneckAnalysis {
    if (avgFrameTime <= 0) {
      return { type: 'unknown', description: 'Insufficient data', confidence: 0, suggestion: '' };
    }

    // Vsync limited: frame time ~16.67ms and both CPU and GPU have headroom
    if (avgFrameTime <= 17.5 && avgCpuTime < 12 && (gpuTime === null || gpuTime < 12)) {
      return {
        type: 'vsync-limited',
        description: 'Running at vsync cap with headroom available',
        confidence: 0.9,
        suggestion: 'Performance is good. Add more visual quality or increase simulation complexity.',
      };
    }

    const hasGpu = gpuTime !== null && gpuTime > 0;

    // Draw call bound: high draw calls AND high CPU time
    if (drawCalls > 500 && avgCpuTime > 10) {
      return {
        type: 'draw-call-bound',
        description: `${drawCalls} draw calls causing ${avgCpuTime.toFixed(1)}ms CPU overhead`,
        confidence: 0.85,
        suggestion: 'Use InstancedMesh for repeated geometry, merge static meshes, share materials, use texture atlases.',
      };
    }

    if (hasGpu) {
      const ratio = avgCpuTime / gpuTime!;

      if (ratio > 2.0) {
        return {
          type: 'cpu-bound',
          description: `CPU render time (${avgCpuTime.toFixed(1)}ms) is ${ratio.toFixed(1)}x GPU time (${gpuTime!.toFixed(1)}ms)`,
          confidence: Math.min(0.95, 0.6 + ratio * 0.1),
          suggestion: 'Reduce draw call count, simplify scene graph, optimize JavaScript logic, use web workers for heavy computation.',
        };
      }

      if (ratio < 0.5) {
        return {
          type: 'gpu-bound',
          description: `GPU time (${gpuTime!.toFixed(1)}ms) is ${(1 / ratio).toFixed(1)}x CPU time (${avgCpuTime.toFixed(1)}ms)`,
          confidence: Math.min(0.95, 0.6 + (1 / ratio) * 0.1),
          suggestion: 'Simplify shaders, reduce overdraw, lower shadow/texture resolution, use LOD, reduce post-processing passes.',
        };
      }
    }

    // Main thread blocked: frame time much larger than render time
    const renderBudget = hasGpu ? Math.max(avgCpuTime, gpuTime!) : avgCpuTime;
    if (avgFrameTime > renderBudget * 2 && renderBudget > 0) {
      return {
        type: 'main-thread',
        description: `Frame time (${avgFrameTime.toFixed(1)}ms) is ${(avgFrameTime / renderBudget).toFixed(1)}x render time (${renderBudget.toFixed(1)}ms) — non-render work blocking`,
        confidence: 0.75,
        suggestion: 'Profile JavaScript execution. Check for GC pauses, expensive physics, or layout thrashing between frames.',
      };
    }

    return {
      type: 'balanced',
      description: 'No single bottleneck detected — CPU and GPU load are balanced',
      confidence: 0.5,
      suggestion: 'For further optimization, reduce scene complexity across the board or enable LOD.',
    };
  }

  // ============================================================================
  // Performance Score — simplified 0-100 for non-coders
  // ============================================================================

  private computePerformanceScore(stats: FrameStats): PerformanceScore {
    const t = this.config.thresholds;

    // --- FPS sub-score (40% weight): 60+ = 100, 30 = 50, <15 = 0 ---
    const fpsScore = stats.fps.avg >= 60 ? 100
      : stats.fps.avg >= 30 ? 50 + (stats.fps.avg - 30) / 30 * 50
      : Math.max(0, stats.fps.avg / 30 * 50);

    // --- Smoothness sub-score (20% weight) ---
    const pacing = stats.framePacing;
    const smoothnessScore = Math.max(0, Math.min(100,
      pacing.consistencyPercent * 0.4 +
      Math.max(0, 100 - pacing.janksPerMinute * 5) * 0.3 +
      Math.max(0, 100 - pacing.frameTimeStdDev * 10) * 0.3
    ));

    // --- Memory sub-score (15% weight) ---
    const totalMemMB = stats.textureMemoryMB + stats.geometryMemoryMB;
    const memGreen = t.textureMemoryMB.green;
    const memYellow = t.textureMemoryMB.yellow;
    const memoryScore = totalMemMB <= memGreen ? 100
      : totalMemMB <= memYellow ? 50 + (1 - (totalMemMB - memGreen) / (memYellow - memGreen)) * 50
      : Math.max(0, 50 - (totalMemMB - memYellow) / memYellow * 50);

    // --- Render efficiency sub-score (15% weight) ---
    const dcScore = stats.drawCalls <= t.drawCalls.green ? 100
      : stats.drawCalls <= t.drawCalls.yellow ? 50 + (1 - (stats.drawCalls - t.drawCalls.green) / (t.drawCalls.yellow - t.drawCalls.green)) * 50
      : Math.max(0, 50 - (stats.drawCalls - t.drawCalls.yellow) / t.drawCalls.yellow * 50);
    const triScore = stats.triangles <= t.triangles.green ? 100
      : stats.triangles <= t.triangles.yellow ? 50 + (1 - (stats.triangles - t.triangles.green) / (t.triangles.yellow - t.triangles.green)) * 50
      : Math.max(0, 50 - (stats.triangles - t.triangles.yellow) / t.triangles.yellow * 50);
    const renderScore = (dcScore + triScore) / 2;

    // --- GPU sub-score (10% weight): no data = assume fine ---
    const gpuScore = stats.gpuTime === null ? 100
      : stats.gpuTime <= 8 ? 100
      : stats.gpuTime <= 16 ? 50 + (1 - (stats.gpuTime - 8) / 8) * 50
      : Math.max(0, 50 - (stats.gpuTime - 16) / 16 * 50);

    // --- Weighted total ---
    let rawScore = Math.round(
      fpsScore * 0.40 +
      smoothnessScore * 0.20 +
      memoryScore * 0.15 +
      renderScore * 0.15 +
      gpuScore * 0.10
    );
    rawScore = Math.max(0, Math.min(100, rawScore));

    // EMA smoothing to prevent jittery score display
    const score = this.lastComputedScore < 0
      ? rawScore
      : Math.round(0.3 * rawScore + 0.7 * this.lastComputedScore);
    this.lastComputedScore = score;

    const { grade, label } = scoreToGrade(score);

    return {
      score,
      grade,
      gradeLabel: label,
      categories: {
        performance: Math.round(Math.max(0, Math.min(100, fpsScore))),
        smoothness: Math.round(Math.max(0, Math.min(100, smoothnessScore))),
        memory: Math.round(Math.max(0, Math.min(100, memoryScore))),
        rendering: Math.round(Math.max(0, Math.min(100, renderScore))),
        gpu: Math.round(Math.max(0, Math.min(100, gpuScore))),
      },
      issues: this.generateIssues(stats),
    };
  }

  private generateIssues(stats: FrameStats): PerformanceIssue[] {
    const issues: PerformanceIssue[] = [];
    const t = this.config.thresholds;

    if (stats.fps.avg > 0 && stats.fps.avg < t.fps.yellow) {
      issues.push({
        id: 'fps-low',
        severity: stats.fps.avg < t.fps.yellow / 2 ? 'critical' : 'warning',
        title: 'Game is running slowly',
        description: stats.fps.avg < 20
          ? 'Your game is very slow. Try reducing the number of objects or simplifying visual effects.'
          : 'Your game could be smoother. Consider simplifying busy scenes.',
        category: 'performance',
        icon: ISSUE_CATEGORY_ICONS.performance,
      });
    }

    if (stats.drawCalls > t.drawCalls.yellow) {
      issues.push({
        id: 'draw-calls-high',
        severity: stats.drawCalls > t.drawCalls.yellow * 3 ? 'critical' : 'warning',
        title: 'Too many objects drawing separately',
        description: 'Group similar objects together so the game does less work each frame. Objects with the same look can often be merged.',
        category: 'rendering',
        icon: ISSUE_CATEGORY_ICONS.rendering,
      });
    }

    if (stats.triangles > t.triangles.yellow) {
      issues.push({
        id: 'triangles-high',
        severity: stats.triangles > t.triangles.yellow * 3 ? 'critical' : 'warning',
        title: 'Too much geometry detail',
        description: 'Some models have more detail than needed. Use simpler models for background objects or things far from the camera.',
        category: 'rendering',
        icon: ISSUE_CATEGORY_ICONS.rendering,
      });
    }

    if (stats.textureMemoryMB > t.textureMemoryMB.yellow) {
      issues.push({
        id: 'texture-memory-high',
        severity: stats.textureMemoryMB > t.textureMemoryMB.yellow * 2 ? 'critical' : 'warning',
        title: 'Large images using lots of memory',
        description: 'Your textures are using a lot of GPU memory. Try compressing images, using smaller sizes, or sharing textures between objects.',
        category: 'memory',
        icon: ISSUE_CATEGORY_ICONS.memory,
      });
    }

    if (stats.geometryMemoryMB > t.geometryMemoryMB.yellow) {
      issues.push({
        id: 'geometry-memory-high',
        severity: stats.geometryMemoryMB > t.geometryMemoryMB.yellow * 2 ? 'critical' : 'warning',
        title: 'Too much 3D data in memory',
        description: 'Your models are using lots of memory. Share shapes between similar objects and remove unused geometry.',
        category: 'memory',
        icon: ISSUE_CATEGORY_ICONS.memory,
      });
    }

    if (stats.gpuTime !== null && stats.gpuTime > 16) {
      issues.push({
        id: 'gpu-time-high',
        severity: stats.gpuTime > 33 ? 'critical' : 'warning',
        title: 'GPU is working too hard',
        description: 'Your graphics card is struggling. Simplify visual effects, reduce shadow quality, or lower the resolution.',
        category: 'gpu',
        icon: ISSUE_CATEGORY_ICONS.gpu,
      });
    }

    if (stats.framePacing.janksPerMinute > 10) {
      issues.push({
        id: 'jank-detected',
        severity: stats.framePacing.janksPerMinute > 30 ? 'critical' : 'warning',
        title: 'Game stutters occasionally',
        description: 'Your game has noticeable hiccups. This can be caused by loading assets during gameplay or doing too much work at once.',
        category: 'smoothness',
        icon: ISSUE_CATEGORY_ICONS.smoothness,
      });
    }

    // Multi-window burn-rate detection (SRE-style). Replaces the previous
    // half-vs-half variance ratio that fired on minor jitter on already-fine
    // builds. Three tiers, all gated on BOTH a short AND a long window so
    // single spikes don't trigger and "good" windows don't fire false
    // positives.
    const target = this.config.thresholds.frameTime.green;
    const burnShort10s = this.getBurnRate(10_000, target);
    const burnLong60s = this.getBurnRate(60_000, target);
    const burnSustained5m = this.getBurnRate(300_000, target);

    if (burnShort10s >= 10 && burnLong60s >= 10) {
      issues.push({
        id: 'performance-degrading',
        severity: 'critical',
        title: 'Game is stuttering right now',
        description: 'Frames are missing the target budget at 10× the rate the SLO allows, both in the last 10 seconds and the last minute. Something is actively wrong — recent code changes or an expensive scene transition.',
        category: 'smoothness',
        icon: ISSUE_CATEGORY_ICONS.smoothness,
      });
    } else if (burnSustained5m >= 3 && burnLong60s >= 3) {
      issues.push({
        id: 'performance-degrading',
        severity: 'warning',
        title: 'Performance getting worse over time',
        description: 'Frames have been missing the target budget at 3× the rate the SLO allows, sustained over the last few minutes. Common causes: objects accumulating without cleanup, growing particle pool, forgotten event listeners.',
        category: 'smoothness',
        icon: ISSUE_CATEGORY_ICONS.smoothness,
      });
    }
    // Trend tier (burn ≥ 2× over session) intentionally suppressed for now —
    // surface only the two louder bands. Easy to add back if "watch for drift"
    // becomes a need.

    return issues;
  }

  // ============================================================================
  // WebGL State Change Tracking (batching efficiency)
  // ============================================================================

  private hookStateChangeTracking(): void {
    const gl = this.getGLContext();
    if (!gl) return;

    const counters = this.stateChangeCounters;

    // Hook useProgram
    this.originalUseProgram = gl.useProgram.bind(gl);
    gl.useProgram = (program: WebGLProgram | null) => {
      counters.programSwitches++;
      return this.originalUseProgram!(program);
    };

    // Hook bindTexture
    this.originalBindTexture = gl.bindTexture.bind(gl);
    gl.bindTexture = (target: number, texture: WebGLTexture | null) => {
      counters.textureSwitches++;
      return this.originalBindTexture!(target, texture);
    };

    // Hook bindFramebuffer
    this.originalBindFramebuffer = gl.bindFramebuffer.bind(gl);
    gl.bindFramebuffer = (target: number, framebuffer: WebGLFramebuffer | null) => {
      counters.fboSwitches++;
      return this.originalBindFramebuffer!(target, framebuffer);
    };

    this.log('WebGL state change tracking active');
  }

  private unhookStateChangeTracking(): void {
    const gl = this.getGLContext();
    if (!gl) return;

    if (this.originalUseProgram) {
      gl.useProgram = this.originalUseProgram;
      this.originalUseProgram = null;
    }
    if (this.originalBindTexture) {
      gl.bindTexture = this.originalBindTexture;
      this.originalBindTexture = null;
    }
    if (this.originalBindFramebuffer) {
      gl.bindFramebuffer = this.originalBindFramebuffer;
      this.originalBindFramebuffer = null;
    }
  }

  // ============================================================================
  // Long Animation Frame (LoAF) Observer
  // ============================================================================

  private startLoafObserver(): void {
    try {
      if (typeof PerformanceObserver === 'undefined') return;

      // Check if long-animation-frame is supported
      const supported = PerformanceObserver.supportedEntryTypes;
      if (!supported?.includes('long-animation-frame')) return;

      this.loafObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceEntry & {
            renderStart?: number;
            styleAndLayoutStart?: number;
            scripts?: Array<{ sourceURL: string; invoker: string; duration: number }>;
          };

          this.loafEntries.push({
            duration: e.duration,
            renderStart: e.renderStart ?? 0,
            styleAndLayoutStart: e.styleAndLayoutStart ?? 0,
            scripts: (e.scripts ?? []).map(s => ({
              sourceURL: s.sourceURL || 'unknown',
              invoker: s.invoker || 'unknown',
              duration: s.duration,
            })),
            timestamp: e.startTime,
          });

          // Keep last 50 entries
          if (this.loafEntries.length > 50) {
            this.loafEntries.shift();
          }
        }
      });

      this.loafObserver.observe({ type: 'long-animation-frame', buffered: false });
      this.log('Long Animation Frame (LoAF) observer active');
    } catch {
      // LoAF not supported in this browser
    }
  }

  private stopLoafObserver(): void {
    if (this.loafObserver) {
      this.loafObserver.disconnect();
      this.loafObserver = null;
    }
  }

  // ============================================================================
  // Windowed stats — on-demand summary of the last N ms of frame samples.
  // Used by a host's live panel and the per-build snapshot capture.
  // ============================================================================

  public getWindowedStats(windowMs: number): WindowedStats {
    const cutoff = performance.now() - windowMs;
    const samples = this.ringBuffer.sliceSince(cutoff);
    const n = samples.length;
    if (n === 0) {
      return {
        windowMs,
        sampleCount: 0,
        fps: { p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 },
        frameTime: { p50: 0, p95: 0, p99: 0, max: 0, avg: 0 },
        heap: { start: 0, end: 0, min: 0, max: 0, deltaPerMin: 0 },
      };
    }

    const fpsArr = samples.map((s) => s.fps);
    const ftArr = samples.map((s) => s.frameTime);
    // FrameSample.jsHeapUsed is in bytes (from performance.memory); convert to MB.
    const heapArr = samples.map((s) => (s.jsHeapUsed ?? 0) / (1024 * 1024));

    const heapDeltaMB = heapArr[heapArr.length - 1] - heapArr[0];
    const deltaMin = (samples[samples.length - 1].timestamp - samples[0].timestamp) / 60_000;
    const sum = (a: number, b: number) => a + b;

    return {
      windowMs,
      sampleCount: n,
      fps: {
        p50: percentile(fpsArr, 50),
        p95: percentile(fpsArr, 95),
        p99: percentile(fpsArr, 99),
        min: Math.min(...fpsArr),
        max: Math.max(...fpsArr),
        avg: fpsArr.reduce(sum, 0) / n,
      },
      frameTime: {
        p50: percentile(ftArr, 50),
        p95: percentile(ftArr, 95),
        p99: percentile(ftArr, 99),
        max: Math.max(...ftArr),
        avg: ftArr.reduce(sum, 0) / n,
      },
      heap: {
        start: heapArr[0],
        end: heapArr[heapArr.length - 1],
        min: Math.min(...heapArr),
        max: Math.max(...heapArr),
        deltaPerMin: deltaMin > 0 ? heapDeltaMB / deltaMin : 0,
      },
    };
  }

  // ============================================================================
  // SLO burn rate — frames-over-budget as a fraction of the SLO error budget.
  // Multi-window burn-rate alerting (SRE-style) lets the warning layer
  // distinguish "one stutter" from "sustained degradation" by combining a
  // short and a long window.
  //
  // SLO: "99% of frames hit the target budget" → error budget = 1% per window.
  // burn_rate = (% of frames over budget) / 1%.
  //   burn_rate ≈ 1.0  → consuming budget at steady state
  //   burn_rate ≥ 3    → 3× faster than allowed → sustained degradation
  //   burn_rate ≥ 10   → acute stutter
  //
  // Returns 0 when the window has fewer than `minSamples` (insufficient signal).
  // ============================================================================

  /**
   * SLO burn rate over the last `windowMs` of samples.
   * @param windowMs Width of the sliding window.
   * @param targetFrameMs Frame-time budget. Frames over this count as "errors".
   * @param minSamples Below this, the window is considered insufficient and
   *   the function returns 0 (no signal).
   */
  public getBurnRate(windowMs: number, targetFrameMs: number, minSamples: number = 30): number {
    const cutoff = performance.now() - windowMs;
    const samples = this.ringBuffer.sliceSince(cutoff);
    return computeBurnRate(samples, targetFrameMs, minSamples);
  }

  // ============================================================================
  // Snapshot — full profiler dump for AI analysis
  // ============================================================================

  buildSnapshot(): ProfilerSnapshot {
    const samples = this.ringBuffer.sliceSince(0);
    const stats = samples.length > 0 ? this.aggregateStats(samples) : this.emptyStats();

    // Run warning detection on full history
    this.warningHashes.clear();
    this.warnings = [];
    this.detectWarnings(stats);

    // Get hot objects and compute cost percentages
    let hotObjects = this.getHotObjects() ?? undefined;
    if (hotObjects && hotObjects.length > 0) {
      const totalTri = stats.triangles || 1;
      const totalDC = stats.drawCalls || 1;
      hotObjects = hotObjects.map(obj => ({
        ...obj,
        triangleBudgetPercent: (obj.triangles / totalTri) * 100,
        drawCallBudgetPercent: (obj.drawCalls / totalDC) * 100,
      }));
    }

    return {
      engine: this.engineType,
      timestamp: Date.now(),
      profilingDuration: performance.now() - this.profilingStartTime,
      stats,
      recentSamples: samples.slice(-30), // Last 30 samples for trend analysis
      warnings: [...this.warnings],
      engineInfo: this.getEngineInfo(),
      hotObjects,
      loafEntries: this.loafEntries.length > 0 ? [...this.loafEntries] : undefined,
    };
  }

  /**
   * Generate a human-readable profiler report for AI chat.
   * This is the key feature: rich enough for AI to give actionable advice.
   */
  getReport(): string {
    return formatProfilerReport(this.buildSnapshot());
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  updateConfig(partial: Partial<ProfilerConfig>): void {
    this.config = { ...this.config, ...partial };

    if (partial.bufferSize && partial.bufferSize !== this.ringBuffer.capacity) {
      // Recreate ring buffer with new size (loses old samples)
      this.ringBuffer = new TimeWindowedRingBuffer<FrameSample>(partial.bufferSize);
    }
  }

  // ============================================================================
  // Global API
  // ============================================================================

  private exposeGlobalAPI(): void {
    const api: ProfilerAPI = {
      start: () => this.start(),
      stop: () => this.stop(),
      isRunning: () => this.isRunning,
      getSnapshot: () => this.buildSnapshot(),
      getReport: () => this.getReport(),
    };
    globalSlot().profiler = api;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  protected log(message: string, level: 'log' | 'warn' | 'error' = 'log'): void {
    if (this.config.debug || level !== 'log') {
      console[level](`[${NAME}] ${message}`);
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();
    this.gpuTimer?.destroy();
    this.messages.destroy();
    delete globalSlot().profiler;
  }
}
