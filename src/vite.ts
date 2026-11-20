/**
 * The Vite plugin: in dev, `pixi.js` resolves to the hooked build, so every
 * object remembers the line that made it and the app is found
 * by itself.
 *
 *   import pixitools from '@joydle/pixitools/vite';
 *   export default { plugins: [pixitools()] };
 *
 * A build is untouched: `apply: 'serve'`.
 */

export interface PixiToolsViteOptions {
  /** Also hook a production build (`vite build`). Default false. */
  build?: boolean;
}

interface ResolveContext {
  resolve(source: string, importer?: string, options?: Record<string, unknown>): Promise<{ id: string } | null>;
}

const HOOKED = '@joydle/pixitools/pixi';
/** The hooked build itself, however the id is spelled: it must get the real pixi.js. */
const IS_HOOKED = /pixitools\.pixi\.(?:min\.)?js|[\\/]hooked[\\/]pixi\.ts/;

export default function pixitools(options: PixiToolsViteOptions = {}) {
  return {
    name: 'pixitools',
    enforce: 'pre' as const,
    apply: options.build ? undefined : ('serve' as const),
    config() {
      // Pre-bundling would inline pixi.js into the hooked build and hide it from resolveId.
      return { optimizeDeps: { exclude: ['@joydle/pixitools'] } };
    },
    async resolveId(this: ResolveContext, source: string, importer: string | undefined, opts: Record<string, unknown>) {
      if (source !== 'pixi.js') return null;
      if (importer && IS_HOOKED.test(importer)) return null;
      return this.resolve(HOOKED, importer, { ...opts, skipSelf: true });
    },
  };
}
