/**
 * Greybox construction helpers for the mission test zones. They use only the raw members every ZoneBuilder has
 * (`add`, `surface`, `collider`, `marker`, `P`) so the zones load identically on the real kit and on the
 * mission system's fallback builder.
 */
import * as THREE from 'three';
import type { Game, MatId, ZoneBuilder } from '@/core/api';
import { isStub } from '@/core/stub';

const FALLBACK_COLORS: Partial<Record<MatId, number>> = {
  blackStoneFloor: 0x0d0e12, blackStone: 0x101116, whiteGold: 0xd9d2c0, whiteGoldPanel: 0xcfc8b6, goldDark: 0x6b5632,
  goldTrim: 0xc9a45c, refSteel: 0x9aa3ad, refNavy: 0x1b2a44, domBronze: 0x8a5a2b, domOxblood: 0x5a1616,
};

export class Greybox {
  private readonly cache = new Map<string, THREE.Material>();

  constructor(
    private readonly game: Game,
    private readonly b: ZoneBuilder,
  ) {}

  mat(id: MatId): THREE.Material {
    let m = this.cache.get(id);
    if (m) return m;
    const lib = this.game.mats;
    if (!isStub(lib)) {
      m = lib.get(id);
    } else {
      m = new THREE.MeshStandardMaterial({ color: FALLBACK_COLORS[id] ?? 0x808080, roughness: 0.5, metalness: 0.3 });
    }
    this.cache.set(id, m);
    return m;
  }

  glow(color: number, intensity = 3): THREE.Material {
    const key = `glow:${color}:${intensity}`;
    let m = this.cache.get(key);
    if (m) return m;
    const lib = this.game.mats;
    if (!isStub(lib)) {
      m = lib.emissive(color, intensity);
    } else {
      m = new THREE.MeshStandardMaterial({ color: 0x050505, emissive: color, emissiveIntensity: intensity });
    }
    this.cache.set(key, m);
    return m;
  }

  /** Walkable floor slab: plan centre (x, n), size w × d, top at height h. */
  floor(x: number, n: number, w: number, d: number, h = 0, mat: MatId = 'blackStoneFloor'): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, d), this.mat(mat));
    mesh.position.set(x, h - 0.2, -n);
    mesh.receiveShadow = true;
    this.b.add(mesh);
    this.b.surface({ shape: { kind: 'rect', hx: w / 2, hz: d / 2 }, x, z: -n, y: h, material: 'stone', tag: 'test-floor' });
    const render = this.game.render;
    if (!isStub(render) && mat === 'blackStoneFloor') render.registerReflectiveFloor(mesh, { y: h });
    return mesh;
  }

  /** Solid block: plan centre (x, n), base height h, size w (east) × height × d (north). */
  block(x: number, n: number, w: number, height: number, d: number, mat: MatId, opts: { h?: number; cover?: 'low' | 'high'; solid?: boolean } = {}): THREE.Mesh {
    const h = opts.h ?? 0;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), this.mat(mat));
    mesh.position.set(x, h + height / 2, -n);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.b.add(mesh);
    if (opts.solid !== false) {
      this.b.collider({ shape: { kind: 'box', hx: w / 2, hy: height / 2, hz: d / 2 }, x, y: h + height / 2, z: -n, cover: opts.cover, tag: 'test-block' });
    }
    return mesh;
  }

  /** Emissive strip lying on the floor between two plan points (≥ 4 cm wide so it survives low quality). */
  strip(from: [number, number], to: [number, number], color: number, intensity = 3, width = 0.08, h = 0.012): THREE.Mesh {
    const dx = to[0] - from[0];
    const dn = to[1] - from[1];
    const len = Math.hypot(dx, dn);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.02, len), this.glow(color, intensity));
    mesh.position.set((from[0] + to[0]) / 2, h, -(from[1] + to[1]) / 2);
    mesh.rotation.y = Math.atan2(dx, -dn);
    this.b.add(mesh);
    return mesh;
  }

  /** The "white point" landmark over a threshold. */
  whitePoint(x: number, n: number, h: number): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), this.glow(0xfff4dc, 8));
    mesh.position.set(x, h, -n);
    this.b.add(mesh);
    const light = new THREE.PointLight(0xfff0d0, 14, 16, 2);
    light.position.set(x, h - 0.3, -n + 0.6);
    this.b.add(light);
  }

  point(x: number, n: number, h: number, color: number, intensity: number, distance = 14): THREE.PointLight {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.set(x, h, -n);
    this.b.add(light);
    return light;
  }

  /** Soft shadowed key light aimed at the plan point (x, n). */
  key(x: number, n: number, from: [number, number, number], color: number, intensity: number, extent = 26): THREE.DirectionalLight {
    const key = new THREE.DirectionalLight(color, intensity);
    key.position.set(x + from[0], from[1], -n + from[2]);
    key.target.position.set(x, 0, -n);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const cam = key.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 1;
    cam.far = 90;
    key.shadow.bias = -0.0006;
    this.b.add(key);
    this.b.add(key.target);
    return key;
  }
}
