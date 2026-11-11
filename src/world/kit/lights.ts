/**
 * Kit lights: point / spot (optional shadow + visible shaft) / emissive panel lights, the zone key light, and
 * the shadow budget (`quality.maxShadowLights`).
 */
import * as THREE from 'three';
import type { LightOpts, RectOpts, ZoneEnvOpts } from '@/core/api';
import { RENDER_LAYERS } from '@/core/api/render';
import { isStub } from '@/core/stub';
import { Geo } from './geo';
import { KitCtx, Part } from './core';

const SHAFT_VERT = /* glsl */ `
#include <clipping_planes_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vAxial;
uniform float uLength;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorld = wp.xyz;
  vNormalW = normalize( mat3( modelMatrix ) * normal );
  vAxial = clamp( -position.y / uLength, 0.0, 1.0 );
  vec4 mvPosition = viewMatrix * wp;
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;
}`;

const SHAFT_FRAG = /* glsl */ `
#include <clipping_planes_pars_fragment>
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vAxial;
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uFog;
uniform float uFloorY;
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
void main() {
  #include <clipping_planes_fragment>
  vec3 toCam = cameraPosition - vWorld;
  float dist = length( toCam );
  // silhouettes of the cone fade out, the core stays; fade along the beam and close to the lens
  float edge = pow( abs( dot( normalize( vNormalW ), toCam / dist ) ), 1.6 );
  float along = pow( 1.0 - vAxial, 1.4 ) * smoothstep( 0.0, 0.06, vAxial );
  float dust = 0.62 + 0.38 * noise( vWorld.xz * 0.55 + vec2( uTime * 0.05, vWorld.y * 0.35 - uTime * 0.03 ) );
  float nearFade = smoothstep( 0.4, 2.5, dist );
  // depth fade: the shaft is lit air, so it thins with view depth exactly as the scene's haze does (it draws
  // without fog, being additive), and it settles softly into the floor it lands on instead of cutting a hard
  // ellipse where the cone meets the stone
  float haze = uFog * dist;
  float depth = exp( - haze * haze ) * ( 1.0 - smoothstep( 25.0, 90.0, dist ) * 0.45 );
  float contact = smoothstep( 0.0, 1.2, vWorld.y - uFloorY );
  float a = uStrength * edge * along * dust * nearFade * depth * contact;
  gl_FragColor = vec4( uColor * a, a );
}`;

function buildShaft(ctx: KitCtx, light: THREE.SpotLight, color: number, length: number, angle: number): THREE.Mesh {
  const geo = new Geo().band(0.08, 0, 0.08 + Math.tan(angle) * length, -length, 28).toGeometry();
  const uniforms = {
    uColor: { value: new THREE.Color(color) }, uStrength: { value: 0.5 }, uTime: { value: 0 }, uLength: { value: length },
    uFog: { value: 0 }, uFloorY: { value: -1e4 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: SHAFT_VERT, fragmentShader: SHAFT_FRAG, uniforms, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: true,
    // cut by the renderer's global clipping planes like the built-in materials (debug planView)
    clipping: true,
  });
  mat.name = 'kit-shaft';
  const mesh = new THREE.Mesh(ctx.own(geo), ctx.own(mat));
  mesh.name = 'light-shaft';
  mesh.layers.set(RENDER_LAYERS.noReflect);
  mesh.renderOrder = 8;
  mesh.frustumCulled = true;
  const dir = light.target.position.clone().sub(light.position).normalize();
  mesh.position.copy(light.position);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  ctx.updaters.push((_dt, time) => {
    uniforms.uTime.value = time;
    uniforms.uFog.value = ctx.fogDensity();
    // the floor the shaft lands on: the target height (zone-root space → world)
    uniforms.uFloorY.value = light.target.getWorldPosition(_tgt).y;
    mesh.visible = light.visible && light.intensity > 0 && ctx.volumetrics();
  });
  return mesh;
}
const _tgt = new THREE.Vector3();

function flicker(ctx: KitCtx, light: THREE.Light, amount: number): void {
  const base = light.intensity, ph = ctx.rand() * 40;
  if (!(amount > 0)) return;
  ctx.updaters.push((_dt, time) => {
    const n = 0.5 + 0.5 * Math.sin(time * 17 + ph) * Math.sin(time * 7.3 + ph * 1.7);
    light.intensity = base * (1 - Math.min(1, amount) * n);
  });
}

