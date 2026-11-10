/**
 * The damaged carrier (Z05): a ≈ 460 m slab-hulled ship on an authored pass above the atrium ceiling. Progress is
 * fully driven by the zone script (`setProgress`), so a cinematic skip lands in exactly the same state. It clips
 * the scenic tower at progress 0.8 (sparks, debris, the tower tip shears off) and relights its ventral
 * maneuvering jets as `setStabilized` rises. Three draw calls: hull, light cards, the spark pool.
 */
import * as THREE from 'three';
import type { CarrierActor, Vec3Like } from '@/core/api';
import { clamp01, mulberry32 } from '@/core/mathx';
import { CLIP_TOWER, clipTips } from './scenic/clipTower';
import { GeoBuilder, type P3 } from './scenic/geo';
import { LightCards, type LightCardMesh } from './scenic/lights';
import { createScenicMaterial } from './scenic/material';
import type { SharedUniforms } from './shared';

const HULL_LENGTH = 464;
const SPARKS = 150;
/** nominal duration of the full pass, used only to time the sheared tower tip's fall against progress */
const PASS_SECONDS = 80;

/** Carrier centre along the pass, atrium-local. Six knots = five equal progress spans; knot 4 is the clip. */
const PATH = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-1250, 700, 640),
  new THREE.Vector3(-800, 600, 440),
  new THREE.Vector3(-380, 520, 240),
  new THREE.Vector3(0, 474, 50),
  new THREE.Vector3(CLIP_TOWER.x - 14, CLIP_TOWER.cut + 46, CLIP_TOWER.z + 8),
  new THREE.Vector3(770, 548, -330),
], false, 'catmullrom', 0.5);

const SLAB = [[0, -1], [0.72, -1], [1, -0.35], [1, 0.25], [0.78, 0.8], [0.3, 1]] as const;

function slab(z: number, w: number, h: number, y: number): P3[] {
  const pts: P3[] = [];
  for (const [x, v] of SLAB) pts.push([x * w, y + v * h, z]);
  for (let i = SLAB.length - 1; i >= 0; i--) if (SLAB[i][0] > 1e-6) pts.push([-SLAB[i][0] * w, y + SLAB[i][1] * h, z]);
  return pts;
}

function zPrism(b: GeoBuilder, cx: number, cy: number, z0: number, z1: number, r0: number, r1: number, sides: number): void {
  b.push().translate(cx, cy, z0).rotateX(Math.PI / 2).prism(0, 0, 0, z1 - z0, r0, r1, sides).pop();
}

const JETS: Array<[number, number, number]> = [[-56, -40, -168], [56, -40, -168], [-60, -44, 150], [60, -44, 150], [-34, -44, -20], [34, -44, -20]];
const BREACHES: Array<[number, number, number]> = [[-52, 6, -150], [60, -12, 20], [-30, -38, 96], [20, 38, -60]];

