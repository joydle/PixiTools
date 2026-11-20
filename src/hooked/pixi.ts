/**
 * Hooked Pixi.js Bundle
 *
 * Re-exports Pixi.js with inspector hooks baked in.
 * Used through the Vite plugin or an import map in place of 'pixi.js'.
 *
 * Hooks ALL display objects in the scene graph.
 * Each hooked object gets:
 *   __src = { f: fileUrl, l: line, c: column }  — compact source location
 *   __n   = "hero.png" | "text:\"Score: 100\"" | "Sprite_14"
 *
 * Name resolution: obj.label/name (the game's) → autoName (texture/text) → fallback counter
 */

// Re-export everything from pixi.js
export * from 'pixi.js';

// Import for window exposure + wrapping
import * as PIXI from 'pixi.js';
import { makeHooked } from './hookFactory';
import { TRACK, TRACK_BUFFER } from '../brand';

// Import original constructors (all real Pixi v8 named exports)
import {
  Application as OriginalApplication,
  Container as OriginalContainer,
  Sprite as OriginalSprite,
  Graphics as OriginalGraphics,
  Text as OriginalText,
  Mesh as OriginalMesh,
  AnimatedSprite as OriginalAnimatedSprite,
  TilingSprite as OriginalTilingSprite,
  ParticleContainer as OriginalParticleContainer,
  BitmapText as OriginalBitmapText,
  HTMLText as OriginalHTMLText,
  // Pixi v8 renamed the simple-mesh family (v7 names no longer exist):
  //   SimpleMesh → MeshSimple, SimplePlane → MeshPlane,
  //   SimpleRope → MeshRope, NineSlicePlane → NineSliceSprite.
  MeshSimple as OriginalMeshSimple,
  MeshPlane as OriginalMeshPlane,
  MeshRope as OriginalMeshRope,
  NineSliceSprite as OriginalNineSliceSprite,
} from 'pixi.js';

// ============================================================================
// Expose PIXI namespace on window
// ============================================================================

if (typeof window !== 'undefined') {
  (window as any).PIXI = PIXI;

  // A game makes its first objects as its module loads, before the inspector
  // starts: keep them (bounded) until it does and drains this.
  if (!(window as any)[TRACK]) {
    const buffer: Array<{ obj: object; type: string }> = [];
    (window as any)[TRACK_BUFFER] = buffer;
    (window as any)[TRACK] = (obj: object, type: string) => {
      if (buffer.length < 5000) buffer.push({ obj, type });
    };
  }
}

// ============================================================================
// Auto-naming strategy for Pixi.js objects
// ============================================================================

function pixiAutoName(obj: any, _args: any[], _name: string): string | null {
  // Sprite → texture cache ID ("hero.png")
  if (obj.texture?.textureCacheIds?.[0]) {
    return obj.texture.textureCacheIds[0];
  }
  // Sprite → texture source label
  if (obj.texture?.source?.label) {
    return obj.texture.source.label;
  }
  // Text/BitmapText → content preview
  if (obj.text && typeof obj.text === 'string') {
    return `text:"${obj.text.slice(0, 20)}"`;
  }
  return null;
}

function noAutoName(): null { return null; }

// ============================================================================
// Infrastructure — Application exposes on window
// ============================================================================

export class Application extends OriginalApplication {
  constructor(...args: any[]) {
    super(...args);
    if (typeof window !== 'undefined') {
      (window as any).__PIXI_APP__ = this;
    }
  }

  /**
   * Pixi v8 init() — inject preserveDrawingBuffer so canvas.toDataURL() works
   * for inspector screenshots (WebGL clears the buffer after presentation otherwise).
   */
  async init(options?: any) {
    const patched = { ...options, preserveDrawingBuffer: true };
    return super.init(patched);
  }
}

// ============================================================================
// Core Display Objects
// ============================================================================

export const Container = makeHooked(OriginalContainer, 'Container', noAutoName);
export const Sprite = makeHooked(OriginalSprite, 'Sprite', pixiAutoName);
export const Graphics = makeHooked(OriginalGraphics, 'Graphics', noAutoName);
export const Text = makeHooked(OriginalText, 'Text', pixiAutoName);
export const Mesh = makeHooked(OriginalMesh, 'Mesh', noAutoName);

// ============================================================================
// Extended Display Objects (Pixi v8)
// ============================================================================

export const AnimatedSprite = makeHooked(OriginalAnimatedSprite, 'AnimatedSprite', pixiAutoName);
export const TilingSprite = makeHooked(OriginalTilingSprite, 'TilingSprite', pixiAutoName);
export const ParticleContainer = makeHooked(OriginalParticleContainer, 'ParticleContainer', noAutoName);
export const BitmapText = makeHooked(OriginalBitmapText, 'BitmapText', pixiAutoName);
export const HTMLText = makeHooked(OriginalHTMLText, 'HTMLText', pixiAutoName);

// Simple-mesh family — Pixi v8 successors of the removed v7 classes.
export const MeshSimple = makeHooked(OriginalMeshSimple, 'MeshSimple', noAutoName);
export const MeshPlane = makeHooked(OriginalMeshPlane, 'MeshPlane', noAutoName);
export const MeshRope = makeHooked(OriginalMeshRope, 'MeshRope', noAutoName);
export const NineSliceSprite = makeHooked(OriginalNineSliceSprite, 'NineSliceSprite', noAutoName);
