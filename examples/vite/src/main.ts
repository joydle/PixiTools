import { Application, Graphics, Sprite, Text } from 'pixi.js';

const app = new Application();
await app.init({ resizeTo: window, background: '#131518', antialias: true });
document.body.appendChild(app.canvas);

const coinTexture = app.renderer.generateTexture(new Graphics().circle(0, 0, 40).fill('#ffffff'));
coinTexture.source.label = 'coin.png';

const coin: Sprite = new Sprite({ texture: coinTexture, tint: '#f2c66d', anchor: 0.5, label: 'coin' });
coin.position.set(260, 240);
app.stage.addChild(coin);

const crate = new Graphics().roundRect(-50, -50, 100, 100, 12).fill('#8fbf9f');
crate.label = 'crate';
crate.position.set(480, 240);
app.stage.addChild(crate);

const score: Text = new Text({ text: 'Score 0', style: { fill: '#ecebe7', fontSize: 28 } });
score.label = 'score';
score.position.set(40, 32);
app.stage.addChild(score);

app.ticker.add((tick) => {
  crate.rotation += tick.deltaMS / 1000;
  coin.scale.x = Math.cos(performance.now() / 400);
});

// Dev only: the tools never reach a production bundle.
if (import.meta.env.DEV) {
  const { attach } = await import('@joydle/pixitools');
  attach();
}
