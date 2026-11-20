// Copy the built files the demo page loads into site/lib (not committed; the
// Pages workflow runs this after the build).
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('site/lib', { recursive: true, force: true });
mkdirSync('site/lib', { recursive: true });
for (const file of ['pixitools.js', 'pixitools.js.map', 'pixitools.pixi.js', 'pixitools.pixi.js.map']) {
  cpSync(`dist/${file}`, `site/lib/${file}`);
}
console.log('site/lib ready');
