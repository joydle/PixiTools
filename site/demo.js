// Pond Hop: click the water and the frog leaps there; land on the dragonfly to
// catch it. Every line here is what the panel shows when you pick something:
// PixiTools remembers where each object was made.

import { Application, BlurFilter, Container, Graphics, Sprite } from 'pixi.js';
import { attach } from '@joydle/pixitools';

const app = new Application();
await app.init({ resizeTo: window, background: '#0e2a33', antialias: true });
document.body.appendChild(app.canvas);

// The pond is drawn on a 1280 x 800 sheet that always covers the window.
const pond = new Container({ label: 'pond' });
app.stage.addChild(pond);

const water = new Graphics().rect(0, 0, 1280, 800).fill('#12343f');
water.label = 'water';

const moonlight = new Graphics().ellipse(930, 250, 150, 44).fill('#f3ecc8');
moonlight.label = 'moonlight';
moonlight.alpha = 0.5;
moonlight.filters = [new BlurFilter({ strength: 14 })];

const ripple = new Graphics().circle(0, 0, 60).stroke({ color: '#9fd4d0', width: 3 });
ripple.label = 'ripple';
ripple.position.set(420, 520);

// One fish drawn once, then tinted: three sprites share its texture.
const fishShape = new Graphics().ellipse(0, 0, 46, 17).fill('#ffffff').poly([-38, 0, -74, -20, -66, 0, -74, 20]).fill('#ffffff');
const fishTexture = app.renderer.generateTexture(fishShape);
fishTexture.source.label = 'koi.png';

const goldie = new Sprite({ texture: fishTexture, tint: '#ff9a3c', label: 'goldie', anchor: 0.5 });
const pearl = new Sprite({ texture: fishTexture, tint: '#f6efe2', label: 'pearl', anchor: 0.5 });
const ember = new Sprite({ texture: fishTexture, tint: '#e2574c', label: 'ember', anchor: 0.5, scale: 0.75 });

const pad = (r) => new Graphics().circle(0, 0, r).fill('#3f8f6b').poly([0, 0, r, -r * 0.13, r, r * 0.13]).fill('#12343f');

const bigPad = pad(96);
bigPad.label = 'big lily pad';
bigPad.position.set(340, 300);

const smallPad = pad(62);
smallPad.label = 'small lily pad';
smallPad.position.set(820, 560);
smallPad.rotation = 2.2;

const farPad = pad(48);
farPad.label = 'far lily pad';
farPad.position.set(1060, 170);
farPad.rotation = 4;

const lotus = new Graphics().ellipse(0, -18, 12, 26).ellipse(-20, -6, 12, 24).ellipse(20, -6, 12, 24).fill('#f2b6c6').circle(0, 0, 9).fill('#f6dd8a');
lotus.label = 'lotus';
lotus.position.set(836, 548);

const frog = new Graphics().ellipse(0, 0, 30, 22).fill('#8fd16a').circle(-13, -17, 8).circle(13, -17, 8).fill('#b6e58f').circle(-13, -17, 3).circle(13, -17, 3).fill('#17301f');
frog.label = 'frog';
frog.position.set(330, 290);

const dragonfly = new Graphics().roundRect(-22, -2, 44, 4, 2).fill('#7fd6e8').ellipse(-4, -10, 16, 6).ellipse(-4, 10, 16, 6).fill({ color: '#d9f4f7', alpha: 0.7 });
dragonfly.label = 'dragonfly';

const reeds = new Graphics().moveTo(60, 800).lineTo(84, 590).moveTo(104, 800).lineTo(116, 540).moveTo(150, 800).lineTo(142, 610).stroke({ color: '#6fa67a', width: 7, cap: 'round' });
reeds.label = 'reeds';

const fireflies = new Container({ label: 'fireflies' });

pond.addChild(water, moonlight, ripple, goldie, pearl, ember, bigPad, smallPad, farPad, lotus, frog, reeds, dragonfly, fireflies);

// -- The stress test the site drives: many fireflies, drawn badly or well ----

