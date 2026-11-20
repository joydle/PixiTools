/**
 * Inspector - Shared Type Definitions
 *
 * Standard contract for OBJECT_SELECTED messages across all game engines.
 */

// ============================================================================
// Position & Transform Types
// ============================================================================

export interface Position2D {
  x: number;
  y: number;
}

export interface Position3D {
  x: number;
  y: number;
  z: number;
}

export interface Rotation2D {
  rotation: number;
}

export interface Rotation3D {
  x: number;
  y: number;
  z: number;
}

export interface Scale2D {
  x: number;
  y: number;
}

export interface Scale3D {
  x: number;
  y: number;
  z: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LineRange {
  startLine: number;
  endLine: number;
}

// ============================================================================
// Source Tracking
// ============================================================================

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

/** Compact source ref stored on hooked objects as __src (~80 bytes) */
export interface SourceRef {
  /** File URL (full, for source map fetch) */
  f: string;
  /** Line number */
  l: number;
  /** Column number (critical for source map resolution in bundled code) */
  c: number;
}

/** Resolved original source from source map (lazy, only when inspector opens) */
export interface ResolvedSource {
  /** Original source file path (e.g., "src/main.ts") */
  source: string;
  /** Original line number */
  line: number;
  /** Original column */
  column?: number;
  /** The actual source code line text */
  sourceLine?: string;
  /** Variable name extracted from assignment (e.g., "playerSprite") */
  varName?: string;
}

export interface TrackedObject {
  type: string;
  source: SourceLocation | null;
}

// ============================================================================
// Object Metadata (OBJECT_SELECTED contract)
// ============================================================================

export interface ObjectMetadata {
  /** Object label/name (e.g., "player_ship") */
  type: string;
  /** Constructor name (e.g., "Mesh", "Sprite") */
  typeName: string;
  /** Z-index/render order layer */
  layer: number;
  /** World position (2D or 3D) */
  position: Position2D | Position3D;
  /** Rotation (2D radians or 3D euler angles) */
  rotation?: Rotation2D | Rotation3D;
  /** Scale factors */
  scale: Scale2D | Scale3D;
  /** Opacity (0-1) */
  alpha: number;
  /** Visibility state */
  visible: boolean;
  /** Number of child objects */
  childCount: number;
  /** Screen bounds for highlighting */
  bounds: Bounds;
  /** Parent object name */
  parentLabel: string;
  /** Source file where object was created (bundled path or filename) */
  sourceFile: string | null;
  /** Line number in source file */
  sourceLine: number | null;
  /** Column number in source file (for source map resolution) */
  sourceColumn: number | null;
  /** Range of lines for code context */
  sourceLineRange: LineRange | null;
  /** Resolved original source file (from source map, e.g. "src/main.ts") */
  originalSource?: string | null;
  /** Resolved original line number */
  originalLine?: number | null;
  /** The actual source code line text from original file */
  originalSourceLine?: string | null;
  /** Whether this is a DOM/HUD component (vs canvas object) */
  isDomComponent?: boolean;
  /** CSS class name of the DOM element */
  cssClass?: string;
  /** Component props (serialized from the props attribute) */
  componentProps?: Record<string, unknown>;

