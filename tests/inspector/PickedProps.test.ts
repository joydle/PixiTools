// @vitest-environment jsdom
/**
 * What a picked object is drawn with and whether it is on (OBJECT_SELECTED's
 * active / material(s) / texture / tint / components / userData), per engine,
 * on real Pixi objects. THREE STATES: a field the engine has no
 * concept of is ABSENT from the message — not null, 0, false or [] — so a host
 * (a property panel) draws a dash rather than a made-up value.
 */
import { describe, it, expect, vi } from 'vitest';
import { Container, Sprite, Graphics, Texture, TextureSource, Filter } from 'pixi.js';
import { pixiProps, canvasProps, textureName, hexColour } from '../../src/inspector/core/ObjectProps';
import { PixiInspector } from '../../src/inspector/PixiInspector';

const NEW_FIELDS = ['active', 'components', 'material', 'materials', 'texture', 'tint', 'userData'] as const;

/** Engine inspectors without their constructor/auto-init; the send path is real. */
function harness<T>(proto: T, extra: Record<string, unknown>) {
  const insp = Object.create(proto as object);
  const sent: any[] = [];
  Object.assign(insp, {
    config: { debug: false },
    log: () => {},
    messages: { send: (m: unknown) => sent.push(m) },
    domInspector: { findComponentNamed: () => null },
    domHighlighter: { clearSelection: () => {} },
    canvasHighlighter: { clear: () => {} },
    tracker: { get: () => undefined, has: () => true },
    stackParser: { getCodeRange: () => null },
    ...extra,
  });
  return { insp, sent };
}

/** Pick by name through the real OBJECT_SELECTED path; the message must survive JSON. */
async function pick(insp: any, sent: any[], name: string) {
  insp.selectByName(name);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  const msg = sent[0];
  expect(msg.type).toBe('OBJECT_SELECTED');
  expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  return msg.metadata;
}

describe('helpers', () => {
  it('names a picture by its file, never inlines one', () => {
    expect(textureName('http://localhost:5173/assets/ship%20a.png?v=3#x')).toBe('ship a.png');
    expect(textureName('assets/hero.png')).toBe('hero.png');
    expect(textureName('data:image/png;base64,' + 'A'.repeat(5000))).toBe('embedded');
    expect(textureName('blob:http://localhost/1234-abcd')).toBe('embedded');
    expect(textureName('')).toBeUndefined();
    expect(textureName(42)).toBeUndefined();
  });

  it('writes a colour number as #rrggbb', () => {
    expect(hexColour(0xff8800)).toBe('#ff8800');
    expect(hexColour(0x0000ff)).toBe('#0000ff');
    expect(hexColour(NaN)).toBeUndefined();
    expect(hexColour('red')).toBeUndefined();
  });
});

describe('Pixi', () => {
  function heroTexture() {
    return new Texture({ source: new TextureSource({ label: 'http://localhost/assets/hero.png', width: 4, height: 4 }), label: 'http://localhost/assets/hero.png' });
  }

  it('a sprite sends active, tint, its texture key and its filters and mask as components', () => {
    const stage = new Container();
    const hero = new Sprite(heroTexture());
    hero.label = 'hero';
    hero.tint = 0xff0000;
    const blur = new Filter({ resources: {} } as never);
    blur.enabled = false;
    hero.filters = [blur];
    hero.mask = new Graphics();
    stage.addChild(hero);
    const p = pixiProps(hero);
    expect(p.active).toBe(true);
    expect(p.tint).toBe('#ff0000');
    expect(p.texture).toBe('hero.png');
    expect(p.components).toEqual([{ name: 'Filter', enabled: false }, { name: 'Mask' }]);
    for (const k of ['material', 'materials', 'userData']) expect(k in p).toBe(false);
  });

  it('a sheet frame sends its frame key; Texture.EMPTY and a Graphics send no texture; no filters = no components', () => {
    const frame = new Sprite(new Texture({ source: new TextureSource({ width: 4, height: 4 }), label: 'run_01' }));
    expect(pixiProps(frame).texture).toBe('run_01');
    const bare = new Sprite(Texture.EMPTY);
    expect('texture' in pixiProps(bare)).toBe(false);
    const g = new Graphics();
    const p = pixiProps(g);
    expect('texture' in p).toBe(false);
    expect('components' in p).toBe(false);
    expect(p.tint).toBe('#ffffff');
  });

  it('is inactive when it or a parent is hidden, not renderable, or destroyed', () => {
    const stage = new Container();
    const layer = new Container();
    const coin = new Sprite(heroTexture());
    stage.addChild(layer);
    layer.addChild(coin);
    expect(pixiProps(coin).active).toBe(true);
    layer.renderable = false;
    expect(pixiProps(coin).active).toBe(false);
    layer.renderable = true;
    layer.visible = false;
    expect(pixiProps(coin).active).toBe(false);
    layer.visible = true;
    coin.visible = false;
    expect(pixiProps(coin).active).toBe(false);
  });

  it('picking it sends the fields on OBJECT_SELECTED, as plain JSON', async () => {
    const stage = new Container();
    const hero = new Sprite(heroTexture());
    hero.label = 'hero';
    hero.tint = 0x3366ff;
    stage.addChild(hero);
    const { insp, sent } = harness(PixiInspector.prototype, {
      findObjectByName: () => hero,
      getCanvas: () => null,
    });
    const meta = await pick(insp, sent, 'hero');
    expect(meta).toMatchObject({ active: true, tint: '#3366ff', texture: 'hero.png' });
    for (const k of ['components', 'material', 'materials', 'userData']) expect(k in meta).toBe(false);
  });
});

describe('Canvas2D', () => {
  it('a drawImage sends the picture it drew; other draws send nothing new', () => {
    const img = document.createElement('img');
    img.src = 'http://localhost/assets/coin.png';
    expect(canvasProps('drawImage', img)).toEqual({ texture: 'coin.png' });
    expect(canvasProps('drawImage', document.createElement('canvas'))).toEqual({});
    const rect = canvasProps('fillRect', undefined);
    for (const k of NEW_FIELDS) expect(k in rect).toBe(false);
  });
});