export function buildPoint(ctx: KitCtx, o: LightOpts): THREE.PointLight {
  const light = new THREE.PointLight(o.color ?? 0xffe2a8, ctx.num(o.intensity, 20, 0, 5000), ctx.num(o.distance, 16, 0, 400), 2);
  light.position.copy(ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 3)));
  light.name = 'kit-point';
  ctx.root.add(light);
  ctx.lights.push(light);
  if (o.shadow) ctx.shadowLights.push({ light, wanted: true });
  flicker(ctx, light, ctx.num(o.flicker, 0, 0, 1));
  return light;
}

export function buildSpot(ctx: KitCtx, o: LightOpts): THREE.SpotLight {
  const pos = ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 6));
  const tgt = Array.isArray(o.target) && o.target.every((v) => Number.isFinite(v)) ? ctx.P(o.target[0], o.target[1], o.target[2]) : pos.clone().setY(0);
  if (tgt.distanceToSquared(pos) < 1e-4) tgt.y -= 1;
  const angle = (ctx.num(o.angleDeg, 28, 2, 85) * Math.PI) / 180;
  const reach = pos.distanceTo(tgt);
  const light = new THREE.SpotLight(o.color ?? 0xfff0d8, ctx.num(o.intensity, 320, 0, 50000), ctx.num(o.distance, Math.max(12, reach * 1.8), 0, 600), angle, ctx.num(o.penumbra, 0.55, 0, 1), 2);
  light.position.copy(pos);
  light.target.position.copy(tgt);
  light.name = 'kit-spot';
  ctx.root.add(light, light.target);
  ctx.lights.push(light);
  if (o.shadow) ctx.shadowLights.push({ light, wanted: true });
  if (o.shaft) ctx.root.add(buildShaft(ctx, light, o.color ?? 0xfff0d8, Math.min(reach * 1.05, 60), angle * 0.92));
  flicker(ctx, light, ctx.num(o.flicker, 0, 0, 1));
  return light;
}

type Facing = 'down' | 'up' | 'north' | 'south' | 'east' | 'west';

export function buildPanelLight(ctx: KitCtx, o: RectOpts & { color?: number; intensity?: number; facing?: Facing }): THREE.Object3D {
  const w = ctx.num(o.w, 2, 0.1), d = ctx.num(o.d, 0.6, 0.1), h = ctx.num(o.h, 4);
  const facing: Facing = o.facing ?? 'down';
  const base = ctx.yaw(ctx.num(o.yawDeg, 0));
  const turn: Record<Facing, number> = { down: 0, up: 0, north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 };
  const part = new Part(ctx, 'panelLight', ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), h), base + turn[facing]);
  const glow = o.color === undefined ? 'whiteLight' : ctx.emissive(o.color, 3.5);
  const frame = part.g('goldDark'), lit = part.g(glow);
  let off: [number, number, number];
  if (facing === 'down' || facing === 'up') {
    const s = facing === 'down' ? -1 : 1;
    frame.box(w + 0.14, 0.09, d + 0.14, 0, -s * 0.045, 0);
    lit.quadFacing([-w / 2, s * 0.004, -d / 2], [w / 2, s * 0.004, -d / 2], [w / 2, s * 0.004, d / 2], [-w / 2, s * 0.004, d / 2], [0, s, 0]);
    off = [0, s * 0.5, 0];
  } else {
    // vertical panel: w along the wall, d tall, bottom edge at h, facing local −Z
    frame.box(w + 0.14, d + 0.14, 0.09, 0, d / 2, 0.045);
    lit.quadFacing([-w / 2, 0, -0.004], [w / 2, 0, -0.004], [w / 2, d, -0.004], [-w / 2, d, -0.004], [0, 0, -1]);
    off = [0, d / 2, -0.6];
  }
  const group = part.done();
  const light = new THREE.PointLight(o.color ?? 0xffe9c4, ctx.num(o.intensity, 22, 0, 5000), Math.max(w, d) * 3 + 8, 2);
  light.position.set(off[0], off[1], off[2]);
  light.userData.kitFixture = true;
  group.add(light);
  ctx.lights.push(light);
  return group;
}

