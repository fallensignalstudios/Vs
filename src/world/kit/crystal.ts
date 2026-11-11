/**
 * ADDED (polish 4): crystal corruption — the quarantine painting's violet crystal growth. Faceted, glassy shards
 * (flat-shaded hexagonal prisms with pointed tips, a polished dark violet glass that mirrors the room facet by
 * facet) whose CORES glow from the root up and whose edges catch a violet rim. They grow out of a surface in
 * grounded clusters — every shard starts inside a dark root mound on the floor or wall, the largest in the middle,
 * the rest fanned round it — never floating. Three sizes.
 *
 * One material per builder (`aCore` vertex attribute: x = how deep in the core, y = per-shard brightness), merged
 * with every other crystal of the zone in finalize(): a zone pays one draw call for all of its crystals (plus the
 * root mounds, which share the tissue material). No collider.
 */
import * as THREE from 'three';
import type { CrystalOpts } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { AUR_TIME } from '@/world/materials/patch';
import type { V3 } from './geo';
import { Geo } from './geo';
import { type KitCtx, localRand, Part } from './core';


const VERT_PARS = /* glsl */ `
attribute vec2 aCore;
varying vec2 vCore;
`;
const FRAG_PARS = /* glsl */ `
varying vec2 vCore;
uniform vec3 uCrystalGlow;
uniform float uCrystalTime;
`;
const FRAG_EMIT = /* glsl */ `
{
  // the core: bright at the root, fading toward the tip, breathing slowly; the rim: the edges facing away catch light
  float core = pow( clamp( vCore.x, 0.0, 1.0 ), 1.6 ) * vCore.y;
  float breathe = 0.82 + 0.18 * sin( uCrystalTime * 1.3 + vCore.y * 11.0 );
  float rim = pow( 1.0 - saturate( abs( dot( normal, normalize( vViewPosition ) ) ) ), 3.0 );
  totalEmissiveRadiance += uCrystalGlow * ( core * 1.9 * breathe + rim * ( 0.35 + 0.65 * vCore.x ) * 1.1 );
}
`;

/** The shared crystal material of a builder (dark violet glass, emissive cores). */
export function crystalMaterial(ctx: KitCtx, intensity: number): THREE.Material {
  const key = `crystal:${intensity.toFixed(2)}`;
  return ctx.cached(key, () => {
    const m = ctx.own(new THREE.MeshPhysicalMaterial({
      color: 0x170e22, roughness: 0.06, metalness: 0, ior: 1.7, clearcoat: 0.6, clearcoatRoughness: 0.05,
      flatShading: true, envMapIntensity: 1.4, specularIntensity: 1,
    }));
    m.name = `kit-crystal:${intensity.toFixed(2)}`;
    const glow = new THREE.Color(PALETTE.eclipseViolet).multiplyScalar(Math.max(0, intensity));
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uCrystalGlow = { value: glow };
      shader.uniforms.uCrystalTime = AUR_TIME as THREE.IUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCore = aCore;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMIT}`);
    };
    m.customProgramCacheKey = () => 'kit-crystal-1';
    return m;
  });
}

function sizeOf(o: CrystalOpts): number {
  if (typeof o.size === 'number' && Number.isFinite(o.size)) return Math.max(0.08, Math.min(6, o.size));
  return o.size === 'small' ? 0.4 : o.size === 'large' ? 2.6 : 1.1;
}

/** Emit one cluster into `geo` (positions / normals) and its core attribute into `core`. Local +Y = out of the surface. */
function cluster(geo: Geo, core: number[], rnd: () => number, cx: number, cz: number, big: number): void {
  const shards = 4 + Math.floor(rnd() * 5);
  for (let i = 0; i < shards; i++) {
    const main = i === 0;
    const hgt = big * (main ? 0.85 + rnd() * 0.15 : 0.3 + rnd() * 0.5);
    const r = hgt * (0.12 + rnd() * 0.06), tip = hgt * (0.25 + rnd() * 0.2);
    const tilt = main ? rnd() * 0.25 : 0.35 + rnd() * 0.6, dir = rnd() * Math.PI * 2;
    const ox = main ? 0 : Math.cos(dir) * big * 0.12, oz = main ? 0 : Math.sin(dir) * big * 0.12;
    const start = geo.pos.length;
    // rooted: the base sits below the surface, so it never floats
    geo.push().move(cx + ox, -r * 0.6, cz + oz).rotY(-dir).rotZ(-tilt).crystal(r, hgt, tip, 6, rnd).pop();
    // core attribute: 1 at the root → 0 at the tip, measured along the shard's own axis
    const ax: V3 = [Math.sin(tilt) * Math.cos(dir), Math.cos(tilt), Math.sin(tilt) * Math.sin(dir)];
    const b: V3 = [cx + ox, -r * 0.6, cz + oz];
    const glow = 0.55 + rnd() * 0.45;
    for (let k = start; k < geo.pos.length; k += 3) {
      const t = ((geo.pos[k] - b[0]) * ax[0] + (geo.pos[k + 1] - b[1]) * ax[1] + (geo.pos[k + 2] - b[2]) * ax[2]) / (hgt + tip);
      core.push(1 - Math.max(0, Math.min(1, t)), glow);
    }
  }
}

/**
 * Crystal clusters (see the module header). `ctx.rand` is not drawn from: the shapes come from a private stream
 * seeded by the position, so adding crystals never shifts the zone's other dressing.
 */
export function buildCrystals(ctx: KitCtx, o: CrystalOpts): THREE.Object3D {
  const R = ctx.num(o.r, 1.2, 0.1, 30), big = sizeOf(o), k = ctx.num(o.intensity, 1, 0, 3);
  const pos = ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0));
  const rnd = localRand(pos.x, pos.z, R, big, 0.731);
  const part = new Part(ctx, 'crystals', pos, ctx.yaw(ctx.num(o.yawDeg, 0)));
  const nClusters = Math.round(ctx.num(o.clusters, Math.round(1 + R), 1, 40));
  const geo = new Geo(), core: number[] = [];
  const mound = part.g('eclipseTissue');
  if (o.onWall) mound.push().rotX(-Math.PI / 2);
  for (let c = 0; c < nClusters; c++) {
    const a = rnd() * Math.PI * 2, rr = c === 0 ? 0 : R * (0.35 + rnd() * 0.65);
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    const s = big * (c === 0 ? 1 : 0.45 + rnd() * 0.45);
    cluster(geo, core, rnd, cx, cz, s);
    // the dark root mound the shards break out of
    mound.push().move(cx, 0, cz).rotY(rnd() * 6.28).blob(s * 0.32, s * 0.12, s * 0.28, 0.9, rnd, 10, 4).pop();
  }
  if (o.onWall) mound.pop();
  // the crystal mesh: its own geometry (with the core attribute), flagged static so finalize merges it
  const g = geo.toGeometry();
  if (o.onWall) { g.rotateX(-Math.PI / 2); g.computeBoundingSphere(); }
  g.setAttribute('aCore', new THREE.BufferAttribute(new Float32Array(core), 2));
  const mesh = new THREE.Mesh(ctx.own(g), crystalMaterial(ctx, k));
  mesh.name = 'crystal';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.kitStatic = true;
  part.group.add(mesh);
  if (o.light) {
    const light = new THREE.PointLight(PALETTE.eclipseViolet, 2.5 * k, Math.max(4, R * 3 + big * 2), 2);
    light.position.set(0, o.onWall ? 0 : big * 0.6, o.onWall ? -big * 0.6 : 0);
    light.userData.kitFixture = true;
    part.group.add(light);
    ctx.lights.push(light);
  }
  return part.done();
}
