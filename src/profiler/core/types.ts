/**
 * Profiler - Type Definitions
 *
 * Rich performance data contracts designed for both real-time display
 * and AI-powered optimization analysis. When serialized as a profiler
 * report, these types provide enough context for an AI to give specific,
 * actionable optimization suggestions.
 */

// ============================================================================
// Engine Types
// ============================================================================

export type EngineType = 'threejs' | 'pixi';

// ============================================================================
// Per-Frame Sample — collected every frame
// ============================================================================

export interface FrameSample {
  /** performance.now() timestamp */
  timestamp: number;
  /** Wall-clock time between consecutive frames in ms (1/FPS) */
  frameTime: number;
  /** Actual frames per second (1000 / frameTime delta) */
  fps: number;
  /** CPU-side render call duration in ms (how long renderer.render() took) */
  cpuTime: number;

  // --- Render pipeline ---
  /** Number of draw calls this frame */
  drawCalls: number;
  /** Total triangles rendered */
  triangles: number;
  /** Total points rendered (particle systems, etc.) */
  points: number;
  /** Total lines rendered (wireframe, debug, etc.) */
  lines: number;

  // --- Memory ---
  /** Number of GPU textures allocated */
  textureCount: number;
  /** Estimated texture memory in bytes */
  textureBytes: number;
  /** Number of geometry buffers allocated */
  geometryCount: number;
  /** Estimated geometry memory in bytes */
  geometryBytes: number;
  /** Number of active shader programs */
  programCount: number;

  // --- WebGL state changes (batching efficiency) ---
  /** gl.useProgram() calls per frame */
  programSwitches: number;
  /** gl.bindTexture() calls per frame */
  textureSwitches: number;
  /** gl.bindFramebuffer() calls per frame */
  fboSwitches: number;

  // --- Scene graph ---
  /** Total objects in the scene tree */
  totalObjects: number;
  /** Objects that passed visibility/frustum culling */
  visibleObjects: number;
  /** Number of active lights */
  lightsCount: number;
  /** Number of cameras */
  camerasCount: number;

  // --- GPU ---
  /** GPU render time in ms (null if EXT_disjoint_timer_query unavailable) */
  gpuTime: number | null;

  // --- JavaScript heap (if available) ---
  /** JS heap used in bytes (from performance.memory) */
  jsHeapUsed: number | null;
  /** JS heap total allocated in bytes */
  jsHeapTotal: number | null;
}

// ============================================================================
// Aggregated Stats — computed over a time window
// ============================================================================

export interface MinMaxAvg {
  current: number;
  min: number;
  max: number;
  avg: number;
}

export interface FrameStats {
  /** FPS stats over the sample window */
  fps: MinMaxAvg;
  /** Frame time stats over the sample window (ms) — delta between frames */
  frameTime: MinMaxAvg;
  /** CPU render call duration stats (ms) */
  cpuTime: MinMaxAvg;

  // --- Latest values ---
  drawCalls: number;
  triangles: number;
  points: number;
  lines: number;

  textureCount: number;
  /** Texture memory in MB */
  textureMemoryMB: number;
  geometryCount: number;
  /** Geometry memory in MB */
  geometryMemoryMB: number;
  programCount: number;

  totalObjects: number;
  visibleObjects: number;
  lightsCount: number;
  camerasCount: number;

  /** GPU render time in ms */
  gpuTime: number | null;

  /** JS heap used in MB */
  jsHeapUsedMB: number | null;

  // --- WebGL state changes ---
  programSwitches: number;
  textureSwitches: number;
  fboSwitches: number;

  // --- Frame pacing ---
  framePacing: FramePacingMetrics;

  // --- Bottleneck classification ---
  bottleneck: BottleneckAnalysis;

  /** Simplified performance score for non-coders (computed each aggregation) */
  performanceScore?: PerformanceScore;

  /** Total samples in this aggregation window */
  sampleCount: number;
}