function buildHull(rand: () => number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const HULL = 0x4a5059, DARK = 0x16181c, PALE = 0x8d8f8a, WARM = 0xffd9a0;
  b.paint(HULL, 0, 0.8).loft([slab(230, 58, 34, 0), slab(150, 66, 40, 0), slab(0, 66, 40, 0), slab(-120, 60, 36, -1), slab(-190, 44, 28, -3), slab(-232, 22, 16, -6)]);
  // forked bow (launch slot between two prongs) and heavy aft fins break the slab outline from below
  for (const sx of [-1, 1]) {
    b.paint(HULL, 0, 0.75).box(sx * 15, -6, -252, 13, 20, 52, { top: [0.7, 0.8], shift: [0, -6] });
    b.paint(HULL, 0, 0.7).loft([
      [[sx * 62, -16, 215], [sx * 62, -4, 215], [sx * 62, -4, 105], [sx * 62, -16, 105]],
      [[sx * 128, -12, 228], [sx * 128, -6, 228], [sx * 128, -6, 176], [sx * 128, -12, 176]],
    ]);
    b.paint(DARK).box(sx * 129, -9, 202, 3, 14, 60, { top: [1, 0.8] });
  }
  // flight deck trench + deck-edge kerbs
  b.paint(DARK).box(0, 40.6, 0, 40, 1.4, 300);
  b.paint(PALE, 0, 0.5).box(21, 41.2, 0, 1.4, 2.2, 300).box(-21, 41.2, 0, 1.4, 2.2, 300);
  // island (starboard aft) with masts
  b.paint(HULL, 0, 0.95).box(44, 60, 112, 22, 44, 62, { top: [0.8, 0.86] });
  b.paint(HULL, 0, 1.1).box(45, 92, 118, 14, 24, 34, { top: [0.7, 0.8] });
  b.paint(DARK).box(45, 98, 100.6, 12, 4, 1);
  b.paint(PALE, 0, 0.6).prism(45, 104, 122, 150, 1.6, 0.4, 5).prism(40, 104, 134, 132, 1.0, 0.3, 5);
  // flank hangar blocks; bay doors glow dimly, some are dead
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z = -118 + i * 50;
      b.paint(HULL, 0, 0.7).box(sx * 68, -6, z, 8, 22, 38, { top: [0.8, 0.9] });
      if (rand() < 0.62) b.paint(WARM, 1.6 + rand() * 1.4).box(sx * 72.2, -7, z, 0.5, 7, 22);
    }
    // keel rails + maneuvering pods
    b.paint(DARK).box(sx * 22, -44, 10, 7, 9, 330);
    b.paint(HULL, 0, 0.6).box(sx * 58, -40, -168, 16, 12, 30).box(sx * 60, -43, 150, 18, 12, 34);
  }
  // ventral ribs, centre hangar slot, docking arms
  for (let z = -150; z <= 170; z += 40) b.paint(HULL, 0, 0.55).box(0, -42, z, 46, 5, 6);
  b.paint(WARM, 1.1).box(7, -40.4, 30, 1.6, 0.6, 110).box(-7, -40.4, 30, 1.6, 0.6, 110);
  b.paint(DARK).box(0, -40.2, 30, 12, 0.4, 112);
  b.paint(DARK).box(0, -52, -96, 10, 22, 14, { top: 0.5 }).box(0, -52, 120, 10, 22, 14, { top: 0.5 });
  // engine block; nozzles are cold apart from what the light cards add
  b.paint(HULL, 0, 0.6).box(0, 0, 244, 104, 58, 36, { top: [0.9, 1] });
  for (const [x, y] of [[-34, 10], [0, 14], [34, 10], [-18, -16], [18, -16]] as const) {
    zPrism(b.paint(DARK), x, y, 258, 284, 14, 17, 8);
    zPrism(b.paint(0x2a1408, 0.5), x, y, 282, 285, 13, 13, 8);
  }
  // torn plating around the bow bite and the starboard gash
  for (const [cx, cy, cz, n] of [[-50, 8, -160, 14], [62, -10, 24, 9]] as const) {
    for (let i = 0; i < n; i++) {
      b.push().translate(cx + (rand() - 0.5) * 26, cy + (rand() - 0.5) * 34, cz + (rand() - 0.5) * 60)
        .rotateY(rand() * 6.28).rotateX((rand() - 0.5) * 1.6).rotateZ((rand() - 0.5) * 1.6);
      b.paint(DARK).box(0, 0, 0, 5 + rand() * 16, 0.8, 4 + rand() * 12, { top: [0.5 + rand() * 0.5, 0.4 + rand() * 0.6] });
      b.pop();
    }
  }
  return b.build();
}

function buildLights(rand: () => number, shared: SharedUniforms): LightCardMesh {
  const c = new LightCards();
  const WHITE = 0xdfe8ff, RED = 0xff3020, JET = 0xbfe4ff, EMBER = 0xff7a2a;
  // group 0 — sparse running lights (several dead)
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) if (rand() < 0.6) c.point(sx * 66, 30, -200 + i * 50, 3.2, WHITE, 3.5);
  c.point(45, 151, 122, 4, RED, 6).point(0, -64, -96, 3.5, RED, 5).point(0, -64, 120, 3.5, RED, 5).point(0, -8, -234, 3, WHITE, 4);
  // group 1 — ventral maneuvering jets: core + downward plume (relit by setStabilized)
  for (const [x, y, z] of JETS) {
    c.point(x, y - 6, z, 14, JET, 5.5, 1);
    for (let i = 0; i < 7; i++) c.point(x, y - 12 - i * 8, z, 17 - i * 1.4, JET, 1.9 * Math.pow(0.72, i), 1);
  }
  // group 2 — failing main engines
  for (const [x, y] of [[-34, 10], [34, 10], [18, -16]] as const) c.point(x, y, 288, 30, 0xffb060, 3.2, 2);
  // group 3 — venting embers and gas streaming aft from the breaches
  for (const [bx, by, bz] of BREACHES) {
    for (let i = 0; i < 22; i++) {
      c.point(bx + (rand() - 0.5) * 16, by + (rand() - 0.5) * 12, bz + (rand() - 0.5) * 24, 1.6 + rand() * 2.2, EMBER, 2.5 + rand() * 3, 3)
        .loop((rand() - 0.5) * 9, -3 - rand() * 7, 20 + rand() * 26, 3 + rand() * 4, rand());
    }
    for (let i = 0; i < 5; i++) {
      c.point(bx, by, bz, 20 + rand() * 22, 0x9aa6c0, 0.16 + rand() * 0.12, 3).loop((rand() - 0.5) * 5, -2 - rand() * 3, 14 + rand() * 10, 6 + rand() * 4, rand());
    }
    c.point(bx, by, bz, 34, 0xff5a1e, 1.5, 3);
  }
  return c.build(shared, { name: 'sky:carrierLights', minPx: 1.6 });
}

