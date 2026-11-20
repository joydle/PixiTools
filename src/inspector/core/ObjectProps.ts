/**
 * What a picked object is drawn with and whether it is on — OBJECT_SELECTED's
 * `active`, `material`/`materials`, `texture`, `tint`, `components` and
 * `userData` — read structurally from the engine's own objects, so each engine
 * sends only what it has.
 *
 * THREE STATES: a field the engine has no concept of is LEFT OUT, never sent as
 * null, 0, false or an empty list pretending to be data (a host can then draw
 * a dash for it). Every value is small plain JSON: lists are capped,
 * geometry, uniforms and pixels never travel, and a data:/blob: picture is
 * named "embedded", never inlined.
 */

import type { ComponentInfo, MaterialInfo, ObjectMetadata } from './types';
import { plainValues } from './InspectorBase';

export type ObjectProps = Pick<
  ObjectMetadata,
  'active' | 'components' | 'material' | 'materials' | 'texture' | 'tint' | 'userData'
>;

export const MAX_MATERIALS = 8;
export const MAX_COMPONENTS = 16;
/** Nodes a group's material sweep visits before it stops (a GLB can hold thousands). */
export const MAX_MATERIAL_WALK = 256;
const MAX_TEXT = 120;
/** Parent links followed for `active` (a cycle or a runaway chain stops here). */
const MAX_DEPTH = 64;

const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v.slice(0, MAX_TEXT) : undefined;

/** A 24-bit colour number as #rrggbb. */
export function hexColour(n: unknown): string | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  return '#' + (Math.trunc(n) & 0xffffff).toString(16).padStart(6, '0');
}

/**
 * A picture's file name from its address or key: query and fragment dropped,
 * the last path segment kept. A data:/blob: picture is "embedded" — its bytes
 * never travel.
 */
