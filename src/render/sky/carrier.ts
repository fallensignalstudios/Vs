/**
 * The damaged carrier (Z05): a ≈ 460 m slab-hulled ship on an authored pass above the atrium ceiling. Progress is
 * fully driven by the zone script (`setProgress`), so a cinematic skip lands in exactly the same state.
 *
 * THE CLIP. The pass is staged so that the ventral bow ram — the lowest point of the hull — FIRST touches the
 * scenic tower's needle at progress 0.8: nothing intersects the tower before that, the ram shears the needle
 * off at its collar, and the rest of the hull rides clear above the stump. Contact = a flash that lights the
 * hull and tower, a burst of velocity-stretched sparks, tumbling masonry, a dust column that lingers, and a
 * scrape of sparks for as long as the ram is over the stump. The sheared needle and the debris fall on the
 * sim clock (`dt`), so they keep falling if the script holds progress; a skip / load past the clip lands with
 * the needle simply gone.
 *
 * Draw calls: hull, light cards, spark pool, debris chunks (the last two only around the clip).
 */
import * as THREE from 'three';
import type { CarrierActor, Vec3Like } from '@/core/api';
import { DEG, clamp01, mulberry32, smoothstep } from '@/core/mathx';
import { BOW_Z, HULL_HALF_BEAM, HULL_LENGTH, RAM_BOTTOM, buildCarrierHull, buildCarrierLights, type HullBox } from './carrierHull';
import { CLIP_TOWER, type ClipTipSlot } from './scenic/clipTower';
import { KING } from './scenic/arch';
import { GeoBuilder } from './scenic/geo';
import { LightCards } from './scenic/lights';
import { createScenicMaterial } from './scenic/material';
import type { SharedUniforms } from './shared';

const CLIP = CLIP_TOWER.progress;
/** the stabilised ram clears the collar by this much (the unstabilised bow hangs ≈ 16 m lower and still clears) */
const RAM_CLEAR = 22;
/** nose-down pitch of the unstabilised hull, radians */
const LOOSE_PITCH = 0.06;
/** progress span during which the ram is still over the stump (sparks scrape) */
const SCRAPE_SPAN = 0.022;
const N_FLASH = 6, N_DUST = 60, N_SPARK = 340;
const POOL = N_FLASH + N_DUST + N_SPARK;
const N_CHUNKS = 18;
const GRAVITY = 9.8;

/** Travel direction of the pass (atrium-local): mostly east, a little north. */
const COURSE = 25.5 * DEG;
const DIR = new THREE.Vector3(Math.cos(COURSE), 0, -Math.sin(COURSE));
const SIDE = new THREE.Vector3(Math.sin(COURSE), 0, Math.cos(COURSE));
/** hull centre at the instant of first contact: the bow ram's face is at the tower's needle */
const AT_CLIP = new THREE.Vector3(CLIP_TOWER.x, CLIP_TOWER.cut + RAM_CLEAR - RAM_BOTTOM, CLIP_TOWER.z).addScaledVector(DIR, BOW_Z - 3);
const knot = (along: number, side: number, y: number): THREE.Vector3 =>
  new THREE.Vector3().copy(AT_CLIP).addScaledVector(DIR, along).addScaledVector(SIDE, side).setY(y);
/**
 * Carrier centre along the pass. Six knots = five equal progress spans; knot 4 (progress 0.8) is first contact.
 * Knots 3 and 5 are collinear with it and level, so the hull meets the tower flying straight and level, at the
 * lowest point of the whole pass.
 */
const PATH = new THREE.CatmullRomCurve3([
  knot(-2080, 220, 720), knot(-1560, 110, 636), knot(-1040, 40, 558), knot(-520, 0, AT_CLIP.y + 22), AT_CLIP.clone(), knot(760, 0, AT_CLIP.y + 22),
], false, 'catmullrom', 0.5);