export interface Carrier extends CarrierActor {
  /** world-space spark pool; parented next to `object` by the sky root */
  readonly sparks: THREE.Object3D;
  /** `keyDir` = unit vector toward the sky's key light (keeps `shadow` current) */
  update(dt: number, keyDir: THREE.Vector3): void;
  dispose(): void;
}

export function createCarrier(shared: SharedUniforms, seed = 7283): Carrier {
  const rand = mulberry32(seed ^ 0xca22);
  const object = new THREE.Group();
  object.name = 'sky:carrier';
  object.visible = false;
  const hullGeo = buildHull(rand);
  const hullMat = createScenicMaterial(shared, { name: 'SkyCarrierHull', panel: [26, 13], gloss: 0.35, breach: 0.85, haze: 0.75, glowReach: 0.5, underLight: [0.30, 0.27, 0.22] });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.name = 'sky:carrierHull';
  const lights = buildLights(rand, shared);
  object.add(hull, lights);

  // spark pool lives in world space (it must not follow the hull after the impact)
  const pool = new LightCards();
  for (let i = 0; i < SPARKS; i++) pool.point(0, 0, 0, 1, 0xffffff, 0);
  const sparks = pool.build(shared, { name: 'sky:carrierSparks', dynamic: true, minPx: 1.5 });
  sparks.frustumCulled = false;
  sparks.visible = false;

  const anchor = new THREE.Vector3();
  let anchorYaw = 0;
  let progress = 0, stabilized = 0, clock = 0, sparksUntil = 0, shadow = 0;
  const position = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1);
  const clipPoint = new THREE.Vector3();
  const clipDirLocal = PATH.getTangent(CLIP_TOWER.progress).normalize();

  const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _e = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);

  const toWorld = (v: THREE.Vector3): THREE.Vector3 => v.applyAxisAngle(UP, anchorYaw).add(anchor);

  const applyPose = (): void => {
    PATH.getPoint(progress, _p);
    PATH.getTangent(progress, _t).normalize();
    const loose = 1 - stabilized;
    _z.copy(_t).negate();
    _x.crossVectors(UP, _z).normalize();
    _y.crossVectors(_z, _x);
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    // unstabilised: nose-down, listing, wandering; steadies as the jets come back
    _e.set(-0.15 * loose, loose * 0.05 * Math.sin(clock * 0.37 + progress * 5), loose * (0.17 * Math.sin(progress * 9 + 1) + 0.045 * Math.sin(clock * 0.6)), 'YXZ');
    _q.multiply(_qa.setFromEuler(_e));
    _qa.setFromAxisAngle(UP, anchorYaw);
    object.quaternion.copy(_qa).multiply(_q);
    object.position.copy(toWorld(_p));
    position.copy(object.position);
    forward.copy(_t).applyAxisAngle(UP, anchorYaw);
    clipPoint.set(CLIP_TOWER.x, CLIP_TOWER.cut, CLIP_TOWER.z);
    toWorld(clipPoint);
    // the sheared tower tip is a pure function of progress (reversible, skip-safe)
    const s = Math.max(0, progress - CLIP_TOWER.progress) * PASS_SECONDS;
    const tips = clipTips();
    for (let i = 0; i < tips.length; i++) {
      const tip = tips[i];
      const home = tip.userData.home as THREE.Vector3 | undefined;
      if (!home) continue;
      tip.position.copy(home).addScaledVector(clipDirLocal, 34 * s);
      tip.position.y -= 4.9 * s * s;
      tip.rotation.set(0.5 * s, 0.2 * s, -0.7 * s);
      tip.visible = s < 9;
    }
  };

  const burst = (): void => {
    const { pos, size, color, motion, phase } = sparks.cards.attrs;
    const r = mulberry32(seed ^ 0x51a9);
    const c = new THREE.Color();
    for (let i = 0; i < SPARKS; i++) {
      const kind = i < 4 ? 2 : i < 24 ? 1 : 0; // contact flashes, dust puffs, sparks
      const spread = kind === 0 ? 1 : 0.35;
      _p.set((r() - 0.5) * 14, (r() - 0.5) * 8, (r() - 0.5) * 14).add(clipPoint);
      _t.copy(forward).multiplyScalar(kind === 0 ? 24 + r() * 60 : 10 + r() * 16);
      _t.x += (r() - 0.5) * 60 * spread; _t.y += (r() - 0.2) * 44 * spread; _t.z += (r() - 0.5) * 60 * spread;
      const life = kind === 2 ? 0.5 + r() * 0.3 : kind === 1 ? 4 + r() * 3 : 1.4 + r() * 2.6;
      const s = kind === 2 ? 50 + r() * 30 : kind === 1 ? 24 + r() * 26 : 2 + r() * 3.2;
      if (kind === 2) c.setRGB(1, 0.78, 0.5).multiplyScalar(11);
      else if (kind === 1) c.setRGB(0.5, 0.48, 0.46).multiplyScalar(0.45);
      else c.setRGB(1, 0.5 + r() * 0.35, 0.14).multiplyScalar(8 + r() * 9);
      pos.setXYZ(i, _p.x, _p.y, _p.z);
      size.setXYZW(i, s, s, 0, 0);
      color.setXYZ(i, c.r, c.g, c.b);
      motion.setXYZW(i, kind === 2 ? 0 : _t.x, kind === 2 ? 0 : _t.y, kind === 2 ? 0 : _t.z, -life);
      phase.setXY(i, clock + (kind === 0 ? r() * 0.5 : 0), kind === 0 ? 1 : kind === 1 ? 0.06 : 0);
    }
    for (const a of [pos, size, color, motion, phase]) a.needsUpdate = true;
    sparks.visible = object.visible;
    sparksUntil = clock + 8;
  };

  // 0..1: how much of the light arriving along `towardLight` at the atrium centre the hull blocks
  const occlusionAlong = (towardLight: THREE.Vector3): number => {
    _p.copy(position).sub(anchor);
    const along = _p.dot(towardLight);
    if (along <= 0) return 0;
    _t.copy(towardLight).multiplyScalar(along).sub(_p); // hull centre → closest point of the light ray
    const lon = Math.abs(_t.dot(forward));
    _x.copy(_t).addScaledVector(forward, -_t.dot(forward));
    return clamp01(clamp01(1.25 - lon / (HULL_LENGTH * 0.5)) * clamp01(1.5 - _x.length() / 80) * 1.6);
  };

  const api: Carrier = {
    object,
    sparks,
    position,
    forward,
    clipPoint,
    length: HULL_LENGTH,
    get visible() { return object.visible; },
    set visible(v: boolean) {
      object.visible = !!v;
      if (!v) sparks.visible = false;
    },
    get progress() { return progress; },
    get stabilized() { return stabilized; },
    get shadow() { return shadow; },
    setProgress(t: number) {
      const next = Number.isFinite(t) ? clamp01(t) : progress;
      const crossed = progress < CLIP_TOWER.progress && next >= CLIP_TOWER.progress && next - progress < 0.25;
      progress = next;
      applyPose();
      if (crossed && object.visible) burst();
    },
    setStabilized(n: number) {
      stabilized = Number.isFinite(n) ? clamp01(n) : stabilized;
      applyPose();
    },
    setAnchor(origin: Vec3Like, yaw = 0) {
      anchor.set(origin.x, origin.y, origin.z);
      anchorYaw = Number.isFinite(yaw) ? yaw : 0;
      applyPose();
    },
    update(dt: number, keyDir: THREE.Vector3) {
      clock += dt;
      if (!object.visible) { shadow = 0; return; }
      const g = lights.cards.uniforms.uGroupGain.value;
      // jets: off → sputter → steady as stabilisation rises
      const sputter = stabilized < 0.98 ? 0.75 + 0.25 * Math.sin(clock * 23) * Math.sin(clock * 7.3) : 1;
      g.y = Math.pow(stabilized, 1.4) * sputter;
      g.z = (0.22 + 0.18 * Math.sin(clock * 5.1) * Math.sin(clock * 1.7)) * (1 - 0.5 * stabilized) + 0.5 * stabilized;
      g.w = 1 - 0.55 * stabilized;
      sparks.cards.uniforms.uClock.value = clock;
      if (sparks.visible && clock > sparksUntil) sparks.visible = false;
      if (stabilized < 1) applyPose();
      shadow = occlusionAlong(keyDir);
    },
    dispose() {
      hullGeo.dispose(); hullMat.dispose();
      lights.geometry.dispose(); lights.material.dispose();
      sparks.geometry.dispose(); sparks.material.dispose();
      object.removeFromParent(); sparks.removeFromParent();
    },
  };
  applyPose();
  return api;
}
