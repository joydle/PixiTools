import { describe, expect, it } from 'vitest';
import { describeSelection } from '../src/panel/Panel';
import type { ObjectMetadata } from '../src/inspector/core/types';

const base: ObjectMetadata = {
  type: 'tower', typeName: 'Mesh', layer: 100,
  position: { x: 0, y: 2.3, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  alpha: 1, visible: true, childCount: 0, bounds: { x: 0, y: 0, width: 10, height: 10 }, parentLabel: 'lighthouse',
  sourceFile: 'demo.js', sourceLine: 58, sourceColumn: 15, sourceLineRange: null,
};

describe('describeSelection', () => {
  it('says what the object is and the line that made it', () => {
    const text = describeSelection({
      ...base,
      originalSource: '/demo.js', originalLine: 58, originalSourceLine: '  const tower = new Sprite(stone);',
      material: { type: 'MeshStandardMaterial', color: '#f4efe4' },
      userData: { floors: 4 },
    });
    expect(text.split('\n')).toEqual([
      'Mesh "tower" (MeshStandardMaterial #f4efe4)',
      'created at /demo.js:58',
      '  const tower = new Sprite(stone);',
      'position 0, 2.3, 0 | rotation 0, 0, 0 | scale 1, 1, 1',
      'visible true | children 0 | parent lighthouse',
      'userData {"floors":4}',
    ]);
  });

  it('names the texture, the tint and the parts attached', () => {
    const text = describeSelection({ ...base, texture: 'koi', tint: '#ff9a3c', components: [{ name: 'BlurFilter', enabled: false }, { name: 'Mask' }] });
    expect(text).toContain('texture koi\ntint #ff9a3c\nparts BlurFilter (off), Mask');
  });

  it('leaves out what it does not know', () => {
    const text = describeSelection({ ...base, sourceFile: null, sourceLine: null, active: false });
    expect(text).not.toContain('created at');
    expect(text).toContain('visible true (off in a parent)');
  });
});