export interface Carrier extends CarrierActor {
  /** world-space effects (sparks, debris); parented next to `object` by the sky root */
  readonly effects: THREE.Object3D;
  /** conservative local-space boxes covering the hull (staging tests) */
  readonly hullProxy: readonly HullBox[];
  /** `keyDir` = unit vector toward the sky's key light (keeps `shadow` current) */
  update(dt: number, keyDir: THREE.Vector3, reduceFlash: boolean): void;
  /** hide, rewind to progress 0 / stabilised 0, restore the tower tip, clear effects */
  reset(): void;
  dispose(): void;
}

let warnedAnchor = false;

export function createCarrier(shared: SharedUniforms, seed: number, tips: ClipTipSlot): Carrier {
  const rand = mulberry32(seed ^ 0xca22);
  const object = new THREE.Group();
  object.name = 'sky:carrier';
  object.visible = false;
  const built = buildCarrierHull(rand);
  const hullMat = createScenicMaterial(shared, {
    name: 'SkyCarrierHull', panel: [22, 11], panelTone: 0.3, panelSeam: 0.5, gloss: 0.3, breach: 0.85, haze: 0.75, glowReach: 0.5,
    underLight: [0.46, 0.40, 0.31], battleRim: 1,
  });
  const hull = new THREE.Mesh(built.geometry, hullMat);
  hull.name = 'sky:carrierHull';
  const lights = buildCarrierLights(rand, shared);
  object.add(hull, lights);

  // ---- world-space effects: they must not follow the hull after the impact
  const effects = new THREE.Group();
  effects.name = 'sky:carrierFx';
  const pool = new LightCards();
  for (let i = 0; i < POOL; i++) pool.point(0, 0, 0, 1, 0xffffff, 0);
  const sparks = pool.build(shared, { name: 'sky:carrierSparks', dynamic: true, minPx: 1.5, haze: 0.75 });
  sparks.frustumCulled = false;
  sparks.visible = false;
  const chunkGeo = new GeoBuilder().paint(KING.whiteGold, 0, 0.62).bevelBox(0, 0, 0, 1, 1, 1, 0.14).build();
  const chunkMat = createScenicMaterial(shared, { name: 'SkyCarrierDebris', gloss: 0.3, haze: 0.75 });
  const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, N_CHUNKS);
  chunks.name = 'sky:carrierDebris';
  chunks.frustumCulled = false;
  chunks.visible = false;
  effects.add(sparks, chunks);

  const anchor = new THREE.Vector3();
  let anchorYaw = 0;
  let progress = 0, stabilized = 0, clock = 0, shadow = 0;
  const position = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1);
  const clipPoint = new THREE.Vector3();
  const footprint = { center: new THREE.Vector3(), axis: new THREE.Vector3(1, 0, 0), halfLength: 0, halfWidth: 0 };

  // ---- clip state: 0 = needle intact, 1 = sheared and falling (sim clock), 2 = long gone
  let tipState: 0 | 1 | 2 = 0;
  let clipAge = -1; // seconds since a PLAYED clip; < 0 = no live effects
  let scrapeMark = 0, sparkCursor = 0, dustCursor = 0, dustDue = 0, soft = false;
  const tipPos = new THREE.Vector3(), tipVel = new THREE.Vector3(), tipRot = new THREE.Vector3(), tipSpin = new THREE.Vector3();
  const cPos = new Float32Array(N_CHUNKS * 3), cVel = new Float32Array(N_CHUNKS * 3), cRot = new Float32Array(N_CHUNKS * 3);
  const cSpin = new Float32Array(N_CHUNKS * 3), cSize = new Float32Array(N_CHUNKS * 3);
  const fxRand = mulberry32(seed ^ 0x51a9);

  const _p = new THREE.Vector3(), _a = new THREE.Vector3(), _t = new THREE.Vector3();
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _s = new THREE.Vector3();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _e = new THREE.Euler();
  const _c = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);

  const toWorld = (v: THREE.Vector3): THREE.Vector3 => v.applyAxisAngle(UP, anchorYaw).add(anchor);
  /** unit path tangent without allocating (Curve.getTangent creates two vectors per call) */
  const tangentAt = (t: number, out: THREE.Vector3): THREE.Vector3 => {
    PATH.getPoint(Math.max(0, t - 1e-3), _a);
    PATH.getPoint(Math.min(1, t + 1e-3), out);
    return out.sub(_a).normalize();
  };

  const applyPose = (): void => {
    PATH.getPoint(progress, _p);
    tangentAt(progress, _t);
    const loose = 1 - stabilized;
    _z.copy(_t).negate();
    _x.crossVectors(UP, _z).normalize();
    _y.crossVectors(_z, _x);
    _m.makeBasis(_x, _y, _z);
    _q.setFromRotationMatrix(_m);
    // unstabilised: nose-down, listing, wandering; steadies as the jets come back
    _e.set(-LOOSE_PITCH * loose, loose * 0.03 * Math.sin(clock * 0.37 + progress * 5), loose * (0.15 * Math.sin(progress * 9 + 1) + 0.04 * Math.sin(clock * 0.6)), 'YXZ');
    _q.multiply(_qa.setFromEuler(_e));
    _qa.setFromAxisAngle(UP, anchorYaw);
    object.quaternion.copy(_qa).multiply(_q);
    object.position.copy(toWorld(_p));
    position.copy(object.position);
    forward.copy(_t).applyAxisAngle(UP, anchorYaw);
    clipPoint.set(CLIP_TOWER.x, CLIP_TOWER.cut, CLIP_TOWER.z);
    toWorld(clipPoint);
  };

  /** keep the registered needle (the most recent shell's) in step with the clip state */
  const syncTip = (): void => {
    const tip = tips.tip;
    if (!tip) return;
    if (tipState === 0) {
      tip.visible = true;
      tip.position.set(tips.home.x, tips.home.y, tips.home.z);
      tip.rotation.set(0, 0, 0);
    } else if (tipState === 1) {
      tip.visible = true;
      tip.position.copy(tipPos);
      tip.rotation.set(tipRot.x, tipRot.y, tipRot.z);
    } else {
      tip.visible = false;
    }
  };

  const clearEffects = (): void => {
    clipAge = -1;
    sparks.visible = false;
    chunks.visible = false;
    shared.uFlashColor.value.setRGB(0, 0, 0);
  };

  const { pos, size, color, motion, phase, fx } = sparks.cards.attrs;
  /** (re)start one pooled card; kind 0 = glow, 2 = velocity streak */
  const emit = (slot: number, kind: number, at: THREE.Vector3, vel: THREE.Vector3, life: number, w: number, h: number, c: THREE.Color, gravity: number, drag: number, grow: number, attack: number, delay: number): void => {
    pos.setXYZ(slot, at.x, at.y, at.z);
    size.setXYZW(slot, w, h, 0, kind);
    color.setXYZ(slot, c.r, c.g, c.b);
    motion.setXYZW(slot, vel.x, vel.y, vel.z, -life);
    phase.setXY(slot, clock + delay, gravity);
    fx.setXYZ(slot, grow, drag, attack);
  };
  const flush = (): void => {
    pos.needsUpdate = size.needsUpdate = color.needsUpdate = motion.needsUpdate = phase.needsUpdate = fx.needsUpdate = true;
  };
  const spark = (r: () => number, speed: number, spread: number): void => {
    const slot = N_FLASH + N_DUST + (sparkCursor++ % N_SPARK);
    _p.set((r() - 0.5) * 10, r() * 16, (r() - 0.5) * 10).add(clipPoint);
    _t.copy(forward).multiplyScalar(speed * (0.35 + r() * 0.9));
    _t.x += (r() - 0.5) * spread; _t.y += (r() - 0.35) * spread * 0.8; _t.z += (r() - 0.5) * spread;
    _c.setRGB(1, 0.46 + r() * 0.36, 0.12 + r() * 0.1).multiplyScalar((soft ? 3 : 9) + r() * (soft ? 2 : 9));
    emit(slot, 2, _p, _t, 1.6 + r() * 3.2, 1.3 + r() * 1.5, 1.3, _c, 1, 0.35, 0, 0, r() * 0.12);
  };
  const dust = (r: () => number, delay: number): void => {
    const slot = N_FLASH + (dustCursor++ % N_DUST);
    _p.set((r() - 0.5) * 20, (r() - 0.3) * 26, (r() - 0.5) * 20).add(clipPoint);
    _t.copy(forward).multiplyScalar(6 + r() * 22);
    _t.x += (r() - 0.5) * 14; _t.y += (r() - 0.6) * 10; _t.z += (r() - 0.5) * 14;
    _c.setRGB(0.62, 0.58, 0.52).multiplyScalar(0.20 + r() * 0.16);
    emit(slot, 0, _p, _t, 10 + r() * 7, 22 + r() * 22, 22 + r() * 22, _c, 0.06, 0.45, 2.6, 0.5, delay);
  };

  /** the played clip: needle sheared, flash, sparks, masonry, dust */
  const startClip = (): void => {
    tipState = 1;
    clipAge = 0;
    scrapeMark = progress;
    dustDue = 0.15;
    tangentAt(CLIP, _s); // shell-local travel direction (the tip lives in the shell's frame)
    tipPos.set(tips.home.x, tips.home.y, tips.home.z);
    tipVel.copy(_s).multiplyScalar(17).add(_a.set(SIDE.x * 5, 3.5, SIDE.z * 5));
    tipRot.set(0, 0, 0);
    // topple forward, away from the hull: rotate about the horizontal axis square to the travel direction
    tipSpin.set(-_s.z * 0.42, 0.12, _s.x * 0.42);
    const r = fxRand;
    for (let i = 0; i < N_FLASH; i++) {
      _p.set((r() - 0.5) * 12, 8 + r() * 14, (r() - 0.5) * 12).add(clipPoint);
      _c.setRGB(1, 0.80, 0.52).multiplyScalar(soft ? 2.4 : 10);
      const s = (i === 0 ? 84 : 36 + r() * 30) * (soft ? 0.8 : 1);
      emit(i, 0, _p, _t.set(0, 0, 0), soft ? 1.6 : 0.55 + r() * 0.3, s, s, _c, 0, 0, 0.4, soft ? 0.25 : 0, 0);
    }
    for (let i = 0; i < 26; i++) dust(r, r() * 0.4);
    for (let i = 0; i < 230; i++) spark(r, 62, 58);
    for (let i = 0; i < N_CHUNKS; i++) {
      const o = i * 3;
      cPos[o] = clipPoint.x + (r() - 0.5) * 12; cPos[o + 1] = clipPoint.y + r() * 20; cPos[o + 2] = clipPoint.z + (r() - 0.5) * 12;
      const sp = 10 + r() * 26;
      cVel[o] = forward.x * sp + (r() - 0.5) * 22; cVel[o + 1] = (r() - 0.25) * 20; cVel[o + 2] = forward.z * sp + (r() - 0.5) * 22;
      cRot[o] = r() * 6; cRot[o + 1] = r() * 6; cRot[o + 2] = r() * 6;
      cSpin[o] = (r() - 0.5) * 3; cSpin[o + 1] = (r() - 0.5) * 3; cSpin[o + 2] = (r() - 0.5) * 3;
      const s = 2.2 + r() * r() * 9;
      cSize[o] = s * (0.6 + r() * 0.8); cSize[o + 1] = s * (0.5 + r() * 1.2); cSize[o + 2] = s * (0.6 + r() * 0.8);
    }
    flush();
    sparks.visible = true;
    chunks.visible = true;
    api.onClip?.(clipPoint);
  };

  const stepEffects = (dt: number): void => {
    if (tipState === 1) {
      tipVel.y -= GRAVITY * dt;
      tipPos.addScaledVector(tipVel, dt);
      tipRot.addScaledVector(tipSpin, dt);
      if (tipPos.y < tips.home.y - 640) tipState = 2;
    }
    if (clipAge < 0) return;
    clipAge += dt;
    // flash light on the hull and the tower
    const env = soft
      ? smoothstep(0, 0.25, clipAge) * Math.exp(-Math.max(clipAge - 0.25, 0) / 0.9) * 2.2
      : Math.exp(-clipAge / 0.32) * 13 + Math.exp(-clipAge / 1.6) * 1.4;
    shared.uFlashColor.value.setRGB(1, 0.72, 0.42).multiplyScalar(env);
    shared.uFlashPos.value.copy(clipPoint).y += 14;
    let wrote = false;
    // scrape: sparks for as long as the ram is still dragging over the stump and the hull is moving
    if (progress !== scrapeMark && progress < CLIP + SCRAPE_SPAN && progress >= CLIP) {
      scrapeMark = progress;
      for (let i = 0; i < 7; i++) spark(fxRand, 44, 26);
      wrote = true;
    }
    // the dust column keeps feeding for a few seconds
    if (clipAge < 5 && clipAge >= dustDue) {
      dustDue = clipAge + 0.16;
      dust(fxRand, 0);
      wrote = true;
    }
    if (wrote) flush();
    // tumbling masonry
    let alive = false;
    for (let i = 0; i < N_CHUNKS; i++) {
      const o = i * 3;
      cVel[o + 1] -= GRAVITY * dt;
      cPos[o] += cVel[o] * dt; cPos[o + 1] += cVel[o + 1] * dt; cPos[o + 2] += cVel[o + 2] * dt;
      cRot[o] += cSpin[o] * dt; cRot[o + 1] += cSpin[o + 1] * dt; cRot[o + 2] += cSpin[o + 2] * dt;
      const gone = cPos[o + 1] < clipPoint.y - 600;
      alive = alive || !gone;
      _e.set(cRot[o], cRot[o + 1], cRot[o + 2], 'XYZ');
      _m.makeRotationFromEuler(_e);
      _m.scale(_s.set(gone ? 0 : cSize[o], gone ? 0 : cSize[o + 1], gone ? 0 : cSize[o + 2]));
      _m.setPosition(cPos[o], cPos[o + 1], cPos[o + 2]);
      chunks.setMatrixAt(i, _m);
    }
    chunks.instanceMatrix.needsUpdate = true;
    chunks.visible = alive && object.visible;
    if (clipAge > 24) clearEffects();
  };

  /** hull footprint on the atrium floor along the key light, and how much of it covers the atrium centre */
  const updateShadow = (keyDir: THREE.Vector3): void => {
    const ky = Math.max(keyDir.y, 0.05);
    const hgt = position.y - anchor.y;
    footprint.center.copy(position).addScaledVector(keyDir, -hgt / ky);
    footprint.center.y = anchor.y;
    _z.set(0, 0, -1).applyQuaternion(object.quaternion);
    _z.addScaledVector(keyDir, -_z.y / ky);
    _z.y = 0;
    const fl = _z.length();
    footprint.halfLength = (HULL_LENGTH / 2) * fl;
    if (fl > 1e-6) footprint.axis.copy(_z).multiplyScalar(1 / fl);
    _x.set(1, 0, 0).applyQuaternion(object.quaternion);
    _x.addScaledVector(keyDir, -_x.y / ky);
    _x.y = 0;
    // width measured square to the projected axis
    const across = Math.abs(_x.x * footprint.axis.z - _x.z * footprint.axis.x);
    footprint.halfWidth = HULL_HALF_BEAM * across;
    _p.copy(anchor).sub(footprint.center);
    const u = Math.abs(_p.x * footprint.axis.x + _p.z * footprint.axis.z) / Math.max(footprint.halfLength, 1);
    const v = Math.abs(_p.x * footprint.axis.z - _p.z * footprint.axis.x) / Math.max(footprint.halfWidth, 1);
    const s = hgt > 0 ? (1 - smoothstep(0.8, 1.2, u)) * (1 - smoothstep(0.8, 1.6, v)) : 0;
    shadow = Number.isFinite(s) ? clamp01(s) : 0;
  };

  const api: Carrier = {
    object,
    effects,
    position,
    forward,
    clipPoint,
    hullProxy: built.proxy,
    length: HULL_LENGTH,
    clipProgress: CLIP,
    shadowFootprint: footprint,
    onClip: null,
    get visible() { return object.visible; },
    set visible(v: boolean) {
      object.visible = !!v;
      if (!v) clearEffects();
    },
    get progress() { return progress; },
    get stabilized() { return stabilized; },
    get shadow() { return shadow; },
    setProgress(t: number) {
      const prev = progress;
      const next = Number.isFinite(t) ? clamp01(t) : progress;
      progress = next;
      applyPose();
      if (prev < CLIP && next >= CLIP) {
        // a played crossing shears the needle now; a skip / load past it lands with the needle already gone
        if (object.visible && next - prev <= 0.05) startClip();
        else { tipState = 2; clearEffects(); }
      } else if (next < CLIP && prev >= CLIP) {
        tipState = 0;
        clearEffects();
      }
      syncTip();
    },
    setStabilized(n: number) {
      stabilized = Number.isFinite(n) ? clamp01(n) : stabilized;
      applyPose();
    },
    setAnchor(origin: Vec3Like, yaw = 0) {
      const ok = !!origin && Number.isFinite(origin.x) && Number.isFinite(origin.y) && Number.isFinite(origin.z);
      if (!ok) {
        if (!warnedAnchor) { warnedAnchor = true; console.warn('[sky] carrier.setAnchor: origin must have finite x, y, z — keeping the previous anchor'); }
      } else {
        anchor.set(origin.x, origin.y, origin.z);
      }
      if (Number.isFinite(yaw)) anchorYaw = yaw;
      applyPose();
    },
    update(dt: number, keyDir: THREE.Vector3, reduceFlash: boolean) {
      clock += dt;
      soft = reduceFlash;
      sparks.cards.uniforms.uClock.value = clock;
      stepEffects(dt);
      syncTip();
      if (!object.visible) { shadow = 0; footprint.halfLength = 0; footprint.halfWidth = 0; return; }
      const g = lights.cards.uniforms.uGroupGain.value;
      // jets: off → sputter → steady as stabilisation rises (a smooth ramp when flashes are reduced)
      const sputter = !soft && stabilized < 0.98 ? 0.75 + 0.25 * Math.sin(clock * 23) * Math.sin(clock * 7.3) : 1;
      g.y = Math.pow(stabilized, 1.4) * sputter;
      const flick = soft ? 0.08 * Math.sin(clock * 3.1) : 0.18 * Math.sin(clock * 5.1) * Math.sin(clock * 1.7);
      g.z = (0.22 + flick) * (1 - 0.5 * stabilized) + 0.5 * stabilized;
      g.w = 1 - 0.55 * stabilized;
      if (stabilized < 1) applyPose();
      updateShadow(keyDir);
    },
    reset() {
      object.visible = false;
      progress = 0;
      stabilized = 0;
      tipState = 0;
      shadow = 0;
      clearEffects();
      applyPose();
      syncTip();
    },
    dispose() {
      built.geometry.dispose(); hullMat.dispose();
      lights.geometry.dispose(); lights.material.dispose();
      sparks.geometry.dispose(); sparks.material.dispose();
      chunkGeo.dispose(); chunkMat.dispose(); chunks.dispose();
      shared.uFlashColor.value.setRGB(0, 0, 0);
      object.removeFromParent(); effects.removeFromParent();
    },
  };
  applyPose();
  return api;
}
