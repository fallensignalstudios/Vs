/**
 * Shader injection for polished-floor reflections.
 *
 * Patches a MeshStandard/PhysicalMaterial (in place, chaining any existing onBeforeCompile) so upward-facing
 * fragments at the active mirror-plane height replace their environment-map radiance with the planar
 * reflection texture. Because the replacement happens BEFORE three's indirect-specular BRDF, the reflection is
 * fresnel- and roughness-weighted exactly like the env map it replaces (metalness, F0, roughness map all apply).
 *
 * Sampling: the mirror camera is the main camera reflected about the plane (and flipped in X to stay
 * right-handed), so a floor fragment finds its reflection at its own screen position with x mirrored — no
 * texture matrix. Blur = mip level chosen from roughness² × how far the reflected ray travelled beyond the
 * floor (contact hardening: things touching the floor reflect sharply, the ceiling reflects soft), stretched
 * along the screen projection of world-up at grazing angles like a real glossy floor.
 */
import type * as THREE from 'three';

export interface ReflectionGlobals {
  /** 0 = off (env map only); otherwise the fade weight 0..1 */
  uReflOn: { value: number };
  uReflTex: { value: THREE.Texture | null };
  uReflDepth: { value: THREE.Texture | null };
  /** inverse (oblique) projection of the mirror camera */
  uReflProjInv: { value: THREE.Matrix4 };
  /** row 1 of the main camera's matrixWorld: world Y = dot(row, vec4(viewPos, 1)) */
  uReflRowY: { value: THREE.Vector4 };
  /** x: plane height, y: height tolerance, z: max mip level, w: mirror target height in px */
  uReflParams: { value: THREE.Vector4 };
  /** 1 / size of the buffer the main view is rendered into */
  uReflInvRes: { value: THREE.Vector2 };
  /** unit screen-space direction of world up (x mirrored like the texture) — the glossy stretch axis */
  uReflAxis: { value: THREE.Vector2 };
}

export interface ReflectionLocals {
  uReflStrength: { value: number };
  /** < 0: use the material's per-pixel roughness */
  uReflRough: { value: number };
}

const DECL = /* glsl */ `
uniform float uReflOn;
uniform sampler2D uReflTex;
uniform highp sampler2D uReflDepth;
uniform mat4 uReflProjInv;
uniform vec4 uReflRowY;
uniform vec4 uReflParams;
uniform vec2 uReflInvRes;
uniform vec2 uReflAxis;
uniform float uReflStrength;
uniform float uReflRough;
`;

