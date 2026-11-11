/**
 * ADDED (polish 4): the inlay helper — fine inlaid gold lines drawn by the SHADER on one flat quad laid on a floor:
 * concentric rings, a star, parallel lines, a grid, a cut-corner border, or the `rose` (rings + star + spokes)
 * of the crownmark and overlook floors. The lines are polished gold metal (lit, metallic, roughness ~0.18): they
 * show by reflecting the room and the lights, never by glowing (unless `glow` asks for a little). Anti-aliased
 * analytically at any distance (no shimmering sub-pixel ribbons). One draw call per inlay, no geometry beyond a quad,
 * no collider, kept out of the mirror pass (it lies on the mirror plane).
 *
 *   b.inlay({ x: 27, n: 27, h: 0.002, kind: 'rose', r: 9, count: 4, points: 5 });       // the chamber floor
 *   b.inlay({ x: 35, n: 24, kind: 'rings', r: 7, count: 5, width: 0.03 });              // quarantine rings
 *   b.inlay({ x: 20, n: 10, kind: 'lines', w: 3, d: 30, count: 2, width: 0.025 });       // a pair of rails
 */
import * as THREE from 'three';
import type { InlayKind, InlayOpts } from '@/core/api';
import { RENDER_LAYERS } from '@/core/api/render';
import type { KitCtx } from './core';



const KIND: Record<InlayKind, number> = { rings: 0, star: 1, lines: 2, grid: 3, border: 4, rose: 5 };

const PARS = /* glsl */ `
varying vec2 vInlay;
uniform vec4 uInlayA;   // x kind · y width · z count · w points
uniform vec4 uInlayB;   // x radius · y inner fraction · z half w · w half d
float aurRingD( float l, float r0, float r1, float n ) {
  if ( n < 1.5 ) return abs( l - r1 );
  float sp = ( r1 - r0 ) / ( n - 1.0 );
  float k = clamp( floor( ( l - r0 ) / sp + 0.5 ), 0.0, n - 1.0 );
  return abs( l - ( r0 + k * sp ) );
}
float aurStarD( vec2 p, float r, float n, float m ) {
  // outline of a regular n-pointed star (iq's sdStar, abs = the line itself)
  float an = 3.14159265 / n, en = 3.14159265 / m;
  vec2 acs = vec2( cos( an ), sin( an ) ), ecs = vec2( cos( en ), sin( en ) );
  float bn = mod( atan( p.x, p.y ), 2.0 * an ) - an;
  p = length( p ) * vec2( cos( bn ), abs( sin( bn ) ) );
  p -= r * acs;
  p += ecs * clamp( - dot( p, ecs ), 0.0, r * acs.y / ecs.y );
  return abs( length( p ) * sign( p.x ) );
}
float aurInlayD( vec2 p ) {
  float kind = uInlayA.x, n = uInlayA.z, R = uInlayB.x;
  float l = length( p );
  if ( kind < 0.5 ) return aurRingD( l, R * uInlayB.y, R, n );
  if ( kind < 1.5 ) return min( aurStarD( p, R, uInlayA.w, 2.0 + uInlayA.w * 0.3 ), abs( l - R ) );
  if ( kind < 2.5 ) {
    float sp = 2.0 * uInlayB.z / max( n, 1.0 );
    float x = p.x + uInlayB.z - sp * 0.5;
    return abs( x - sp * clamp( floor( x / sp + 0.5 ), 0.0, n - 1.0 ) );
  }
  if ( kind < 3.5 ) {
    vec2 q = abs( mod( p + n * 0.5, vec2( n ) ) - n * 0.5 );
    return min( q.x, q.y );
  }
  if ( kind < 4.5 ) {
    // a rectangle with 45° cut corners, inset by two line widths from the quad's edge
    vec2 b = vec2( uInlayB.z, uInlayB.w ) - uInlayA.y * 2.0, q = abs( p ) - b;
    float c = min( b.x, b.y ) * 0.12;
    return abs( max( max( q.x, q.y ), ( abs( p.x ) + abs( p.y ) - b.x - b.y + c ) * 0.7071 ) );
  }
  // rose: rings, a star between the inner rings, spokes between the star tips and the outer ring
  float d = aurRingD( l, R * uInlayB.y, R, n );
  float rs = R * mix( uInlayB.y, 1.0, 0.62 );
  d = min( d, aurStarD( p, rs, uInlayA.w, 2.0 + uInlayA.w * 0.3 ) );
  float an = 6.2831853 / uInlayA.w, a = mod( atan( p.x, p.y ) + an * 0.5, an ) - an * 0.5;
  float spoke = abs( sin( a ) * l );
  if ( l > rs && l < R ) d = min( d, spoke );
  return d;
}
`;