// ============================================================================
// Frame Pacing — smoothness metrics beyond raw FPS
// ============================================================================

export interface FramePacingMetrics {
  /** Standard deviation of frame times in ms (lower = smoother) */
  frameTimeStdDev: number;
  /** Percentage of frames within 10% of target frame time (16.67ms) */
  consistencyPercent: number;
  /** Number of "jank frames" (>2x average frame time) per minute */
  janksPerMinute: number;
  /** Longest consecutive run of on-time frames */
  longestSmoothStreak: number;
  /** Frame time histogram: [0-8ms, 8-16ms, 16-33ms, 33-50ms, 50ms+] */
  histogram: [number, number, number, number, number];
  /** Moving variance trend */
  varianceTrend: 'stable' | 'degrading' | 'improving';
}

// ============================================================================
// Bottleneck Classification
// ============================================================================

export type BottleneckType =
  | 'cpu-bound'       // cpuTime >> gpuTime — draw call overhead, JS logic
  | 'gpu-bound'       // gpuTime >> cpuTime — shader/fill/triangle bound
  | 'main-thread'     // frameTime >> cpuTime + gpuTime — non-render work blocking
  | 'draw-call-bound' // high draw calls with high cpuTime
  | 'vsync-limited'   // headroom available, hitting vsync cap
  | 'balanced'        // no single bottleneck
  | 'unknown';        // insufficient data

export interface BottleneckAnalysis {
  type: BottleneckType;
  /** Human-readable explanation */
  description: string;
  /** Confidence 0..1 */
  confidence: number;
  /** Suggested action */
  suggestion: string;
}

// ============================================================================
// Performance Score — simplified view for non-coders
// ============================================================================

export type PerformanceGrade = 'excellent' | 'good' | 'needs-work' | 'poor' | 'critical';

export type IssueCategory = 'performance' | 'rendering' | 'memory' | 'gpu' | 'smoothness';

export interface PerformanceIssue {
  /** Stable key for dedup / React key (e.g., 'draw-calls-high') */
  id: string;
  severity: WarningSeverity;
  /** Non-technical title (e.g., "Too many separate objects") */
  title: string;
  /** Plain-English description with actionable guidance */
  description: string;
  category: IssueCategory;
  /** Emoji icon for display */
  icon: string;
}

export interface PerformanceScore {
  /** Overall score 0-100 */
  score: number;
  /** Machine-readable grade */
  grade: PerformanceGrade;
  /** Display label (e.g., "Good", "Needs Work") */
  gradeLabel: string;
  /** Per-category sub-scores (0-100) */
  categories: Record<IssueCategory, number>;
  /** Plain-English issues derived from current metrics */
  issues: PerformanceIssue[];
}

export function scoreToGrade(score: number): { grade: PerformanceGrade; label: string } {
  if (score >= 90) return { grade: 'excellent', label: 'Excellent' };
  if (score >= 70) return { grade: 'good', label: 'Good' };
  if (score >= 50) return { grade: 'needs-work', label: 'Needs Work' };
  if (score >= 30) return { grade: 'poor', label: 'Poor' };
  return { grade: 'critical', label: 'Critical' };
}

export const GRADE_COLORS: Record<PerformanceGrade, string> = {
  excellent: '#4ade80',
  good: '#86efac',
  'needs-work': '#fbbf24',
  poor: '#fb923c',
  critical: '#f43f5e',
};

export const ISSUE_CATEGORY_ICONS: Record<IssueCategory, string> = {
  performance: '\uD83C\uDFAC',
  rendering: '\uD83C\uDFA8',
  memory: '\uD83D\uDCBE',
  gpu: '\uD83D\uDDA5\uFE0F',
  smoothness: '\u2728',
};

// ============================================================================
// Long Animation Frame (LoAF) — browser jank detection
// ============================================================================

