import { defineConfig } from 'vite';
import pixitools from '@joydle/pixitools/vite';

// In dev, `pixi.js` resolves to the hooked build: every object remembers its line.
// `vite build` is untouched.
export default defineConfig({
  plugins: [pixitools()],
});
