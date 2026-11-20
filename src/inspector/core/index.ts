/**
 * Inspector - Core Module Exports
 */

export * from './types';
export { StackParser, stackParser } from './StackParser';
export { MessageBridge } from './MessageBridge';
export { CanvasHighlighter } from './CanvasHighlighter';
export type { HighlightedObject } from './CanvasHighlighter';
export { ObjectTracker } from './ObjectTracker';
export { ErrorTracker } from './ErrorTracker';
export { InspectorBase } from './InspectorBase';
export { threeProps, pixiProps, canvasProps } from './ObjectProps';
export type { ObjectProps } from './ObjectProps';
export type { InspectorConfig, InspectorAPI } from './InspectorBase';
export { SourceMapResolver } from './SourceMapResolver';
export { DomInspector } from './DomInspector';
export type { DomHit } from './DomInspector';
export { DomHighlighter } from './DomHighlighter';
