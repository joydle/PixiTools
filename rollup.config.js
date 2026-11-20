import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

// Every output is named pixitools.*.js: a stack frame from one of them is
// recognised as ours (src/brand.ts OWN_FRAME) and never taken for the game's.
const plugins = () => [
  resolve({ browser: true, preferBuiltins: false }),
  commonjs(),
  // A type error fails the build; it never emits dist/ anyway.
  typescript({ tsconfig: './tsconfig.json', noEmitOnError: true, noEmit: false, declaration: false, sourceMap: true }),
];

export default [
  // The package: attach(), the inspector, the profiler, the panel.
  {
    input: 'src/index.ts',
    output: { file: 'dist/pixitools.js', format: 'esm', sourcemap: true },
    plugins: plugins(),
  },
  // pixi.js with source tracking, for the Vite plugin or an import map. pixi.js stays external.
  {
    input: 'src/hooked/pixi.ts',
    external: ["pixi.js"],
    output: [
      { file: 'dist/pixitools.pixi.js', format: 'esm', sourcemap: true },
      { file: 'dist/pixitools.pixi.min.js', format: 'esm', sourcemap: true, plugins: [terser()] },
    ],
    plugins: plugins(),
  },
  // The script tag: window.PixiTools, started by data-auto.
  {
    input: 'src/auto.ts',
    output: [
      { file: 'dist/pixitools.global.js', format: 'iife', name: 'PixiTools', sourcemap: true },
      { file: 'dist/pixitools.global.min.js', format: 'iife', name: 'PixiTools', sourcemap: true, plugins: [terser()] },
    ],
    plugins: plugins(),
  },
  // The Vite plugin (Node).
  {
    input: 'src/vite.ts',
    output: { file: 'dist/pixitools.vite.js', format: 'esm' },
    plugins: plugins(),
  },
];
