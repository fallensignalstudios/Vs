/**
 * Generated props (weapons, shield, case) as equipment: each is wrapped in a HOLDER whose frame is the
 * procedural item's frame — grip at the origin, blade / barrel along −Z, +Y up — so the wrapper can drive it
 * with the driver's equipment-bone orientation and the sockets (`weaponBase` … `muzzle`) keep their meaning.
 * Alignment comes from the manifest (long axis, target length, grip, muzzle, front), not from per-file numbers.
 */
import * as THREE from 'three';
import type { ItemDef } from '../humanoid/figure';
import { MASK_NONE, PROP_MASKS, type ItemSlot, type ManifestEntry } from './config';
import type { ModelLibrary } from './library';
import { createGlbMaterial, type GlbMaterial, type OwnUniforms, type SharedUniforms } from './material';

export interface PropRig {
  slot: ItemSlot;
  /** child of the character root; positioned by the visual every frame */
  holder: THREE.Group;
  /** named points in the holder's frame (also Object3Ds under the holder) */
  sockets: Record<string, THREE.Object3D>;
  /** tip of a long blade in the holder's frame (kept off the floor), or null */
  tip: THREE.Vector3 | null;
  /** blade-clip uniform of a ring-hilted energy weapon ([enabled, root, forward, rear] metres), or null */
  blade: OwnUniforms['uBlade'] | null;
  /** full length of one energy blade beyond its root */
  bladeLength: number;
  /** overall length of a generated prop along its long axis (0 for procedural items) */
  length: number;
  /** true when a generated mesh is mounted (false: the procedural item is drawn instead) */
  generated: boolean;
  materials: GlbMaterial[];
  triangles: number;
  dispose(): void;
}

const AXIS = { x: 0, y: 1, z: 2 } as const;
let gripBar: THREE.CylinderGeometry | null = null;

function socket(holder: THREE.Object3D, name: string, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = 'socket:' + name;
  o.position.set(x, y, z);
  holder.add(o);
  return o;
}

/** Holder with the driver item's own socket layout — used when no generated prop is available for the slot. */
export function proceduralProp(slot: ItemSlot, item: ItemDef, driverScale: number): PropRig {
  const holder = new THREE.Group();
  holder.name = 'prop:' + slot;
  const sockets: Record<string, THREE.Object3D> = {};
  const s = item.sockets ?? {};
  for (const name of Object.keys(s)) sockets[name] = socket(holder, name, s[name][0] * driverScale, s[name][1] * driverScale, s[name][2] * driverScale);
  if (slot === 'shield') sockets.shield = socket(holder, 'shield', 0, 0, -0.08 * driverScale);
  const t = s.weaponTip;
  return {
    slot, holder, sockets, tip: t && !item.blades ? new THREE.Vector3(t[0], t[1], t[2]).multiplyScalar(driverScale) : null,
    blade: null, bladeLength: 0, length: 0, generated: false, materials: [], triangles: 0, dispose() { holder.removeFromParent(); },
  };
}

/**
 * Mount the generated prop `name` for `slot`. Returns null when the model is not loaded (the caller falls back
 * to proceduralProp). `figureScale` is the character's uniform scale (props grow with the figure).
 */
