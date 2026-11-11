/**
 * Minimal ZoneBuilder used when the environment kit is unavailable (a null-object stub, or its factory failed).
 * It implements the space / marker / raw-object / physics members exactly, applies `setEnv`, and answers every
 * other kit call with a no-op, so a zone still loads, scripts run and `z.m()` resolves — the mission can be
 * driven and debugged without dressing.
 */
import * as THREE from 'three';
import type { ColliderDesc, ColliderHandle, Game, Marker, SurfaceDesc, SurfaceHandle, ZoneBuilder, ZoneEnvOpts } from '@/core/api';
import { reportError } from '@/core/events';
import { DEG, mulberry32 } from '@/core/mathx';
import { nullObject } from '@/core/stub';

/** Members a builder may expose beyond the contract (the kit adds `dispose`; update callbacks need a pump). */
export interface BuilderExtras {
  dispose?: () => void;
  update?: (dt: number, time: number) => void;
}

export function createFallbackBuilder(game: Game, root: THREE.Group, seed: number): ZoneBuilder {
  const rand = mulberry32(seed);
  const markers = new Map<string, Marker>();
  const updaters: Array<(dt: number, time: number) => void> = [];
  const warned = new Set<string>();

  const real: Partial<ZoneBuilder> & BuilderExtras = {
    game,
    root,
    physics: game.physics,
    mats: game.mats,
    rand,
    P: (x: number, n: number, h = 0) => new THREE.Vector3(x, h, -n),
    yaw: (yawDeg: number) => -yawDeg * DEG,
    marker(name: string, x: number, n: number, h = 0, yawDeg = 0): Marker {
      const m: Marker = { name, pos: new THREE.Vector3(x, h, -n), yaw: -yawDeg * DEG };
      markers.set(name, m);
      return m;
    },
    getMarker(name: string): Marker {
      const m = markers.get(name);
      if (m) return m;
      if (!warned.has(name)) {
        warned.add(name);
        console.warn(`[mission] unknown marker "${name}" — using the zone origin`);
      }
      return { name, pos: new THREE.Vector3(), yaw: 0 };
    },
    hasMarker: (name: string) => markers.has(name),
    markers,
    setEnv(opts: ZoneEnvOpts): void {
      game.sky.setPreset(opts.sky);
      game.render.setLook(opts.look, 0);
      if (opts.ambience) game.audio.setAmbience(opts.ambience, 1.5);
      if (opts.music) game.audio.setMusic(opts.music, 2);
    },
    add<T extends THREE.Object3D>(obj: T): T {
      root.add(obj);
      return obj;
    },
    // (polish 4) without the kit a finish is the base material itself (the kit's maps are what the finish adds)
    surfaceMaterial: (_finish, base) => game.mats.get(base ?? 'whiteGoldFloor'),
    collider: (desc: ColliderDesc): ColliderHandle => game.physics.addCollider(desc),
    surface: (desc: SurfaceDesc): SurfaceHandle => game.physics.addSurface(desc),
    onUpdate(fn: (dt: number, time: number) => void): void {
      updaters.push(fn);
    },
    finalize(): void {
      game.physics.nav.rebuild();
      game.render.refreshEnvironment();
    },
    update(dt: number, time: number): void {
      for (const fn of updaters) {
        try {
          fn(dt, time);
        } catch (err) {
          reportError('zone:onUpdate', err);
        }
      }
    },
    dispose(): void {
      updaters.length = 0;
      // geometry only: materials on these meshes are usually shared library instances
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry && typeof mesh.geometry.dispose === 'function') mesh.geometry.dispose();
        const light = o as THREE.Light;
        if (light.isLight && typeof light.dispose === 'function') light.dispose();
      });
    },
  };

  const cache = real as Record<string | symbol, unknown>;
  // (polish 4) static dressing a zone hands the kit to merge is still drawn without the kit: added to the root as is
  cache.addStatic = <T extends THREE.Object3D>(obj: T): T => {
    if (obj && (obj as THREE.Object3D).isObject3D) root.add(obj);
    return obj;
  };
  return new Proxy(cache, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol' || p === 'then') return undefined;
      if (p === '__isStub') return false;
      return (t[p] = nullObject(`kit(fallback).${String(p)}`));
    },
  }) as unknown as ZoneBuilder;
}