export interface LoafEntry {
  /** Total duration of the long animation frame (ms) */
  duration: number;
  /** When rendering started relative to frame start */
  renderStart: number;
  /** When style/layout started */
  styleAndLayoutStart: number;
  /** Scripts that contributed to the long frame */
  scripts: Array<{
    sourceURL: string;
    invoker: string;
    duration: number;
  }>;
  /** When this was detected */
  timestamp: number;
}

// ============================================================================
// Snapshot Diff — before/after comparison
// ============================================================================

export interface SnapshotDiffEntry {
  metric: string;
  before: number;
  after: number;
  changePercent: number;
  severity: 'improved' | 'degraded' | 'neutral';
}

export interface SnapshotDiff {
  entries: SnapshotDiffEntry[];
  summary: string;
}

/**
 * Compare two profiler snapshots and produce a diff.
 */
export function diffSnapshots(before: ProfilerSnapshot, after: ProfilerSnapshot): SnapshotDiff {
  const entries: SnapshotDiffEntry[] = [];
  const b = before.stats;
  const a = after.stats;

  const addDiff = (metric: string, bVal: number, aVal: number, lowerIsBetter: boolean) => {
    if (bVal === 0 && aVal === 0) return;
    const changePercent = bVal !== 0 ? ((aVal - bVal) / bVal) * 100 : (aVal > 0 ? 100 : 0);
    const improved = lowerIsBetter ? aVal < bVal : aVal > bVal;
    const degraded = lowerIsBetter ? aVal > bVal : aVal < bVal;
    const severity: 'improved' | 'degraded' | 'neutral' =
      Math.abs(changePercent) < 5 ? 'neutral' : (improved ? 'improved' : (degraded ? 'degraded' : 'neutral'));
    entries.push({ metric, before: bVal, after: aVal, changePercent, severity });
  };

  addDiff('FPS (avg)', b.fps.avg, a.fps.avg, false);
  addDiff('Frame Time (avg ms)', b.frameTime.avg, a.frameTime.avg, true);
  addDiff('CPU Time (avg ms)', b.cpuTime.avg, a.cpuTime.avg, true);
  addDiff('Draw Calls', b.drawCalls, a.drawCalls, true);
  addDiff('Triangles', b.triangles, a.triangles, true);
  addDiff('Texture Memory (MB)', b.textureMemoryMB, a.textureMemoryMB, true);
  addDiff('Geometry Memory (MB)', b.geometryMemoryMB, a.geometryMemoryMB, true);
  addDiff('Total Objects', b.totalObjects, a.totalObjects, true);
  addDiff('Program Switches', b.programSwitches, a.programSwitches, true);
  addDiff('Texture Switches', b.textureSwitches, a.textureSwitches, true);
  addDiff('FBO Switches', b.fboSwitches, a.fboSwitches, true);

  const improved = entries.filter(e => e.severity === 'improved').length;
  const degraded = entries.filter(e => e.severity === 'degraded').length;
  const summary = improved > degraded
    ? `Performance improved: ${improved} metrics better, ${degraded} worse`
    : degraded > improved
    ? `Performance degraded: ${degraded} metrics worse, ${improved} better`
    : `Performance stable: ${improved} improved, ${degraded} degraded`;

  return { entries, summary };
}

// ============================================================================
// Profiler Warnings — auto-detected performance issues
// ============================================================================

export type WarningSeverity = 'info' | 'warning' | 'critical';

export type WarningCategory =
  | 'fps'
  | 'frame_time'
  | 'draw_calls'
  | 'triangles'
  | 'texture_memory'
  | 'geometry_memory'
  | 'shader_count'
  | 'object_count'
  | 'gpu_time'
  | 'js_heap';

export interface ProfilerWarning {
  /** Unique ID for deduplication */
  id: string;
  severity: WarningSeverity;
  category: WarningCategory;
  /** Human-readable description */
  message: string;
  /** The problematic metric value */
  value: number;
  /** The threshold that was exceeded */
  threshold: number;
  /** When the warning was first detected */
  timestamp: number;
  /** Optimization suggestion for this specific warning */
  suggestion: string;
}

