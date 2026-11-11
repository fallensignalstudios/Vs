/**
 * The King's five-point halo for a generated body (integration): the procedural Witness's crown of light — a thin
 * ring held in the air behind the head with five rays across its top, never worn — rebuilt as one small mesh that
 * rides the visible body's `head` socket. Unlit and bright enough to bloom; setGlow() scales it like any other
 * light the figure carries. One draw call; no shadow.
 */
import * as THREE from 'three';

/** the procedural figure's measurements (others.ts kingWitness), metres at scale 1 */
const RING_R = 0.17, RING_T = 0.004, RAY_R = 0.19;
/** centre of the ring from the `head` socket (the middle of the skull): a little up, behind the head (+Z) */
const OFFSET = new THREE.Vector3(0, 0.035, 0.12);
/** the procedural halo's light: 0xffe2a8 × 2.4 */
const LIGHT = new THREE.Color(0xffe2a8);
const INTENSITY = 2.4;

function rayGeometry(len: number): THREE.BufferGeometry {
  // a flat spindle in the ring's plane: narrow root, a swell, a fine point
  const pts = [new THREE.Vector2(0.002, -0.02), new THREE.Vector2(0.013, 0.012), new THREE.Vector2(0.0015, len)];
  const g = new THREE.LatheGeometry(pts, 6);
  g.scale(1, 1, 0.46);
  return g;
}

function haloGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(RING_R, RING_T, 4, 40)];
  for (let i = 0; i < 5; i++) {
    const a = ((-60 + i * 30) * Math.PI) / 180;
    const len = 0.11 + (i === 2 ? 0.06 : i === 1 || i === 3 ? 0.025 : 0);
    const g = rayGeometry(len);
    g.rotateZ(-a);
    g.translate(Math.sin(a) * RAY_R, Math.cos(a) * RAY_R, 0);
    parts.push(g);
  }
  // merge by hand (positions only: the material is unlit)
  let n = 0;
  for (const p of parts) n += (p.index ? p.index.count : p.getAttribute('position').count);
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    const src = p.index ? p.toNonIndexed() : p;
    const a = src.getAttribute('position') as THREE.BufferAttribute;
    pos.set(a.array as Float32Array, o);
    o += a.array.length;
    if (src !== p) src.dispose();
    p.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeBoundingSphere();
  return out;
}

let shared: THREE.BufferGeometry | null = null;
let users = 0;

export interface WitnessHalo {
  readonly mesh: THREE.Mesh;
  setGlow(amount: number): void;
  dispose(): void;
}

/** A halo for a figure of scale `scale`; add `mesh` to the visible body's `head` socket. */
export function witnessHalo(scale: number): WitnessHalo {
  shared ??= haloGeometry();
  users++;
  const material = new THREE.MeshBasicMaterial({ color: LIGHT.clone().multiplyScalar(INTENSITY), side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(shared, material);
  mesh.name = 'witnessHalo';
  mesh.position.copy(OFFSET).multiplyScalar(scale);
  mesh.scale.setScalar(scale);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  let disposed = false;
  return {
    mesh,
    setGlow(amount: number) {
      const a = Math.max(0, Number.isFinite(amount) ? amount : 1);
      material.color.copy(LIGHT).multiplyScalar(INTENSITY * a);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mesh.removeFromParent();
      material.dispose();
      if (--users <= 0 && shared) { shared.dispose(); shared = null; users = 0; }
    },
  };
}