const BODY = /* glsl */ `
#ifdef RE_IndirectSpecular
if ( uReflOn > 0.0 ) {
  float aurUp = dot( nonPerturbedNormal, vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] ) );
  float aurY = dot( uReflRowY, vec4( - vViewPosition, 1.0 ) );
  float aurRough = uReflRough >= 0.0 ? uReflRough : material.roughness;
  float aurW = smoothstep( 0.9, 0.985, aurUp )
    * ( 1.0 - smoothstep( uReflParams.y, uReflParams.y * 2.0, abs( aurY - uReflParams.x ) ) )
    * ( 1.0 - smoothstep( 0.4, 0.7, aurRough ) )
    * min( uReflStrength, 1.0 ) * uReflOn;
  if ( aurW > 0.003 ) {
    vec2 aurUv = gl_FragCoord.xy * uReflInvRes;
    aurUv.x = 1.0 - aurUv.x;
    float aurDist = length( vViewPosition );
    // distance the reflected ray travels beyond the floor before it hits something
    float aurZ = texture2D( uReflDepth, aurUv ).r;
    vec4 aurV = uReflProjInv * vec4( aurUv * 2.0 - 1.0, aurZ * 2.0 - 1.0, 1.0 );
    float aurHit = length( aurV.xyz / max( aurV.w, 1e-6 ) );
    // nothing hit (sky): treat as infinitely far
    float aurRel = aurZ > 0.99995 ? 1.0 : clamp( ( aurHit - aurDist ) / max( aurHit, 0.001 ), 0.0, 1.0 );
    // ripple from the normal map (view-space xy ≈ screen xy; x mirrored like the texture)
    aurUv += ( normal.xy - nonPerturbedNormal.xy ) * vec2( - 1.0, 1.0 ) * ( 0.02 + 0.3 * aurRel );
    float aurNoV = max( dot( nonPerturbedNormal, geometryViewDir ), 0.14 );
    // blur cone as a fraction of the frame height: GGX lobe half-width ≈ 1.3 α, α = roughness²
    float aurCone = aurRough * aurRough * aurRel * 1.1;
    float aurLod = clamp( log2( 1.0 + aurCone * uReflParams.w ), 0.0, uReflParams.z );
    // five taps: a small rotated footprint one mip-texel wide (hides the box filter of the mip chain) that
    // stretches along the screen direction of world-up as the view grazes the floor
    float aurTexel = exp2( aurLod ) / uReflParams.w;
    vec2 aurToUv = vec2( uReflInvRes.x / uReflInvRes.y, 1.0 );
    vec2 aurAlong = uReflAxis * aurToUv * ( aurCone * min( 1.0 / aurNoV - 1.0, 5.0 ) * 0.6 + aurTexel * 0.6 );
    vec2 aurSide = vec2( uReflAxis.y, - uReflAxis.x ) * aurToUv * aurTexel * 0.6;
    vec3 aurCol = textureLod( uReflTex, aurUv, aurLod ).rgb * 0.28;
    aurCol += textureLod( uReflTex, aurUv + aurAlong * 0.5 + aurSide, aurLod ).rgb * 0.22;
    aurCol += textureLod( uReflTex, aurUv - aurAlong * 0.5 - aurSide, aurLod ).rgb * 0.22;
    aurCol += textureLod( uReflTex, aurUv + aurAlong - aurSide * 0.5, aurLod ).rgb * 0.14;
    aurCol += textureLod( uReflTex, aurUv - aurAlong + aurSide * 0.5, aurLod ).rgb * 0.14;
    radiance = mix( radiance, aurCol * max( uReflStrength, 1.0 ), aurW );
  }
}
#endif
`;

const ANCHOR = '#include <lights_fragment_maps>';
const MAIN = /void\s+main\s*\(\s*\)\s*\{/;
const patched = new WeakMap<THREE.Material, ReflectionLocals>();
let warnedAnchor = false;

/**
 * Patch `material` once (later calls return the same uniform holders). Returns null when the material is not
 * a standard/physical material — callers fall back to the env map.
 */
export function patchFloorMaterial(material: THREE.Material, globals: ReflectionGlobals): ReflectionLocals | null {
  const existing = patched.get(material);
  if (existing) return existing;
  if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial !== true) return null;

  const locals: ReflectionLocals = { uReflStrength: { value: 1 }, uReflRough: { value: -1 } };
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;

  material.onBeforeCompile = function (this: THREE.Material, shader, renderer): void {
    prevCompile.call(this, shader, renderer);
    const frag = shader.fragmentShader;
    if (!frag.includes(ANCHOR) || !MAIN.test(frag)) {
      if (!warnedAnchor) {
        warnedAnchor = true;
        console.warn('[render] reflective floor: material shader has no lights_fragment_maps chunk — env map only');
      }
      return;
    }
    Object.assign(shader.uniforms, globals, locals);
    shader.fragmentShader = frag
      .replace(MAIN, (m) => `${DECL}\n${m}`)
      .replace(ANCHOR, `${ANCHOR}\n${BODY}`);
  };
  material.customProgramCacheKey = function (this: THREE.Material): string {
    return `${prevKey.call(this)}|aurRefl2`;
  };
  material.needsUpdate = true;
  patched.set(material, locals);
  return locals;
}