// ============================================================================
// Timeline Entry — for flame chart visualization
// ============================================================================

export interface TimelineEntry {
  /** Phase name (e.g., "render", "physics", "scripts", "gc") */
  name: string;
  /** Start time relative to frame start (ms) */
  startTime: number;
  /** Duration of this phase (ms) */
  duration: number;
  /** Nested sub-phases */
  children?: TimelineEntry[];
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Profiler Snapshot — full dump for AI analysis
// ============================================================================

export interface ProfilerSnapshot {
  /** Which engine is being profiled */
  engine: EngineType;
  /** When this snapshot was taken */
  timestamp: number;
  /** How long profiling has been running (ms) */
  profilingDuration: number;

  /** Aggregated stats at snapshot time */
  stats: FrameStats;

  /** Recent frame samples (from ring buffer) */
  recentSamples: FrameSample[];

  /** Auto-detected performance warnings */
  warnings: ProfilerWarning[];

  /** Engine-specific metadata */
  engineInfo: EngineInfo;

  /** Top objects by cost (if available) */
  hotObjects?: HotObject[];

  /** Long Animation Frame entries detected during profiling */
  loafEntries?: LoafEntry[];
}

export interface EngineInfo {
  /** Engine name and version */
  name: string;
  version: string;
  /** Renderer type (e.g., "WebGL2", "WebGPU", "Canvas2D") */
  renderer: string;
  /** Canvas dimensions */
  canvasWidth: number;
  canvasHeight: number;
  /** Device pixel ratio */
  pixelRatio: number;
  /** WebGL extensions in use */
  extensions?: string[];
  /** Max texture size supported */
  maxTextureSize?: number;
  /** Antialiasing enabled */
  antialias?: boolean;
  /** Shadow map enabled and type */
  shadows?: { enabled: boolean; type?: string };
  /** Tone mapping type (Three.js) */
  toneMapping?: string;
}

export interface HotObject {
  /** Object name/label */
  name: string;
  /** Object type (e.g., "Mesh", "Sprite", "ParticleSystem") */
  type: string;
  /** Estimated triangle count */
  triangles: number;
  /** Number of draw calls this object causes */
  drawCalls: number;
  /** Texture memory used by this object (bytes) */
  textureBytes: number;
  /** Whether the object is visible */
  visible: boolean;
  /** World position hint */
  position?: { x: number; y: number; z?: number };
  /** Percentage of total triangle budget this object uses */
  triangleBudgetPercent?: number;
  /** Percentage of total draw call budget this object uses */
  drawCallBudgetPercent?: number;
}

// ============================================================================
// AI Report — human-readable profiler report for chat context
// ============================================================================

/**
 * Generates a formatted profiler report string that can be pasted into
 * or auto-sent to an AI chat for optimization analysis.
 */
export function formatProfilerReport(snapshot: ProfilerSnapshot): string {
  const { stats, warnings, engineInfo, hotObjects } = snapshot;

  const lines: string[] = [
    `## Performance Profile`,
    ``,
    `**Engine:** ${engineInfo.name} ${engineInfo.version} | **Renderer:** ${engineInfo.renderer}`,
    `**Canvas:** ${engineInfo.canvasWidth}x${engineInfo.canvasHeight} @ ${engineInfo.pixelRatio}x DPR`,
    `**Profiling Duration:** ${(snapshot.profilingDuration / 1000).toFixed(1)}s | **Samples:** ${snapshot.recentSamples.length}`,
    ``,
    `### Frame Performance`,
    `| Metric | Current | Min | Max | Avg |`,
    `|--------|---------|-----|-----|-----|`,
    `| FPS | ${stats.fps.current.toFixed(1)} | ${stats.fps.min.toFixed(1)} | ${stats.fps.max.toFixed(1)} | ${stats.fps.avg.toFixed(1)} |`,
    `| Frame Time (ms) | ${stats.frameTime.current.toFixed(2)} | ${stats.frameTime.min.toFixed(2)} | ${stats.frameTime.max.toFixed(2)} | ${stats.frameTime.avg.toFixed(2)} |`,
    `| CPU Render (ms) | ${stats.cpuTime.current.toFixed(2)} | ${stats.cpuTime.min.toFixed(2)} | ${stats.cpuTime.max.toFixed(2)} | ${stats.cpuTime.avg.toFixed(2)} |`,
    stats.gpuTime !== null ? `| GPU Time (ms) | ${stats.gpuTime.toFixed(2)} | - | - | - |` : '',
    ``,
    `### Render Pipeline`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Draw Calls | ${stats.drawCalls.toLocaleString()} |`,
    `| Triangles | ${stats.triangles.toLocaleString()} |`,
    `| Points | ${stats.points.toLocaleString()} |`,
    `| Lines | ${stats.lines.toLocaleString()} |`,
    `| Shader Programs | ${stats.programCount} |`,
    ``,
    `### Memory`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Textures | ${stats.textureCount} (${stats.textureMemoryMB.toFixed(1)} MB) |`,
    `| Geometries | ${stats.geometryCount} (${stats.geometryMemoryMB.toFixed(1)} MB) |`,
    stats.jsHeapUsedMB !== null ? `| JS Heap | ${stats.jsHeapUsedMB.toFixed(1)} MB |` : '',
    ``,
    `### Scene Graph`,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Objects | ${stats.totalObjects.toLocaleString()} |`,
    `| Visible Objects | ${stats.visibleObjects.toLocaleString()} |`,
    `| Lights | ${stats.lightsCount} |`,
    `| Cameras | ${stats.camerasCount} |`,
  ];

  // Frame Pacing
  const pacing = stats.framePacing;
  if (pacing) {
    lines.push(
      `### Frame Pacing (Smoothness)`,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Consistency | ${pacing.consistencyPercent.toFixed(1)}% of frames on-target |`,
      `| Std Deviation | ${pacing.frameTimeStdDev.toFixed(2)}ms |`,
      `| Janks/min | ${pacing.janksPerMinute.toFixed(1)} |`,
      `| Longest Smooth Streak | ${pacing.longestSmoothStreak} frames |`,
      `| Variance Trend | ${pacing.varianceTrend} |`,
      `| Histogram (0-8/8-16/16-33/33-50/50+ms) | ${pacing.histogram.join(' / ')} |`,
      ``,
    );
  }