export function textureName(v: unknown): string | undefined {
  const s = text(typeof v === 'string' ? v.trim() : v);
  if (!s) return undefined;
  if (/^(data|blob):/i.test(s)) return 'embedded';
  const path = s.split(/[?#]/)[0].replace(/\/+$/, '');
  const last = path.slice(path.lastIndexOf('/') + 1);
  if (!last) return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The address of an image-like source (an <img>, a video), never a canvas or bitmap's pixels. */
function sourceAddress(image: unknown): string | undefined {
  if (!image || typeof image !== 'object') return undefined;
  const i = image as { currentSrc?: unknown; src?: unknown };
  return text(i.currentSrc) ?? text(i.src);
}

// ============================================================================
// three.js
// ============================================================================

interface ThreeTextureLike {
  name?: unknown;
  image?: unknown;
  source?: { data?: unknown };
}

interface ThreeMaterialLike {
  name?: unknown;
  type?: unknown;
  color?: { getHex?: () => number } | null;
  map?: ThreeTextureLike | null;
  opacity?: unknown;
}

interface ThreeNodeLike {
  visible?: unknown;
  parent?: ThreeNodeLike | null;
  children?: ThreeNodeLike[];
  material?: unknown;
  userData?: unknown;
}

function threeTextureName(t: ThreeTextureLike | null | undefined): string | undefined {
  if (!t || typeof t !== 'object') return undefined;
  return text(t.name) ?? textureName(sourceAddress(t.source?.data ?? t.image));
}

/** One three.js material: name, type, colour (#rrggbb), colour map, opacity. */
export function threeMaterial(m: unknown): MaterialInfo | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const mat = m as ThreeMaterialLike;
  const out: MaterialInfo = {};
  const name = text(mat.name);
  if (name) out.name = name;
  const type = text(mat.type);
  if (type) out.type = type;
  const color = typeof mat.color?.getHex === 'function' ? hexColour(mat.color.getHex()) : undefined;
  if (color) out.color = color;
  const map = threeTextureName(mat.map);
  if (map) out.map = map;
  if (typeof mat.opacity === 'number' && Number.isFinite(mat.opacity)) out.opacity = mat.opacity;
  return Object.keys(out).length ? out : undefined;
}

/** On iff `on` holds for it and every parent — a hidden parent hides its children in both engines. */
function visibleChain(node: unknown, on: (n: any) => boolean): boolean {
  let n: any = node;
  for (let d = 0; n && d < MAX_DEPTH; d++, n = n.parent) {
    if (!on(n)) return false;
  }
  return true;
}

/**
 * A three.js object's props. A mesh sends its material (a multi-material mesh
 * its `materials`); a group, which three draws through its meshes, sends their
 * distinct materials as `materials`. Three has no components: none are sent.
 */
export function threeProps(obj: unknown): ObjectProps {
  const node = obj as ThreeNodeLike;
  const out: ObjectProps = {};
  if (!node || typeof node !== 'object') return out;

  if (typeof node.visible === 'boolean') out.active = visibleChain(node, (n) => n.visible !== false);

  if (Array.isArray(node.material)) {
    const list = node.material.slice(0, MAX_MATERIALS).map(threeMaterial).filter((m): m is MaterialInfo => !!m);
    if (list.length) out.materials = list;
  } else if (node.material) {
    const one = threeMaterial(node.material);
    if (one) out.material = one;
  } else {
    const seen = new Set<unknown>();
    const list: MaterialInfo[] = [];
    const queue: ThreeNodeLike[] = [...(node.children ?? [])];
    for (let visited = 0; queue.length && visited < MAX_MATERIAL_WALK && list.length < MAX_MATERIALS; visited++) {
      const n = queue.shift()!;
      const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
      for (const m of mats) {
        if (seen.has(m) || list.length >= MAX_MATERIALS) continue;
        seen.add(m);
        const info = threeMaterial(m);
        if (info) list.push(info);
      }
      if (Array.isArray(n.children)) queue.push(...n.children);
    }
    if (list.length) out.materials = list;
  }

  const data = plainValues(node.userData);
  if (data) out.userData = data;
  return out;
}

// ============================================================================
// PixiJS (v8)
// ============================================================================

interface PixiTextureLike {
  label?: unknown;
  source?: { label?: unknown; resource?: unknown };
}

interface PixiNodeLike {
  visible?: unknown;
  renderable?: unknown;
  destroyed?: unknown;
  parent?: PixiNodeLike | null;
  tint?: unknown;
  texture?: PixiTextureLike | null;
  filters?: unknown;
  mask?: unknown;
}

/** A Pixi texture's key: its label (Assets sets the url; a sheet frame its name), else its source's. */
function pixiTextureName(t: PixiTextureLike | null | undefined): string | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const key = text(t.label) ?? text(t.source?.label) ?? sourceAddress(t.source?.resource);
  // Texture.EMPTY is Pixi's "no texture".
  return key === 'EMPTY' ? undefined : textureName(key);
}

/** A part's name: its label, else its class (Pixi's own read "_BlurFilter"); a minified build's ("e") say nothing. */
function partName(p: unknown, fallback: string): string {
  const own = text((p as { label?: unknown })?.label);
  if (own) return own;
  const ctor = (p as { constructor?: { name?: unknown } })?.constructor?.name;
  const name = typeof ctor === 'string' ? ctor.replace(/^_+/, '') : '';
  return name.length > 2 ? name.slice(0, MAX_TEXT) : fallback;
}

/**
 * A Pixi container's props: `active` (visible and renderable here and in every
 * parent, not destroyed — Pixi's own display status), `tint`, the `texture`
 * key, and its filters and mask as `components`. Pixi has no materials and no
 * userData: none are sent.
 */
export function pixiProps(obj: unknown): ObjectProps {
  const c = obj as PixiNodeLike;
  const out: ObjectProps = {};
  if (!c || typeof c !== 'object') return out;

  if (typeof c.visible === 'boolean') {
    out.active = visibleChain(c, (n) => n.destroyed !== true && n.visible !== false && n.renderable !== false);
  }
  const tint = hexColour(c.tint);
  if (tint) out.tint = tint;
  const texture = pixiTextureName(c.texture);
  if (texture) out.texture = texture;

  const parts: ComponentInfo[] = [];
  if (Array.isArray(c.filters)) {
    for (const f of c.filters.slice(0, MAX_COMPONENTS)) {
      if (!f || typeof f !== 'object') continue;
      const enabled = (f as { enabled?: unknown }).enabled;
      parts.push(typeof enabled === 'boolean' ? { name: partName(f, 'Filter'), enabled } : { name: partName(f, 'Filter') });
    }
  }
  if (c.mask && typeof c.mask === 'object' && parts.length < MAX_COMPONENTS) parts.push({ name: 'Mask' });
  if (parts.length) out.components = parts;
  return out;
}

// ============================================================================
// Canvas2D
// ============================================================================

/**
 * A Canvas2D draw call's props: the picture a drawImage drew, by file name.
 * A draw call has no material, tint, parts, state or userData.
 */
export function canvasProps(method: string, image: unknown): ObjectProps {
  if (method !== 'drawImage') return {};
  const texture = textureName(sourceAddress(image));
  return texture ? { texture } : {};
}
