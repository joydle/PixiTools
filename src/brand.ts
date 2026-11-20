/**
 * Every name these tools put on a page: one place, so two tools on one page
 * (PixiTools beside PixiTools) never collide and a host knows what to look for.
 */

export const NAME = 'PixiTools';
export const SLUG = 'pixitools';

/** `window.__pixitools`: `{ inspector, profiler }`, each present once it runs. */
export const GLOBAL = '__pixitools';

/** `window.__PIXITOOLS_TRACK__(obj, name)`: called by the hooked engine for each object it makes. */
export const TRACK = '__PIXITOOLS_TRACK__';

/** A DOM id of ours: `pixitools-<part>`. */
export const id = (part: string): string => `${SLUG}-${part}`;

/** A DOM attribute of ours: `data-pixitools-<part>`. */
export const attr = (part: string): string => `data-${SLUG}-${part}`;

/** A HUD element's name for the inspector; unannotated elements get a derived one. */
export const ATTR_COMPONENT = attr('component');
/** JSON props shown with a HUD element. */
export const ATTR_PROPS = attr('props');
/** "true" on decoration (particles, flashes) the tree files under fx. */
export const ATTR_FX = attr('fx');
/** On any element of ours: never picked, never in a screenshot. */
export const ATTR_CHROME = attr('chrome');

/** Our own files in a stack frame (`pixitools.js`, `pixitools.pixi.min.js`, ...): never the line a person wrote. */
export const OWN_FRAME = /pixitools(?:\.[\w-]+)*\.js|[\\/]pixitools[\\/](?:src|dist)[\\/]/i;

/** The `source` on every message each tool posts, so a host can tell ours from the game's. */
export const SOURCE_INSPECTOR = SLUG;
export const SOURCE_PROFILER = SLUG;

/** The slot on `window[GLOBAL]` for one tool, created on first use. */
export function globalSlot(): Record<string, unknown> {
  const w = window as unknown as Record<string, Record<string, unknown> | undefined>;
  return (w[GLOBAL] ??= {});
}

/** `window.__PIXITOOLS_TRACK_BUFFER__`: objects the hooked engine made before the inspector started. */
export const TRACK_BUFFER = '__PIXITOOLS_TRACK_BUFFER__';