  // Bottleneck
  const bn = stats.bottleneck;
  if (bn && bn.type !== 'unknown') {
    lines.push(
      `### Bottleneck Analysis`,
      `- **Type:** ${bn.type} (${(bn.confidence * 100).toFixed(0)}% confidence)`,
      `- **Analysis:** ${bn.description}`,
      `- **Suggestion:** ${bn.suggestion}`,
      ``,
    );
  }

  // State changes (batching efficiency)
  if (stats.programSwitches > 0 || stats.textureSwitches > 0 || stats.fboSwitches > 0) {
    lines.push(
      `### WebGL State Changes (per frame)`,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Program Switches | ${stats.programSwitches} |`,
      `| Texture Binds | ${stats.textureSwitches} |`,
      `| FBO Switches | ${stats.fboSwitches} |`,
      ``,
    );
  }

  // Engine-specific details
  if (engineInfo.antialias !== undefined || engineInfo.shadows || engineInfo.toneMapping) {
    lines.push('', `### Renderer Settings`);
    if (engineInfo.antialias !== undefined) lines.push(`- Antialiasing: ${engineInfo.antialias ? 'ON' : 'OFF'}`);
    if (engineInfo.shadows) lines.push(`- Shadows: ${engineInfo.shadows.enabled ? `ON (${engineInfo.shadows.type || 'default'})` : 'OFF'}`);
    if (engineInfo.toneMapping) lines.push(`- Tone Mapping: ${engineInfo.toneMapping}`);
    if (engineInfo.maxTextureSize) lines.push(`- Max Texture Size: ${engineInfo.maxTextureSize}`);
  }

  // Warnings
  if (warnings.length > 0) {
    lines.push('', `### Performance Warnings`);
    for (const w of warnings) {
      const icon = w.severity === 'critical' ? 'CRITICAL' : w.severity === 'warning' ? 'WARNING' : 'INFO';
      lines.push(`- **[${icon}]** ${w.message} (${w.value} > threshold ${w.threshold})`);
      lines.push(`  Suggestion: ${w.suggestion}`);
    }
  }

  // Hot objects with cost percentages
  if (hotObjects && hotObjects.length > 0) {
    lines.push('', `### Top Objects by Cost`);
    lines.push(`| Object | Type | Triangles | Tri% | Draw Calls | DC% | Tex MB |`);
    lines.push(`|--------|------|-----------|------|------------|-----|--------|`);
    for (const obj of hotObjects.slice(0, 10)) {
      const triPct = obj.triangleBudgetPercent !== undefined ? `${obj.triangleBudgetPercent.toFixed(1)}%` : '-';
      const dcPct = obj.drawCallBudgetPercent !== undefined ? `${obj.drawCallBudgetPercent.toFixed(1)}%` : '-';
      lines.push(`| ${obj.name} | ${obj.type} | ${obj.triangles.toLocaleString()} | ${triPct} | ${obj.drawCalls} | ${dcPct} | ${(obj.textureBytes / 1024 / 1024).toFixed(1)} |`);
    }
  }

  // Long Animation Frame entries
  if (snapshot.loafEntries && snapshot.loafEntries.length > 0) {
    lines.push('', `### Long Animation Frames (Browser Jank)`);
    lines.push(`| Duration | Render Start | Scripts |`);
    lines.push(`|----------|-------------|---------|`);
    for (const loaf of snapshot.loafEntries.slice(-5)) {
      const scripts = loaf.scripts.map(s => `${s.invoker}(${s.duration.toFixed(0)}ms)`).join(', ') || 'none';
      lines.push(`| ${loaf.duration.toFixed(0)}ms | ${loaf.renderStart.toFixed(0)}ms | ${scripts} |`);
    }
  }

  // Frame time trend (last 10 samples)
  if (snapshot.recentSamples.length > 0) {
    const recent = snapshot.recentSamples.slice(-10);
    lines.push('', `### Recent Frame Times (last ${recent.length} samples)`);
    lines.push(`\`${recent.map(s => s.frameTime.toFixed(1)).join(' → ')} ms\``);

    // Detect spikes
    const avgFt = recent.reduce((sum, s) => sum + s.frameTime, 0) / recent.length;
    const spikes = recent.filter(s => s.frameTime > avgFt * 2);
    if (spikes.length > 0) {
      lines.push(`⚠ ${spikes.length} frame time spike(s) detected (>2x average)`);
    }
  }

  return lines.filter(l => l !== '').join('\n');
}

// ============================================================================
// Configuration
// ============================================================================

export interface ProfilerThresholds {
  fps: { green: number; yellow: number };
  frameTime: { green: number; yellow: number };
  drawCalls: { green: number; yellow: number };
  triangles: { green: number; yellow: number };
  textureMemoryMB: { green: number; yellow: number };
  geometryMemoryMB: { green: number; yellow: number };
}

export const DEFAULT_THRESHOLDS: ProfilerThresholds = {
  fps: { green: 55, yellow: 30 },
  frameTime: { green: 18, yellow: 33 },
  drawCalls: { green: 200, yellow: 1000 },
  triangles: { green: 200000, yellow: 1000000 },
  textureMemoryMB: { green: 100, yellow: 500 },
  geometryMemoryMB: { green: 50, yellow: 200 },
};

export interface ProfilerConfig {
  /** Interval (ms) between aggregated samples sent to parent (default: 1000) */
  sampleInterval: number;
  /** Ring buffer capacity — max number of raw frame samples to retain.
   * Sized for time-windowed reads via `getWindowedStats(ms)`: 30_000 holds
   * ~2 min at 240Hz, the worst-case display refresh we care about. */
  bufferSize: number;
  /** Performance thresholds for color-coding and warnings */
  thresholds: ProfilerThresholds;
  /** Enable debug logging to console */
  debug: boolean;
}

export const DEFAULT_CONFIG: ProfilerConfig = {
  sampleInterval: 1000,
  bufferSize: 30_000,
  thresholds: DEFAULT_THRESHOLDS,
  debug: false,
};

// ============================================================================
// PostMessage Contracts — Profiler ↔ host
// ============================================================================

/** Messages from profiler (iframe) → host (parent) */
export type ProfilerOutMessageType =
  | 'PROFILER_READY'
  | 'PROFILER_SAMPLE'
  | 'PROFILER_SNAPSHOT'
  | 'PROFILER_ENGINE_DETECTED'
  | 'PROFILER_WARNING';

/** Messages from host (parent) → profiler (iframe) */
export type ProfilerInMessageType =
  | 'PROFILER_START'
  | 'PROFILER_STOP'
  | 'PROFILER_REQUEST_SNAPSHOT'
  | 'PROFILER_SET_CONFIG';

export interface ProfilerInMessage {
  type: ProfilerInMessageType;
  config?: Partial<ProfilerConfig>;
}

// ============================================================================
// Time-windowed stats + per-build snapshots
// ============================================================================

/** Aggregate statistics computed from a time window of FrameSamples. */
export interface WindowedStats {
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Number of samples that contributed to the stats. */
  sampleCount: number;
  fps: {
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    avg: number;
  };
  frameTime: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
    avg: number;
  };
  /** Heap stats in megabytes. `deltaPerMin` is the projected per-minute growth. */
  heap: {
    start: number;
    end: number;
    min: number;
    max: number;
    deltaPerMin: number;
  };
}