export function generatedProp(lib: ModelLibrary, name: string, slot: ItemSlot, shared: SharedUniforms, figureScale: number): PropRig | null {
  const inst = lib.instantiate(name);
  if (!inst) return null;
  const tpl = inst.template, e: ManifestEntry = tpl.entry;
  const size = tpl.box.getSize(new THREE.Vector3()), centre = tpl.box.getCenter(new THREE.Vector3());
  const long = AXIS[e.longAxis ?? 'z'] ?? 2;
  const rawLen = size.getComponent(long);
  const k = (e.targetLength && rawLen > 1e-6 ? e.targetLength / rawLen : 1) * figureScale;
  const grip = e.grip && e.grip.length >= 3 ? new THREE.Vector3(e.grip[0], e.grip[1], e.grip[2]) : centre.clone();
  const ring = slot === 'melee' && e.handleAt === 'center';

  const holder = new THREE.Group();
  holder.name = 'prop:' + name;
  const fix = new THREE.Group();
  holder.add(fix);
  fix.add(inst.root);
  inst.root.scale.setScalar(k);
  // a chunky generated greatsword reads better slimmed across its flat
  if (slot === 'melee' && !ring) inst.root.scale.x = k * 0.62;
  inst.root.position.copy(grip).multiply(inst.root.scale).negate();
  if (ring) fix.rotation.z = Math.PI / 2;                      // ring hole axis X → Y: the forearm passes through it
  if (slot === 'shield') {
    // files face +Z, the engine's shield faces −Z; the carrier's forearm lies behind the upper third
    if (String(e.front ?? '+z').toLowerCase() === '+z') fix.rotation.y = Math.PI;
    fix.position.set(0, -0.1 * figureScale, -0.012 * figureScale);
  }

  const materials: GlbMaterial[] = [];
  const clip: { blade: OwnUniforms['uBlade'] | null } = { blade: null };
  const mask = PROP_MASKS[name] ?? MASK_NONE;
  // rest space of a prop = its holder's frame (metres from the grip, −Z along the blade)
  holder.updateMatrixWorld(true);
  inst.meshes.forEach((mesh, i) => {
    const src = tpl.materials[i] ?? tpl.materials[0];
    const gm = createGlbMaterial(src, shared, { mask, rest: mesh.matrixWorld, albedoCap: 0.6, envIntensity: 0.9, doubleSided: slot === 'shield' });
    mesh.material = gm.material;
    mesh.customDepthMaterial = gm.depth;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    materials.push(gm);
    if (ring) clip.blade = gm.own.uBlade;
  });

  const sockets: Record<string, THREE.Object3D> = {};
  let tip: THREE.Vector3 | null = null, bladeLength = 0;
  const half = (rawLen * k) / 2;
  if (slot === 'melee') {
    if (ring) {
      // blades leave the ring at 0.2 of the length and end at its tips; a grip bar gives the fist something to hold
      const root = 0.4 * half;
      bladeLength = half - root;
      sockets.weaponBase = socket(holder, 'weaponBase', 0, 0, -root);
      sockets.weaponMid = socket(holder, 'weaponMid', 0, 0, -(root + bladeLength * 0.5));
      sockets.weaponTip = socket(holder, 'weaponTip', 0, 0, -half);
      sockets.weaponTip2 = socket(holder, 'weaponTip2', 0, 0, half);
      clip.blade?.value.set(1, root, bladeLength, bladeLength);
      const lat = long === 2 ? 1 : 2;
      const outer = (size.getComponent(lat) * k) / 2;
      gripBar ??= new THREE.CylinderGeometry(1, 1, 1, 10);
      const gm = createGlbMaterial(new THREE.MeshStandardMaterial({ color: 0x1a1f28, roughness: 0.55, metalness: 0.5 }), shared, { mask: MASK_NONE });
      const bar = new THREE.Mesh(gripBar, gm.material);
      bar.name = 'gripBar';
      bar.rotation.x = Math.PI / 2;
      bar.scale.set(0.0135 * figureScale, outer * 1.72, 0.0135 * figureScale);
      bar.castShadow = true;
      holder.add(bar);
      materials.push(gm);
    } else {
      // tip at the −Z end of the box; the blade proper starts a little beyond the guard
      const tz = (tpl.box.min.z - grip.z) * k;
      tip = new THREE.Vector3(0, 0, tz);
      sockets.weaponBase = socket(holder, 'weaponBase', 0, 0, tz * 0.225);
      sockets.weaponMid = socket(holder, 'weaponMid', 0, 0, tz * 0.6);
      sockets.weaponTip = socket(holder, 'weaponTip', 0, 0, tz);
    }
  } else if (slot === 'ranged') {
    const m = e.muzzle && e.muzzle.length >= 3 ? new THREE.Vector3(e.muzzle[0], e.muzzle[1], e.muzzle[2]) : new THREE.Vector3(grip.x, grip.y, tpl.box.min.z);
    m.sub(grip).multiplyScalar(k);
    sockets.muzzle = socket(holder, 'muzzle', m.x, m.y, m.z);
  } else if (slot === 'shield') {
    sockets.shield = socket(holder, 'shield', 0, fix.position.y, fix.position.z - size.z * k);
  }
  return {
    slot, holder, sockets, tip, blade: clip.blade, bladeLength, length: rawLen * k, generated: true, materials, triangles: tpl.triangles,
    dispose() { holder.removeFromParent(); for (const m of materials) m.dispose(); },
  };
}