const FRAG = /* glsl */ `
{
  float aurD = aurInlayD( vInlay );
  float aurW = uInlayA.y * 0.5;
  float aurFw = max( fwidth( aurD ), 1e-5 );
  float aurCover = 1.0 - smoothstep( aurW - aurFw * 0.75, aurW + aurFw * 0.75, aurD );
  // a sub-pixel line fades to its average coverage instead of breaking up
  aurCover *= min( 1.0, uInlayA.y / ( aurFw * 1.5 ) );
  if ( aurCover < 0.003 ) discard;
  diffuseColor.a *= aurCover;
}
`;

/** A shader-drawn gold inlay (see the module header). Returns the mesh (already added to the zone root). */
export function buildInlay(ctx: KitCtx, o: InlayOpts): THREE.Mesh {
  const kind = KIND[o.kind] ?? 0;
  const R = ctx.num(o.r, 4, 0.1, 200);
  const round = o.kind === 'rings' || o.kind === 'star' || o.kind === 'rose';
  const w = round ? R * 2 + 0.2 : ctx.num(o.w, R * 2, 0.1, 400), d = round ? R * 2 + 0.2 : ctx.num(o.d, R * 2, 0.1, 400);
  const width = ctx.num(o.width, 0.028, 0.004, 1);
  const count = ctx.num(o.count, o.kind === 'grid' ? 2 : o.kind === 'lines' ? 2 : 4, 1, 200);
  const glow = ctx.num(o.glow, 0, 0, 6), color = ctx.num(o.color, 0xe8c06a);
  const mat = ctx.own(new THREE.MeshStandardMaterial({
    color, metalness: 1, roughness: ctx.num(o.roughness, 0.18, 0.02, 1), transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    emissive: color, emissiveIntensity: glow,
  }));
  mat.name = `kit-inlay-decal:${o.kind}`;
  const A = new THREE.Vector4(kind, width, count, ctx.num(o.points, 5, 3, 24));
  const B = new THREE.Vector4(R, ctx.num(o.inner, 0.25, 0, 0.98), w / 2, d / 2);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInlayA = { value: A };
    shader.uniforms.uInlayB = { value: B };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vInlay;\nattribute vec2 aPlan;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInlay = aPlan;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>\n${FRAG}`);
  };
  mat.customProgramCacheKey = () => 'kit-inlay-decal-1';
  // a flat quad; `aPlan` keeps the plan frame for the shader (x east, y north, before yaw)
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const plan = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { plan[i * 2] = pos.getX(i); plan[i * 2 + 1] = -pos.getZ(i); }
  geo.setAttribute('aPlan', new THREE.BufferAttribute(plan, 2));
  const mesh = new THREE.Mesh(ctx.own(geo), mat);
  mesh.name = `inlay:${o.kind}`;
  mesh.position.copy(ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0) + 0.003));
  mesh.rotation.y = ctx.yaw(ctx.num(o.yawDeg, 0));
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = 2;
  mesh.layers.set(RENDER_LAYERS.noReflect);
  ctx.root.add(mesh);
  return mesh;
}
