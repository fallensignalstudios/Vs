/**
 * Stand-in protagonist for the camera sandbox: a readable ~1.9 m Dominion silhouette (bronze / oxblood /
 * black, amber accents, greatsword on the back) so over-the-shoulder framing can be judged against a figure
 * rather than a bare capsule. Collision is still a 0.4 m capsule.
 */
import * as THREE from 'three';

export interface Mannequin {
  root: THREE.Group;
  /** subtle run lean / bob; speed in m/s */
  animate(dt: number, speed: number, aiming: boolean): void;
  /** 0..1 — the sandbox fades the figure when the camera is squeezed against it */
  setOpacity(alpha: number): void;
}

export function createMannequin(): Mannequin {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mats: THREE.MeshStandardMaterial[] = [];
  const mat = (color: number, roughness: number, metalness: number, emissive = 0x000000, emissiveIntensity = 0): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity, transparent: true });
    mats.push(m);
    return m;
  };
  const black = mat(0x15131a, 0.55, 0.5);
  const bronze = mat(0x8a5a2b, 0.36, 0.85);
  const oxblood = mat(0x5a1616, 0.62, 0.25);
  const cloth = mat(0x2a1014, 0.85, 0.05);
  const amber = mat(0x000000, 1, 0, 0xffa033, 3);
  const cinder = mat(0x000000, 1, 0, 0xff6a1a, 2.2);
  const steel = mat(0x3a3a40, 0.3, 0.9);

  const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // legs + boots
  const legL = part(new THREE.CapsuleGeometry(0.095, 0.62, 4, 10), black, -0.125, 0.47, 0);
  const legR = part(new THREE.CapsuleGeometry(0.095, 0.62, 4, 10), black, 0.125, 0.47, 0);
  part(new THREE.BoxGeometry(0.17, 0.15, 0.32), bronze, -0.125, 0.075, -0.04);
  part(new THREE.BoxGeometry(0.17, 0.15, 0.32), bronze, 0.125, 0.075, -0.04);
  part(new THREE.BoxGeometry(0.16, 0.2, 0.07), bronze, -0.125, 0.5, -0.1);
  part(new THREE.BoxGeometry(0.16, 0.2, 0.07), bronze, 0.125, 0.5, -0.1);
  // hips, tasset skirt
  part(new THREE.BoxGeometry(0.4, 0.2, 0.27), black, 0, 0.95, 0);
  part(new THREE.BoxGeometry(0.44, 0.07, 0.31), bronze, 0, 1.04, 0);
  part(new THREE.BoxGeometry(0.17, 0.34, 0.04), oxblood, -0.13, 0.8, -0.15);
  part(new THREE.BoxGeometry(0.17, 0.34, 0.04), oxblood, 0.13, 0.8, -0.15);
  // torso: cuirass tapering to the waist
  const chest = part(new THREE.CylinderGeometry(0.235, 0.18, 0.52, 12), bronze, 0, 1.34, 0);
  chest.scale.set(1.12, 1, 0.8);
  part(new THREE.BoxGeometry(0.3, 0.34, 0.05), oxblood, 0, 1.36, 0.19); // back plate
  part(new THREE.BoxGeometry(0.035, 0.3, 0.02), amber, 0, 1.36, 0.222); // spine light — the read from behind
  // shoulders + arms
  for (const sx of [-1, 1]) {
    const pauldron = part(new THREE.SphereGeometry(0.135, 14, 10), bronze, sx * 0.29, 1.555, 0);
    pauldron.scale.set(1.1, 0.74, 1.15);
    part(new THREE.BoxGeometry(0.16, 0.04, 0.26), oxblood, sx * 0.3, 1.49, 0);
    part(new THREE.CapsuleGeometry(0.068, 0.5, 4, 8), black, sx * 0.31, 1.2, 0.01);
    part(new THREE.BoxGeometry(0.13, 0.22, 0.15), bronze, sx * 0.31, 0.98, -0.01); // vambrace
  }
  // neck, head, helm crest
  part(new THREE.CylinderGeometry(0.075, 0.09, 0.1, 10), black, 0, 1.66, 0);
  const head = part(new THREE.SphereGeometry(0.125, 16, 12), black, 0, 1.79, 0);
  head.scale.set(0.95, 1.08, 1.05);
  part(new THREE.BoxGeometry(0.03, 0.16, 0.26), bronze, 0, 1.88, 0.01);
  part(new THREE.BoxGeometry(0.2, 0.025, 0.02), amber, 0, 1.8, -0.125); // visor
  // half-cloak over the left shoulder
  cloth.side = THREE.DoubleSide;
  part(new THREE.PlaneGeometry(0.5, 0.95, 1, 4), cloth, -0.12, 1.08, 0.235).rotation.x = 0.1;
  // Velkorran: greatsword slung diagonally across the back
  const sword = new THREE.Group();
  sword.position.set(0.02, 1.32, 0.29);
  sword.rotation.z = -0.5;
  body.add(sword);
  part(new THREE.BoxGeometry(0.11, 1.25, 0.03), steel, 0, 0.1, 0, sword);
  part(new THREE.BoxGeometry(0.012, 1.1, 0.034), cinder, 0, 0.1, 0, sword);
  part(new THREE.BoxGeometry(0.34, 0.05, 0.06), bronze, 0, -0.55, 0, sword);
  part(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), black, 0, -0.75, 0, sword);

  let phase = 0;
  return {
    root,
    animate(dt, speed, aiming) {
      const k = Math.min(1, speed / 6);
      phase += dt * (4 + speed * 1.4);
      const swing = Math.sin(phase) * 0.55 * k;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      body.position.y = Math.abs(Math.sin(phase)) * 0.035 * k;
      body.rotation.x = -0.16 * k + (aiming ? -0.05 : 0); // lean into the run (forward is −Z)
    },
    setOpacity(alpha) {
      const a = Math.max(0, Math.min(1, alpha));
      root.visible = a > 0.02;
      for (const m of mats) m.opacity = a;
    },
  };
}
