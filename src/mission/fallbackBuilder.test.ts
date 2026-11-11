import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Game } from '@/core/api';
import { nullObject } from '@/core/stub';
import { createFallbackBuilder } from './fallbackBuilder';

describe('fallback builder (no kit)', () => {
  it('static dressing handed over for merging is still drawn: addStatic adds it to the root as is (polish 4)', () => {
    const root = new THREE.Group();
    const game = { physics: nullObject('physics'), mats: nullObject('mats') } as unknown as Game;
    const b = createFallbackBuilder(game, root, 7) as unknown as { addStatic<T extends THREE.Object3D>(o: T, opts?: unknown): T; marker(n: string, x: number, n2: number): unknown };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    expect(b.addStatic(mesh, { instance: true })).toBe(mesh);
    expect(mesh.parent).toBe(root);
    // a finish material is the base material without the kit
    const asked: string[] = [];
    const mat = new THREE.MeshStandardMaterial();
    (game as unknown as { mats: unknown }).mats = { get: (id: string) => (asked.push(id), mat) };
    const b2 = createFallbackBuilder(game, root, 7);
    expect(b2.surfaceMaterial?.('worn')).toBe(mat);
    expect(b2.surfaceMaterial?.('hangar', 'blackStoneFloor')).toBe(mat);
    expect(asked).toEqual(['whiteGoldFloor', 'blackStoneFloor']);
    // anything else the kit would do is a quiet no-op
    expect(() => (b as unknown as { pipes(p: unknown): unknown }).pipes([[0, 0, 1]])).not.toThrow();
  });
});
