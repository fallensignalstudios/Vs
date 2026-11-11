/**
 * Z10 — the Witness V set: a King-era bridge remembered in white-gold, the whole blue-white star beyond its
 * forward glass, the sundering (two unequal remnants and the Wound between them), the King and his chronicler,
 * and the white-gold portal of the King's own age that opens on the bridge (the author's ruling 6).
 *
 * The set is built hidden around the dais (the protagonists stand at the dais front, unseen; the two historical
 * figures are visuals only). While the Witness plays every other object of the zone is hidden, so "the chamber
 * disappears". Everything animates from targets in `W` on the sim clock and snaps on a skip.
 */
import * as THREE from 'three';
import type { HumanoidVisual, ZoneBuilder, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api/chars';
import { C, DAIS_H } from './state';

/** the bridge floor height (the dais top, where the two watchers stand) */
const FLOOR = DAIS_H;
/** star: bearing from the dais, distance and radius */
const STAR = { dist: 1800, radius: 470, el: 13 } as const;

export interface Figure {
  visual: HumanoidVisual | null;
  /** plan target the figure walks to; null = stand */
  target: THREE.Vector3 | null;
  speed: number;
  yaw: number;
}

export interface WitnessSet {
  group: THREE.Group;
  star: THREE.Mesh;
  halo: THREE.Mesh;
  red: THREE.Mesh;
  white: THREE.Mesh;
  wound: THREE.Mesh;
  portal: THREE.Group;
  portalInner: THREE.Mesh;
  blade: THREE.Mesh;
  king: Figure;
  vesryn: Figure;
  /** targets (0..1) and their eased values */
  tgt: { star: number; sunder: number; wound: number; portal: number; blade: number };
  cur: { star: number; sunder: number; wound: number; portal: number; blade: number };
  owned: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture>;
}

const P = (b: ZoneBuilder, dx: number, dn: number, h = FLOOR): THREE.Vector3 => b.P(C.x + dx, C.n + dn, h);

/** a direction from the dais toward a sky point: azimuth (0 = north, + = east) and elevation, degrees */
function skyDir(azDeg: number, elDeg: number): THREE.Vector3 {
  const a = (azDeg * Math.PI) / 180;
  const e = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grd = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

export function buildWitnessSet(b: ZoneBuilder): WitnessSet {
  const game = b.game;
  const mats = game.mats;
  const owned: WitnessSet['owned'] = [];
  const own = <T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T): T => {
    owned.push(x);
    return x;
  };
  const group = new THREE.Group();
  group.name = 'z10-witness';
  group.visible = false;

  // --- the bridge: a white-gold floor with gold rings, the forward glass as a curved colonnade of frames ---
  const floor = new THREE.Mesh(own(new THREE.CircleGeometry(15, 64)), mats.get('whiteGoldFloor'));
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(P(b, 0, 2, FLOOR + 0.012));
  group.add(floor);
  const goldLine = mats.emissive(0xffd79a, 2.6);
  for (const r of [4.5, 9, 13.5]) {
    const ring = new THREE.Mesh(own(new THREE.RingGeometry(r - 0.04, r + 0.04, 96)), goldLine);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(P(b, 0, 2, FLOOR + 0.02));
    group.add(ring);
  }
  const frameMat = mats.get('whiteGold');
  const trim = mats.get('goldTrim');
  const post = own(new THREE.BoxGeometry(0.55, 15, 0.7));
  const beam = own(new THREE.BoxGeometry(1, 0.6, 0.8));
  const seam = own(new THREE.BoxGeometry(0.06, 13, 0.06));
  const seamMat = mats.emissive(0xffe2a8, 3);
  const glassR = 13;
  const posts: THREE.Vector3[] = [];
  for (let i = -4; i <= 4; i++) {
    const a = (i * 13 * Math.PI) / 180;
    const p = P(b, Math.sin(a) * glassR, 2 + Math.cos(a) * glassR, FLOOR + 7.5);
    posts.push(p);
    const m = new THREE.Mesh(post, frameMat);
    m.position.copy(p);
    m.rotation.y = -a;
    group.add(m);
    const s = new THREE.Mesh(seam, seamMat);
    s.position.copy(p).add(new THREE.Vector3(Math.sin(a) * -0.4, 0, Math.cos(a) * 0.4));
    s.rotation.y = -a;
    group.add(s);
  }
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i];
    const c = posts[i + 1];
    const m = new THREE.Mesh(beam, trim);
    m.position.copy(a).lerp(c, 0.5).setY(FLOOR + 14.8);
    m.scale.x = a.distanceTo(c);
    m.rotation.y = Math.atan2(-(c.z - a.z), c.x - a.x);
    group.add(m);
    const sill = new THREE.Mesh(beam, frameMat);
    sill.position.copy(a).lerp(c, 0.5).setY(FLOOR + 0.5);
    sill.scale.set(a.distanceTo(c), 1.6, 1);
    sill.rotation.y = m.rotation.y;
    group.add(sill);
  }
  // consoles of the bridge crew (empty: the officers and the engineer are voices) — a stepped plinth, a slanted
  // reading slab with a gold edge and a lit face, so they read as consoles rather than blocks
  const plinth = own(new THREE.BoxGeometry(1.7, 0.86, 0.5));
  const foot = own(new THREE.BoxGeometry(2.1, 0.12, 0.8));
  const slab = own(new THREE.BoxGeometry(2.2, 0.1, 0.78));
  const lip = own(new THREE.BoxGeometry(2.24, 0.03, 0.03));
  const face = own(new THREE.PlaneGeometry(1.9, 0.5));
  const faceMat = mats.emissive(0xffe6b8, 1.8);
  const tilt = -0.36;
  for (const [dx, dn, yaw] of [[-7, 5, 0.6], [7, 5, -0.6], [-9.5, 0, 1.2], [9.5, 0, -1.2]] as const) {
    const g = new THREE.Group();
    g.position.copy(P(b, dx, dn, FLOOR));
    g.rotation.y = yaw;
    const f = new THREE.Mesh(foot, frameMat);
    f.position.y = 0.06;
    const p = new THREE.Mesh(plinth, frameMat);
    p.position.y = 0.55;
    const top = new THREE.Group();
    top.position.set(0, 1.0, 0);
    top.rotation.x = tilt;
    const sl = new THREE.Mesh(slab, frameMat);
    const e = new THREE.Mesh(lip, trim);
    e.position.set(0, 0.03, 0.39);
    const lit = new THREE.Mesh(face, faceMat);
    lit.rotation.x = -Math.PI / 2;
    lit.position.y = 0.052;
    top.add(sl, e, lit);
    g.add(f, p, top);
    group.add(g);
  }

  // --- the star, its halo, the two remnants and the Wound (far beyond the glass; they ignore fog) ---
  const eye = P(b, 0, -4, FLOOR + 1.6);
  const dir = skyDir(0, STAR.el);
  const starMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.62, 0.8, 1.0).multiplyScalar(3.4), fog: false }));
  const star = new THREE.Mesh(own(new THREE.SphereGeometry(STAR.radius, 48, 32)), starMat);
  star.position.copy(eye).addScaledVector(dir, STAR.dist);
  star.frustumCulled = false;
  group.add(star);
  const haloMat = own(new THREE.MeshBasicMaterial({ map: own(glowTexture()), color: new THREE.Color(0.7, 0.86, 1).multiplyScalar(1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  const halo = new THREE.Mesh(own(new THREE.PlaneGeometry(STAR.radius * 5.2, STAR.radius * 5.2)), haloMat);
  halo.position.copy(star.position).addScaledVector(dir, -STAR.radius * 1.2);
  halo.lookAt(eye);
  halo.frustumCulled = false;
  group.add(halo);
  const half = own(new THREE.SphereGeometry(STAR.radius, 40, 28, 0, Math.PI));
  const redMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.62, 0.8, 1.0).multiplyScalar(3.4), fog: false, side: THREE.DoubleSide }));
  const whiteMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.62, 0.8, 1.0).multiplyScalar(3.4), fog: false, side: THREE.DoubleSide }));
  // the sphere segment phi 0…π is the +Z half: turned a quarter either way it becomes the west / east half
  const red = new THREE.Mesh(half, redMat);
  red.rotation.y = -Math.PI / 2;
  const white = new THREE.Mesh(half, whiteMat);
  white.rotation.y = Math.PI / 2;
  for (const m of [red, white]) {
    m.position.copy(star.position);
    m.visible = false;
    m.frustumCulled = false;
    group.add(m);
  }
  const wound = new THREE.Mesh(own(new THREE.CircleGeometry(1, 64)), own(new THREE.MeshBasicMaterial({ color: 0x000000, fog: false })));
  wound.position.copy(eye).addScaledVector(skyDir(0, 12), STAR.dist * 0.92);
  wound.lookAt(eye);
  wound.scale.setScalar(0.001);
  wound.visible = false;
  wound.frustumCulled = false;
  group.add(wound);

  // --- the portal: a standing doorway of white-gold light on the bridge, giving straight onto the dark ---
  const portal = new THREE.Group();
  portal.position.copy(P(b, 3.4, 9.2));
  portal.rotation.y = Math.PI * 0.06;
  const pw = 2.6;
  const ph = 4.6;
  const edge = mats.emissive(0xfff1d2, 5);
  const jamb = own(new THREE.BoxGeometry(0.12, ph, 0.12));
  for (const sx of [-1, 1]) {
    const j = new THREE.Mesh(jamb, edge);
    j.position.set((sx * pw) / 2, ph / 2, 0);
    portal.add(j);
  }
  const lintel = new THREE.Mesh(own(new THREE.BoxGeometry(pw + 0.12, 0.12, 0.12)), edge);
  lintel.position.set(0, ph, 0);
  portal.add(lintel);
  const portalInner = new THREE.Mesh(own(new THREE.PlaneGeometry(pw, ph)), own(new THREE.MeshBasicMaterial({ color: 0x010103, fog: false })));
  portalInner.position.set(0, ph / 2, -0.02);
  portal.add(portalInner);
  const sheen = new THREE.Mesh(own(new THREE.PlaneGeometry(pw * 1.9, ph * 1.4)), own(new THREE.MeshBasicMaterial({ map: own(glowTexture()), color: new THREE.Color(1, 0.86, 0.6).multiplyScalar(1.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  // the glow sits behind the opening: the dark panel hides its middle, so only the frame's halo shows
  sheen.position.set(0, ph / 2, -0.12);
  portal.add(sheen);
  portal.scale.set(1, 0.001, 1);
  portal.visible = false;
  group.add(portal);

  // --- the King and his chronicler, remembered: two Witness figures lit from within ---
  // The King (the generated `king` body, 1.76 m) as the book has him: “armor broken along one shoulder. Blood runs
  // beneath one eye” — `wounded`; no halo: a real, exhausted man, not an icon. Vesryn (the `vesryn` body, 1.74 m)
  // is plainer and dimmer — his own archetype never has a halo.
  const king: Figure = { visual: null, target: null, speed: 1.0, yaw: 0 };
  const vesryn: Figure = { visual: null, target: null, speed: 1.0, yaw: 0 };
  const kv = game.chars.create('kingWitness', { seed: 1, wounded: true, halo: false });
  const vv = game.chars.create('vesryn', { seed: 2 });
  if (isHumanoidVisual(kv)) king.visual = kv;
  if (isHumanoidVisual(vv)) vesryn.visual = vv;
  kv.setGlow(1.4);
  vv.setGlow(0.3);
  vv.setRim(0.25, 0xd8d0c0);
  for (const v of [kv, vv]) group.add(v.root);
  // the white-gold blade: a line of light in the King's hand
  const blade = new THREE.Mesh(own(new THREE.CylinderGeometry(0.018, 0.012, 1.15, 6)), mats.emissive(0xfff3da, 6));
  blade.position.set(0, 0, -0.62);
  blade.rotation.x = Math.PI / 2;
  blade.visible = false;
  kv.socket('handR').add(blade);

  b.add(b.keep(group));
  return {
    group, star, halo, red, white, wound, portal, portalInner, blade, king, vesryn,
    tgt: { star: 1, sunder: 0, wound: 0, portal: 0, blade: 0 },
    cur: { star: 1, sunder: 0, wound: 0, portal: 0, blade: 0 },
    owned,
  };
}

/** place a figure on the bridge (plan offsets from the dais centre) */
export function placeFigure(b: { P: ZoneBuilder['P'] } | ZoneRuntime, f: Figure, dx: number, dn: number, yawDeg: number): void {
  if (!f.visual) return;
  f.visual.root.position.copy(b.P(C.x + dx, C.n + dn, FLOOR));
  f.yaw = (-yawDeg * Math.PI) / 180;
  f.visual.root.rotation.y = f.yaw;
  f.target = null;
  f.visual.teleported();
}

/** send a figure walking to a plan offset (snaps when skipping) */
export function walkFigure(z: ZoneRuntime, f: Figure, dx: number, dn: number, speed = 1.0): void {
  f.target = z.P(C.x + dx, C.n + dn, FLOOR);
  f.speed = speed;
  if (z.skipping && f.visual) {
    f.visual.root.position.copy(f.target);
    f.target = null;
  }
}

const RED = new THREE.Color(1.0, 0.24, 0.08).multiplyScalar(3.0);
const WHITE_HOT = new THREE.Color(1, 0.98, 0.95).multiplyScalar(9);
const BLUE = new THREE.Color(0.62, 0.8, 1.0).multiplyScalar(3.4);
const TMP = new THREE.Vector3();

function ease(cur: number, tgt: number, dt: number, rate: number, snap: boolean): number {
  if (snap) return tgt;
  const d = tgt - cur;
  return Math.abs(d) < 1e-4 ? tgt : cur + Math.sign(d) * Math.min(Math.abs(d), dt * rate);
}

/** ZoneDef.update while the set is live */
export function updateWitnessSet(z: ZoneRuntime, W: WitnessSet, dt: number): void {
  if (!W.group.visible) return;
  const snap = z.skipping;
  W.cur.star = ease(W.cur.star, W.tgt.star, dt, 0.8, snap);
  W.cur.sunder = ease(W.cur.sunder, W.tgt.sunder, dt, 0.16, snap);
  W.cur.wound = ease(W.cur.wound, W.tgt.wound, dt, 0.22, snap);
  W.cur.portal = ease(W.cur.portal, W.tgt.portal, dt, 0.7, snap);
  W.cur.blade = ease(W.cur.blade, W.tgt.blade, dt, 2.5, snap);
  // the whole star, then the sundering: the halves part, shrink and change — red and swollen to the west, small and
  // hard white to the east — while the Wound opens between them
  const s = W.cur.sunder;
  const whole = s <= 0.001;
  W.star.visible = whole && W.cur.star > 0.01;
  W.halo.visible = W.cur.star > 0.01 && s < 0.6;
  (W.halo.material as THREE.MeshBasicMaterial).opacity = (1 - s / 0.6) * W.cur.star;
  W.red.visible = !whole && s < 0.999;
  W.white.visible = !whole && s < 0.999;
  if (!whole) {
    const eye = W.star.position;
    const k = s * s * (3 - 2 * s);
    W.red.position.copy(eye).add(TMP.set(-1, 0.12, 0).multiplyScalar(k * 900));
    W.white.position.copy(eye).add(TMP.set(1, 0.06, 0).multiplyScalar(k * 860));
    W.red.scale.setScalar(1 - 0.35 * k);
    W.white.scale.setScalar(Math.max(0.04, 1 - 0.95 * k));
    (W.red.material as THREE.MeshBasicMaterial).color.copy(BLUE).lerp(RED, Math.min(1, k * 1.4));
    (W.white.material as THREE.MeshBasicMaterial).color.copy(BLUE).lerp(WHITE_HOT, Math.min(1, k * 1.6));
    const fade = s > 0.75 ? 1 - (s - 0.75) / 0.25 : 1;
    W.red.scale.multiplyScalar(Math.max(0.02, fade));
    W.white.scale.multiplyScalar(Math.max(0.02, fade));
  }
  W.wound.visible = W.cur.wound > 0.005;
  W.wound.scale.setScalar(Math.max(0.001, W.cur.wound * 300));
  W.portal.visible = W.cur.portal > 0.005;
  W.portal.scale.set(1, Math.max(0.001, W.cur.portal), 1);
  W.blade.visible = W.cur.blade > 0.02;
  W.blade.scale.set(1, Math.max(0.05, W.cur.blade), 1);
  for (const f of [W.king, W.vesryn]) {
    const v = f.visual;
    if (!v) continue;
    let speed = 0;
    if (f.target) {
      const p = v.root.position;
      TMP.copy(f.target).sub(p);
      TMP.y = 0;
      const d = TMP.length();
      if (snap || d < 0.05) {
        p.copy(f.target);
        f.target = null;
      } else {
        const step = Math.min(d, f.speed * dt);
        p.addScaledVector(TMP.normalize(), step);
        f.yaw = Math.atan2(-TMP.x, -TMP.z);
        speed = f.speed;
      }
    }
    let dy = f.yaw - v.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    v.root.rotation.y += snap ? dy : dy * Math.min(1, dt * 6);
    v.setLocomotion(speed, 0);
    v.update(dt);
  }
}

export function disposeWitnessSet(W: WitnessSet): void {
  W.blade.removeFromParent();
  for (const f of [W.king, W.vesryn]) {
    if (!f.visual) continue;
    f.visual.root.removeFromParent();
    f.visual.dispose();
  }
  for (const o of W.owned) o.dispose();
}
