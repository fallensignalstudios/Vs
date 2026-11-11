/**
 * ADDED (polish 4): daylight inside — lit haze volumes and the bright closed-ceiling haze the relay-route and
 * quarantine paintings show above their halls (`ceiling({ style: 'skylight' })`).
 *
 *  - `haze()`: a box of luminous haze. The shader integrates its density analytically along the view ray through
 *    the box (no ray marching): soft at every face, denser toward the bottom or the top, additive, unfogged, never
 *    reflected. One draw call per volume.
 *  - `skylight`: a deep coffered ceiling whose every coffer opens onto a bright box of daylight haze (light boxes:
 *    no sky, no stars), the beams edged in fine gold and silhouetted against the light, the coffer sides lit by it.
 *    With `hazeBelow` (default true) a haze volume hangs under it so the upper hall reads as bright haze.
 */
import * as THREE from 'three';
import { RENDER_LAYERS } from '@/core/api/render';
import type { CeilingOpts, HazeOpts } from '@/core/api';
import { familyOf, type KitCtx, type Part } from './core';
import { HazeWriter } from './vault';

const HAZE_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}`;

const HAZE_FRAG = /* glsl */ `
#include <clipping_planes_pars_fragment>
varying vec3 vLocal;
uniform vec3 uCam;      // camera position in the box's unit frame (−0.5 … 0.5)
uniform vec3 uSize;     // box size, metres
uniform vec3 uColor;
uniform vec4 uHaze;     // x density per metre · y vertical falloff (+ denser below, − denser above) · z edge softness · w strength
float aurHazeAt( vec3 p ) {
  vec3 e = 0.5 - abs( p );
  vec3 soft = clamp( e / max( uHaze.z, 1e-3 ), 0.0, 1.0 );
  float edge = soft.x * soft.z * smoothstep( 0.0, 1.0, soft.y );
  float y = p.y + 0.5;
  float v = uHaze.y >= 0.0 ? mix( 1.0, 1.0 - y, uHaze.y ) : mix( 1.0, y, - uHaze.y );
  return edge * edge * max( v, 0.0 );
}
void main() {
  #include <clipping_planes_fragment>
  vec3 ro = uCam, rd = normalize( vLocal - uCam );
  vec3 inv = 1.0 / ( rd + vec3( 1e-6 ) );
  vec3 t0 = ( - 0.5 - ro ) * inv, t1 = ( 0.5 - ro ) * inv;
  vec3 tn = min( t0, t1 ), tf = max( t0, t1 );
  float a = max( max( tn.x, tn.y ), max( tn.z, 0.0 ) ), b = min( min( tf.x, tf.y ), tf.z );
  if ( b <= a ) discard;
  vec3 pa = ro + rd * a, pb = ro + rd * b;
  float L = length( ( pb - pa ) * uSize );
  // four samples along the chord (the density varies slowly): an analytic-enough integral
  float acc = 0.0;
  for ( int i = 0; i < 4; i++ ) acc += aurHazeAt( mix( pa, pb, ( float( i ) + 0.5 ) / 4.0 ) );
  float tau = uHaze.x * L * acc * 0.25;
  float alpha = ( 1.0 - exp( - tau ) ) * uHaze.w;
  gl_FragColor = vec4( uColor * alpha, alpha );
}`;


/** A lit haze volume (see the module header). */
export function buildHaze(ctx: KitCtx, o: HazeOpts): THREE.Object3D {
  const w = ctx.num(o.w, 10, 0.2), d = ctx.num(o.d, 10, 0.2), H = ctx.num(o.height, 6, 0.2);
  const uniforms = {
    uCam: { value: new THREE.Vector3() },
    uSize: { value: new THREE.Vector3(w, H, d) },
    uColor: { value: new THREE.Color(ctx.num(o.color, 0xf2eee6)).multiplyScalar(ctx.num(o.intensity, 1, 0, 20)) },
    uHaze: { value: new THREE.Vector4(ctx.num(o.density, 0.04, 0, 5), ctx.num(o.falloff, -0.6, -1, 1), ctx.num(o.soft, 0.25, 0.01, 0.5), 1) },
  };
  const mat = ctx.own(new THREE.ShaderMaterial({
    vertexShader: HAZE_VERT, fragmentShader: HAZE_FRAG, uniforms, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false, toneMapped: true, clipping: true,
  }));
  mat.name = 'kit-haze';
  const geo = ctx.cached('haze-box', () => ctx.own(new THREE.BoxGeometry(1, 1, 1)));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'haze';
  mesh.position.copy(ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0) + H / 2));
  mesh.rotation.y = ctx.yaw(ctx.num(o.yawDeg, 0));
  mesh.scale.set(w, H, d);
  mesh.layers.set(RENDER_LAYERS.noReflect);
  mesh.renderOrder = 6;
  mesh.frustumCulled = true;
  const inv = new THREE.Matrix4();
  mesh.onBeforeRender = (_r, _s, camera) => {
    inv.copy(mesh.matrixWorld).invert();
    uniforms.uCam.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv);
  };
  ctx.root.add(mesh);
  return mesh;
}

/**
 * `ceiling({ style: 'skylight' })` — bright closed-ceiling haze: deep coffers open onto light boxes. Local frame as in
 * buildCeiling: X across (the short side), Z along, Y up from the beam soffits at the ceiling height.
 */
export function emitSkylight(ctx: KitCtx, part: Part, o: CeilingOpts, w: number, d: number): void {
  const hw = w / 2, hd = d / 2, fam = familyOf(o.mat);
  const glow = ctx.num(o.glow, 2.6, 0, 20), color = ctx.num(o.hazeColor, 0xf6f2ea);
  const cof = ctx.num(o.coffer, 4.5, 1.5, 20);
  const nx = Math.max(1, Math.round(w / cof)), nz = Math.max(1, Math.round(d / cof));
  const bw = 0.42, deep = 1.1, box = 0.5, cx = w / nx, cz = d / nz;
  const beam = part.g(fam.frame), trim = part.g('goldTrim'), gold = part.g(ctx.goldLine());
  // beams: deep, with a gold line along each soffit edge
  for (let i = 0; i <= nx; i++) {
    const x = -hw + cx * i;
    beam.box(bw, deep, d + bw, x, deep / 2, 0);
    for (const s of [-1, 1]) gold.ribbon([[x + s * (bw / 2 - 0.05), -0.003, -hd], [x + s * (bw / 2 - 0.05), -0.003, hd]], 0.022, [0, -1, 0]);
  }
  for (let k = 0; k <= nz; k++) {
    const z = -hd + cz * k;
    beam.box(w + bw, deep, bw, 0, deep / 2, z);
    for (const s of [-1, 1]) gold.ribbon([[-hw, -0.004, z + s * (bw / 2 - 0.05)], [hw, -0.004, z + s * (bw / 2 - 0.05)]], 0.022, [0, -1, 0]);
  }
  // perimeter frieze
  for (const s of [-1, 1]) {
    beam.box(0.7, 0.5, d + 0.7, s * (hw + 0.1), -0.05, 0);
    beam.box(w + 0.7, 0.5, 0.7, 0, -0.05, s * (hd + 0.1));
    trim.box(0.72, 0.03, d + 0.72, s * (hw + 0.1), -0.3, 0);
    trim.box(w + 0.72, 0.03, 0.72, 0, -0.3, s * (hd + 0.1));
  }
  // the light: every coffer is a box of bright haze (brightest in its middle), its sides lit from above
  const hz = new HazeWriter(color);
  const top = deep + box;
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const x0 = -hw + cx * i + bw / 2, x1 = -hw + cx * (i + 1) - bw / 2, z0 = -hd + cz * k + bw / 2, z1 = -hd + cz * (k + 1) - bw / 2;
      const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2, e = 0.68;
      // back of the box: four quads round the bright centre
      hz.quad([x0, top, z0], [xm, top, z0], [xm, top, zm], [x0, top, zm], [0, -1, 0], [e, e, 1, e]);
      hz.quad([xm, top, z0], [x1, top, z0], [x1, top, zm], [xm, top, zm], [0, -1, 0], [e, e, e, 1]);
      hz.quad([xm, top, zm], [x1, top, zm], [x1, top, z1], [xm, top, z1], [0, -1, 0], [1, e, e, e]);
      hz.quad([x0, top, zm], [xm, top, zm], [xm, top, z1], [x0, top, z1], [0, -1, 0], [e, 1, e, e]);
      // the light box's sides above the beams: lit by the haze, a little dimmer where they meet the beams
      const lo = 0.5, hi = 0.85;
      hz.quad([x0, deep, z0], [x1, deep, z0], [x1, top, z0], [x0, top, z0], [0, 0, 1], [lo, lo, hi, hi]);
      hz.quad([x0, deep, z1], [x1, deep, z1], [x1, top, z1], [x0, top, z1], [0, 0, -1], [lo, lo, hi, hi]);
      hz.quad([x0, deep, z0], [x0, deep, z1], [x0, top, z1], [x0, top, z0], [1, 0, 0], [lo, lo, hi, hi]);
      hz.quad([x1, deep, z0], [x1, deep, z1], [x1, top, z1], [x1, top, z0], [-1, 0, 0], [lo, lo, hi, hi]);
    }
  }
  const mesh = hz.mesh(ctx, glow, false);
  mesh.name = 'skylight-haze';
  part.group.add(mesh);
  // a closed lid over the light boxes (so nothing beyond ever shows)
  beam.box(w + 1.2, 0.3, d + 1.2, 0, top + 0.16, 0);
}