/**
 * LIGHT BUDGET (polish 3). A forward renderer pays for every light in every lit pixel, and a zone full of lamps,
 * consoles and corruption patches that each own a point light washes the room evenly instead of pooling light.
 * Fixture lights (props, panel lights, corruption — tagged `userData.kitFixture`) are therefore SHARED: fixtures
 * of a similar colour within {@link SHARE_RADIUS} m become one light at their intensity-weighted centre. If the
 * zone still holds more than {@link LIGHT_BUDGET} point / spot lights, the weakest fixtures go emissive-only.
 * Lights the zone placed itself (`point`, `spot`), the white point, barriers and the key are never touched.
 */
export const LIGHT_BUDGET = 12;
export const SHARE_RADIUS = 6;

interface Fixture { light: THREE.PointLight; pos: THREE.Vector3; color: THREE.Color }

export function budgetLights(ctx: KitCtx): { shared: number; dropped: number } {
  const out = { shared: 0, dropped: 0 };
  const isLocal = (l: THREE.Light): boolean => (l as THREE.PointLight).isPointLight === true || (l as THREE.SpotLight).isSpotLight === true;
  const count = (): number => ctx.lights.filter(isLocal).length;
  if (count() <= LIGHT_BUDGET) return out;
  ctx.root.updateMatrixWorld(true);
  const remove = (l: THREE.Light): void => {
    (l as THREE.SpotLight).target?.removeFromParent();
    l.removeFromParent();
    l.dispose();
    const i = ctx.lights.indexOf(l);
    if (i >= 0) ctx.lights.splice(i, 1);
  };
  // ---- share: greedy clusters of point fixtures, strongest first ------------------------------------------
  const points: Fixture[] = ctx.lights
    .filter((l): l is THREE.PointLight => (l as THREE.PointLight).isPointLight === true && l.userData.kitFixture === true && !l.castShadow)
    .map((light) => ({ light, pos: light.getWorldPosition(new THREE.Vector3()), color: light.color.clone() }))
    .sort((a, b) => b.light.intensity - a.light.intensity);
  const clusters: Fixture[][] = [];
  for (const f of points) {
    const home = clusters.find((c) => {
      const lead = c[0];
      const dc = Math.abs(lead.color.r - f.color.r) + Math.abs(lead.color.g - f.color.g) + Math.abs(lead.color.b - f.color.b);
      return dc < 0.35 && lead.pos.distanceTo(f.pos) < SHARE_RADIUS;
    });
    if (home) home.push(f); else clusters.push([f]);
  }
  const inv = new THREE.Matrix4().copy(ctx.root.matrixWorld).invert();
  for (const c of clusters) {
    if (c.length < 2) continue;
    let sum = 0, reach = 0;
    const centre = new THREE.Vector3(), col = new THREE.Color(0, 0, 0);
    for (const f of c) { sum += f.light.intensity; centre.addScaledVector(f.pos, f.light.intensity); }
    centre.multiplyScalar(1 / Math.max(1e-6, sum));
    for (const f of c) {
      reach = Math.max(reach, f.light.distance + f.pos.distanceTo(centre));
      col.r += f.color.r * f.light.intensity; col.g += f.color.g * f.light.intensity; col.b += f.color.b * f.light.intensity;
    }
    col.multiplyScalar(1 / Math.max(1e-6, sum));
    // one light for the group: the overlap of neighbouring pools is not doubled, so a little under the sum
    const shared = new THREE.PointLight(col, sum * 0.8, reach, 2);
    shared.name = `kit-shared-light:${c.length}`;
    shared.userData.kitFixture = true;
    shared.position.copy(centre).applyMatrix4(inv);
    ctx.root.add(shared);
    for (const f of c) remove(f.light);
    ctx.lights.push(shared);
    out.shared += c.length - 1;
  }
  // ---- drop: weakest fixtures become emissive-only ------------------------------------------------------
  let over = count() - LIGHT_BUDGET;
  if (over > 0) {
    const fixtures = ctx.lights.filter((l) => isLocal(l) && l.userData.kitFixture === true && !l.castShadow)
      .sort((a, b) => a.intensity * (a as THREE.PointLight).distance - b.intensity * (b as THREE.PointLight).distance);
    for (const l of fixtures) {
      if (over <= 0) break;
      remove(l);
      over--;
      out.dropped++;
    }
  }
  return out;
}