const glow = app.renderer.generateTexture(new Graphics().circle(0, 0, 5).fill('#fff3a8'));
glow.source.label = 'glow.png';
let stressed = 'no';

function stress(count, batched) {
  fireflies.removeChildren().forEach((child) => child.destroy());
  for (let i = 0; i < count; i++) {
    const firefly = new Sprite({ texture: glow, anchor: 0.5, label: 'firefly' });
    // Drawn badly: neighbours alternate blend mode, so no two can share a draw call.
    firefly.blendMode = batched || i % 2 ? 'add' : 'normal';
    firefly.position.set(Math.random() * 1280, Math.random() * 800);
    firefly.phase = Math.random() * 6.28;
    fireflies.addChild(firefly);
  }
  stressed = count === 0 ? 'no' : batched ? 'fixed' : 'yes';
  window.parent.postMessage({ type: 'DEMO_STATE', stressed, count }, '*');
}

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'DEMO') return;
  if (event.data.action === 'stress') stress(1500, false);
  if (event.data.action === 'fix') stress(1500, true);
  if (event.data.action === 'reset') stress(0, true);
});

// -- Play: click or tap, the frog leaps there ----------------------------------

const leap = { from: frog.position.clone(), to: frog.position.clone(), start: -1 };
const caught = document.getElementById('caught');
let flies = 0, dart = 0;

app.canvas.addEventListener('pointerdown', (event) => {
  leap.from.copyFrom(frog.position);
  leap.to.copyFrom(pond.toLocal({ x: event.clientX, y: event.clientY }));
  leap.start = t;
});

function hop() {
  if (leap.start < 0) return;
  const p = Math.min(1, (t - leap.start) / 0.42);
  frog.position.set(leap.from.x + (leap.to.x - leap.from.x) * p, leap.from.y + (leap.to.y - leap.from.y) * p);
  frog.scale.set(1 + Math.sin(p * Math.PI) * 0.55);
  if (p < 1) return;
  leap.start = -1;
  ripple.position.copyFrom(frog.position);
  if (Math.hypot(frog.x - dragonfly.x, frog.y - dragonfly.y) > 95) return;
  flies += 1;
  dart += 2 + Math.random() * 3;
  caught.textContent = flies;
  caught.parentElement.dataset.pixitoolsProps = JSON.stringify({ caught: flies });
}

// -- Life ---------------------------------------------------------------------

function swim(fish, t, cx, cy, rx, ry, speed) {
  const x = cx + Math.cos(t * speed) * rx, y = cy + Math.sin(t * speed * 1.7) * ry;
  fish.rotation = Math.atan2(y - fish.y, x - fish.x);
  fish.position.set(x, y);
}

let t = 0;
app.ticker.add((tick) => {
  t += tick.deltaMS / 1000;
  const fit = Math.max(app.screen.width / 1280, app.screen.height / 800);
  pond.scale.set(fit);
  pond.position.set((app.screen.width - 1280 * fit) / 2, (app.screen.height - 800 * fit) / 2);

  swim(goldie, t, 560, 420, 330, 150, 0.32);
  swim(pearl, t + 9, 760, 330, 300, 190, 0.26);
  swim(ember, t + 4, 420, 560, 240, 110, 0.41);

  ripple.scale.set(0.4 + (t % 3) * 0.5);
  ripple.alpha = 1 - (t % 3) / 3;
  hop();
  if (leap.start < 0) frog.scale.y = 1 + Math.sin(t * 2.4) * 0.05;
  dragonfly.position.set(640 + Math.cos((t + dart) * 0.9) * 380, 400 + Math.sin((t + dart) * 1.3) * 240);
  dragonfly.rotation = Math.sin((t + dart) * 0.9) * 0.6;
  reeds.skew.x = Math.sin(t * 0.8) * 0.03;
  for (const firefly of fireflies.children) firefly.alpha = 0.5 + Math.sin(t * 3 + firefly.phase) * 0.5;
});

// The hooked `pixi.js` in this page's import map put the app where the tools
// find it, so attach() needs no arguments.
attach();