/**
 * Persisted post-build snapshot for cross-build regression comparison.
 * Stored in IndexedDB by `buildSnapshotStore`. Size target: ~400 bytes.
 */
export interface BuildSnapshot {
  gameId: string;
  /** Optional build identifier; null when the build has none. */
  buildId: string | null;
  /** Epoch ms when this snapshot was captured. */
  capturedAt: number;
  /** Engine kind label, e.g. "PixiJS", "Three". */
  engineKind: string;
  /** Window the stats were computed over (always 30_000 for MVP auto-capture). */
  windowMs: number;
  fps: { p50: number; p95: number; p99: number; min: number; max: number };
  frameTimeMs: { p50: number; p95: number; p99: number; max: number };
  /** 12 buckets, 4ms wide each: [0-4), [4-8), … [44-48), [48+]. Counts. */
  frameTimeBuckets: number[];
  heapMB: { start: number; end: number; min: number; max: number };
  /** Overall score 0-100 at capture time. */
  scoreOverall: number;
  scoreSmooth: number;
  scoreMemory: number;
  sampleCount: number;
}

/** A single metric delta between two builds, with severity for color coding. */
export interface BuildComparisonDelta {
  metric: 'fps_p95' | 'frame_time_p95' | 'heap_max' | 'score_overall';
  label: string;
  prior: number;
  current: number;
  /** Percent change from prior. Sign matches the metric direction (e.g. negative deltaPct for FPS = regression). */
  deltaPct: number;
  severity: 'regression' | 'improvement' | 'neutral';
}

/** Comparison payload rendered as a footer on the ProfilerReportCard. */
export interface BuildComparison {
  prior: BuildSnapshot;
  /** Human-friendly age, e.g. "2 builds ago · 12 min". */
  priorAgeHuman: string;
  deltas: BuildComparisonDelta[];
}