/** The zone's environment: sky, look, ambience, music and the key directional light. */
export function applyEnv(ctx: KitCtx, o: ZoneEnvOpts): THREE.DirectionalLight | null {
  const game = ctx.game;
  const sky = isStub(game.sky) ? null : game.sky;
  try { sky?.setPreset(o.sky); } catch (err) { ctx.warn('env-sky', `sky.setPreset failed: ${String(err)}`); }
  try { if (o.look) game.render.setLook(o.look); } catch (err) { ctx.warn('env-look', `render.setLook failed: ${String(err)}`); }
  try {
    if (o.ambience) game.audio.setAmbience(o.ambience);
    if (o.music) game.audio.setMusic(o.music);
  } catch (err) { ctx.warn('env-audio', `audio environment failed: ${String(err)}`); }
  if (o.key === null) return null;

  const dir = new THREE.Vector3(0.35, 0.85, 0.3);
  let color = 0xfff1dc, intensity = 2.4;
  const sk = sky?.keyLight;
  if (sk && sk.dir && Number.isFinite(sk.dir.x)) {
    dir.copy(sk.dir);
    if (Number.isFinite(sk.color)) color = sk.color;
    if (Number.isFinite(sk.intensity) && sk.intensity > 0) intensity = sk.intensity;
  }
  const k = o.key;
  if (k) {
    if (Array.isArray(k.dirFrom) && k.dirFrom.every((v) => Number.isFinite(v))) dir.set(k.dirFrom[0], k.dirFrom[2], -k.dirFrom[1]);
    if (k.color !== undefined) color = k.color;
    if (k.intensity !== undefined) intensity = ctx.num(k.intensity, intensity, 0, 50);
  }
  if (dir.lengthSq() < 1e-6) dir.set(0.35, 0.85, 0.3);
  dir.normalize();
  if (dir.y < 0.08) { dir.y = 0.08; dir.normalize(); }
  const light = new THREE.DirectionalLight(color, intensity);
  light.name = 'kit-key';
  light.userData.kitDir = dir;
  light.position.copy(dir).multiplyScalar(60);
  ctx.root.add(light, light.target);
  ctx.lights.push(light);
  ctx.shadowLights.unshift({ light, wanted: k?.shadow !== false });
  return light;
}

/** Aim the key light at the zone and fit its shadow frustum to the bounds. */
export function fitKeyLight(light: THREE.DirectionalLight, bounds: THREE.Box3): void {
  const dir = light.userData.kitDir as THREE.Vector3;
  const c = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  const radius = Math.min(72, Math.max(8, Math.hypot(size.x, size.y, size.z) / 2));
  light.target.position.copy(c);
  light.position.copy(c).addScaledVector(dir, radius + 40);
  const cam = light.shadow.camera;
  cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
  cam.near = 1; cam.far = radius * 2 + 80;
  cam.updateProjectionMatrix();
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.05;
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}

/** Enable shadows on the first `quality.maxShadowLights` lights that asked for them; the rest stay unshadowed. */
export function applyShadowBudget(ctx: KitCtx): void {
  const q = ctx.quality();
  let left = q.shadows ? q.maxShadowLights : 0, asked = 0;
  for (const s of ctx.shadowLights) {
    if (!s.wanted) { s.light.castShadow = false; continue; }
    asked++;
    const on = left > 0;
    if (on) left--;
    s.light.castShadow = on;
    const shadow = (s.light as THREE.DirectionalLight).shadow;
    if (on && shadow) {
      const size = (s.light as THREE.DirectionalLight).isDirectionalLight ? q.shadowMapSize : Math.min(1024, q.shadowMapSize);
      if (shadow.mapSize.x !== size) { shadow.mapSize.set(size, size); shadow.map?.dispose(); shadow.map = null; }
      if (!(s.light as THREE.DirectionalLight).isDirectionalLight) { shadow.bias = -0.0015; shadow.normalBias = 0.03; }
    }
  }
  if (asked > q.maxShadowLights && q.shadows) {
    ctx.warn(`shadow-budget:${q.maxShadowLights}`, `${asked} shadow-casting lights requested, quality '${q.level}' allows ${q.maxShadowLights} — the extra lights stay unshadowed`);
  }
}
