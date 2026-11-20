/**
 * The script-tag build: `window.PixiTools`, started by the tag itself.
 *
 *   <script src="pixitools.global.min.js" data-auto></script>
 *
 * `data-auto` starts the tools as the page loads; they wait for the app the
 * hooked pixi build (or the page) puts on `window.__PIXI_APP__`. `data-panel="off"` leaves
 * the panel out for a host that draws its own, `data-profiler="off"` the
 * profiler, and `data-origin` names the one origin to talk to.
 */

import { attach } from './index';

export * from './index';

const tag = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;

if (tag && tag.dataset.auto !== undefined) {
  const start = (): void => {
    attach({
      panel: tag.dataset.panel !== 'off',
      profiler: tag.dataset.profiler !== 'off',
      inspector: { debug: tag.dataset.debug !== undefined, captureConsole: tag.dataset.console !== undefined },
      host: tag.dataset.origin ? { origin: tag.dataset.origin } : undefined,
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
