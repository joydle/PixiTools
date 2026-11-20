// @vitest-environment jsdom
/**
 * A host's scene list selects by place, not by name: five objects called
 * "Mesh" are five places, and the fifth row must pick the fifth (the scene
 * list in a host picked the first one for every row).
 */

import { describe, expect, it } from 'vitest';
import { PixiInspector } from '../../src/inspector/PixiInspector';

const meshes = () => Array.from({ length: 5 }, (_, i) => ({ name: 'Mesh', type: 'Mesh', children: [] as unknown[], n: i }));

describe('findObjectByPath', () => {
  it('walks a Pixi stage by child index, so repeated names stay apart', () => {
    const stage = { label: 'stage', children: [{ label: 'world', children: meshes() }] };
    const find = (path: number[]) => (PixiInspector.prototype as any).findObjectByPath.call({ app: { stage }, findPixiApp: () => null, stage: null }, path);
    expect((find([0, 4]) as { n: number }).n).toBe(4);
    expect(find([0, 5])).toBeNull();
  });
});