  // What it is drawn with and whether it is on (ObjectProps.ts). THREE STATES:
  // a field the engine has no concept of is absent — never null, 0, false or [].
  /** Drawn by the engine: on here and in every parent (Three `visible`; Pixi `visible` + `renderable`). */
  active?: boolean;
  /** Parts attached to it (Pixi filters and mask); Three has none. */
  components?: ComponentInfo[];
  /** Its one material (Three). */
  material?: MaterialInfo;
  /** Its materials: a multi-material mesh, or a group's meshes (Three, at most 8). */
  materials?: MaterialInfo[];
  /** The texture it draws, by file name or key ("embedded" for a data:/blob: picture) — Pixi, Canvas2D. */
  texture?: string;
  /** Its tint as #rrggbb (Pixi; #ffffff = none). */
  tint?: string;
  /** Plain values the game hung on it (Three `userData`), one level deep. */
  userData?: Record<string, unknown>;
}

/** One material, as small JSON: no uniforms, no pixels. */
export interface MaterialInfo {
  name?: string;
  /** Three's `material.type`, e.g. "MeshStandardMaterial". */
  type?: string;
  /** #rrggbb. */
  color?: string;
  /** Its colour map's file name or texture name ("embedded" for a data:/blob: picture). */
  map?: string;
  opacity?: number;
}

/** One attached part; `enabled` only where the engine can switch it off. */
export interface ComponentInfo {
  name: string;
  enabled?: boolean;
}

// ============================================================================
// Selection & Candidates
// ============================================================================

export interface SelectionCandidate {
  obj: unknown;
  layer: number;
  /** Hierarchy depth (for sorting) */
  depth?: number;
  /** Object area in pixels (for sorting by size) */
  area?: number;
  /** Z-index (for sorting) */
  zIndex?: number;
}

// ============================================================================
// Engine Types
// ============================================================================

export type EngineType = 'pixi' | 'threejs' | 'canvas';

// ============================================================================
// Messages (PostMessage contract)
// ============================================================================

export type InspectorMessageType =
  | 'OBJECT_SELECTED'
  | 'OBJECT_DESELECTED'
  | 'GAME_PAUSED'
  | 'GAME_RESUMED'
  | 'INSPECTOR_READY'
  | 'SCENE_TREE'
  | 'ENGINE_DETECTED'
  | 'RUNTIME_ERROR'
  | 'CONSOLE_LOG';

export interface BaseMessage {
  type: InspectorMessageType;
  engine: EngineType;
}

export interface ObjectSelectedMessage extends BaseMessage {
  type: 'OBJECT_SELECTED';
  metadata: ObjectMetadata;
  clickX: number;
  clickY: number;
  /** data:image/png screenshot of the selected object's bounds */
  screenshot?: string;
}

export interface ObjectDeselectedMessage extends BaseMessage {
  type: 'OBJECT_DESELECTED';
}

export interface GamePausedMessage extends BaseMessage {
  type: 'GAME_PAUSED';
}

export interface GameResumedMessage extends BaseMessage {
  type: 'GAME_RESUMED';
}

export interface InspectorReadyMessage extends BaseMessage {
  type: 'INSPECTOR_READY';
}

export interface SceneTreeNode {
  name: string;
  type: string;
  children: SceneTreeNode[];
  /** Layer origin: canvas engine object, HUD/UI component, or decorative FX */
  layer?: 'canvas' | 'hud' | 'fx';
}

export interface SceneTreeMessage extends BaseMessage {
  type: 'SCENE_TREE';
  tree: SceneTreeNode;
}

// ============================================================================
// Runtime Error Tracking
// ============================================================================

export type RuntimeErrorType = 'error' | 'unhandledrejection' | 'console_error';

export interface RuntimeError {
  type: RuntimeErrorType;
  message: string;
  filename?: string;
  line?: number;
  column?: number;
  stack?: string;
  timestamp: number;
  /** Resolved original source file (from source map, e.g. "src/game.ts") */
  originalSource?: string;
  /** Resolved original line number */
  originalLine?: number;
  /** Resolved original column */
  originalColumn?: number;
  /** The actual source code line text from original file */
  originalSourceLine?: string;
}

export interface RuntimeErrorMessage extends BaseMessage {
  type: 'RUNTIME_ERROR';
  error: RuntimeError;
}

// ============================================================================
// Console Log Capture
// ============================================================================

export type ConsoleLogLevel = 'log' | 'warn' | 'error';

export interface ConsoleLogEntry {
  level: ConsoleLogLevel;
  message: string;
  timestamp: number;
}

export interface ConsoleLogMessage extends BaseMessage {
  type: 'CONSOLE_LOG';
  entry: ConsoleLogEntry;
}

export type InspectorMessage =
  | ObjectSelectedMessage
  | ObjectDeselectedMessage
  | GamePausedMessage
  | GameResumedMessage
  | InspectorReadyMessage
  | SceneTreeMessage
  | RuntimeErrorMessage
  | ConsoleLogMessage;

// ============================================================================
// Incoming Messages (from the host)
// ============================================================================

export type EditorMessageType =
  | 'INSPECTOR_PAUSE'
  | 'INSPECTOR_RESUME'
  | 'CLEAR_SELECTION'
  | 'GET_SCENE_TREE'
  | 'REQUEST_SCREENSHOT'
  | 'REQUEST_AREA_SCREENSHOT'
  | 'DETECT_ENGINE'
  | 'FOCUS_OBJECT'
  | 'SELECT_OBJECT';

export interface EditorMessage {
  type: EditorMessageType;
  /** Target object name (for FOCUS_OBJECT) */
  target?: string;
  /**
   * SELECT_OBJECT: where the object sits in the scene tree this inspector sent,
   * as child indexes from its root. Names repeat (five objects called "Mesh"),
   * so a host that knows the place asks by it; the name stays the fallback.
   */
  path?: number[];
  /**
   * REQUEST_SCREENSHOT / REQUEST_AREA_SCREENSHOT: the host's correlation id,
   * echoed on the SCREENSHOT_RESULT it answers (absent when none was sent).
   */
  requestId?: string;
}

// ============================================================================
// Layer Classification
// ============================================================================

export enum LayerCategory {
  UI = 1000,
  Interactive = 500,
  Object = 100,
  Background = 0,
}

export interface LayerInfo {
  category: LayerCategory;
  name: string;
  priority: number;
}

// ============================================================================
// Overlay Colors
// ============================================================================

export interface OverlayColors {
  selected: string;
  hovered: string;
  label: string;
  labelText: string;
}

export const DEFAULT_OVERLAY_COLORS: OverlayColors = {
  selected: 'rgba(0, 200, 255, 0.8)',
  hovered: 'rgba(255, 200, 0, 0.6)',
  label: 'rgba(0, 0, 0, 0.8)',
  labelText: '#ffffff',
};
