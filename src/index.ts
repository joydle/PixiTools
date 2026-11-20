/**
 * PixiTools: an inspector and a profiler for PixiJS, in the page.
 *
 *   import * as PIXI from 'pixi.js';
 *   import { attach } from '@joydle/pixitools';
 *   attach({ PIXI, app });
 */

import { setHost, type HostOptions } from './shared/host';
import { PixiInspector } from './inspector/PixiInspector';
import { PixiProfiler } from './profiler/PixiProfiler';
import { Panel } from './panel/Panel';
import type { InspectorConfig } from './inspector/core/InspectorBase';
import type { ProfilerConfig } from './profiler/core/types';

export * from './inspector/core';
export * as profiling from './profiler/core';
export { PixiInspector } from './inspector/PixiInspector';
export { PixiProfiler } from './profiler/PixiProfiler';
export { Panel } from './panel/Panel';
export { setHost } from './shared/host';
export type { HostOptions } from './shared/host';
export type { ProfilerAPI } from './profiler/core/ProfilerBase';
export { NAME, SLUG, GLOBAL, TRACK, ATTR_COMPONENT, ATTR_PROPS, ATTR_FX, ATTR_CHROME } from './brand';

/** Any Pixi v8 `Application`: checked by shape, so no Pixi types are needed to use this. */
export interface AppLike { readonly stage: object; readonly renderer: object }

export interface AttachOptions {
  /** The Pixi namespace (`import * as PIXI from 'pixi.js'`). With the hooked build it is found by itself. */
  PIXI?: { readonly VERSION: string };
  /** The Pixi `Application`. With the hooked build it is found by itself. */
  app?: AppLike;
  /** The built-in panel. Default true; a host that draws its own passes false. */
  panel?: boolean;
  /** The profiler, or its settings. Default true. */
  profiler?: boolean | Partial<ProfilerConfig>;
  inspector?: InspectorConfig;
  /** Who to talk to over postMessage when the page sits in an iframe. */
  host?: HostOptions;
}

export interface Tools {
  inspector: PixiInspector;
  profiler: PixiProfiler | null;
  panel: Panel | null;
  destroy(): void;
}

let current: Tools | null = null;

/**
 * Start the tools on an app. Called again (a hot reload), it replaces the
 * tools it started before.
 */
export function attach(options: AttachOptions = {}): Tools {
  current?.destroy();

  const w = window as unknown as Record<string, unknown>;
  if (options.PIXI) w.PIXI = options.PIXI;
  if (options.app) w.__PIXI_APP__ = options.app;

  setHost(options.host);

  const inspector = new PixiInspector(options.inspector);
  const profiler = options.profiler === false
    ? null
    : new PixiProfiler(typeof options.profiler === 'object' ? options.profiler : undefined);
  const panel = options.panel === false ? null : new Panel();

  const tools: Tools = {
    inspector,
    profiler,
    panel,
    destroy: () => {
      panel?.destroy();
      profiler?.destroy();
      inspector.destroy();
      if (current === tools) current = null;
    },
  };
  current = tools;
  return tools;
}
