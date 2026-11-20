// The shared directories (src/inspector/core, src/profiler/core, src/shared,
// src/panel, src/hooked/{hookFactory,captureSource}.ts) are the same files in
// ThreeTools and PixiTools: every name that differs lives in src/brand.ts. This
// fails when a shared file names a tool itself.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const shared = ['src/inspector/core', 'src/profiler/core', 'src/shared', 'src/panel', 'src/hooked/hookFactory.ts', 'src/hooked/captureSource.ts'];
const named = /threetools|pixitools/i;
const files = (p) => (statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => files(join(p, f))) : [p]);

const bad = shared.flatMap(files).filter((f) => named.test(readFileSync(f, 'utf8')));
if (bad.length) {
  console.error(`These shared files name a tool; use src/brand.ts instead:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log(`shared files are brand-free (${shared.flatMap(files).length} files)`);
