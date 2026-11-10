/**
 * The hit flash every character shader shares (procedural humanoids, generated GLB bodies, creatures).
 *
 * A flash is an EDGE tint (fresnel) plus a lift of the surface's OWN albedo in the flash colour. At its peak the
 * figure's design still reads — plate, cloth, trim and painted lights keep their contrast — and dark armour never
 * turns into a flat coloured silhouette. `uFlash.rgb` is the colour (linear), `uFlash.a` the current strength:
 * `CharacterVisual.flash(color, seconds, strength)` sets it to `strength` and it decays linearly to 0.
 */

/** Strength used when `flash()` is called without one: a punchy enemy hit confirm. */
export const FLASH_DEFAULT_STRENGTH = 1;
/** Upper bound of a flash's strength. */
export const FLASH_MAX_STRENGTH = 1.5;

/** Sanitise a `flash()` strength argument (undefined / NaN → default; clamped to 0..FLASH_MAX_STRENGTH). */
export function flashStrength(strength: number | undefined): number {
  if (strength === undefined || !Number.isFinite(strength)) return FLASH_DEFAULT_STRENGTH;
  return Math.max(0, Math.min(FLASH_MAX_STRENGTH, strength));
}

/**
 * GLSL: `aurHitFlash(uFlash, albedo, fres)` → emissive to add. `albedo` is the shaded surface's diffuse colour,
 * `fres` a pow(1 − n·v, 3) fresnel term. At strength 1 a white flash adds 1.25 × the albedo (so plate brightens
 * but keeps its pattern) and a blooming outline on the silhouette; at the protagonist's 0.55 it is an edge tint
 * and a faint lift.
 */
export const HIT_FLASH_GLSL = /* glsl */ `
vec3 aurHitFlash( vec4 f, vec3 albedo, float fres ) {
  float a = clamp( f.a, 0.0, ${FLASH_MAX_STRENGTH.toFixed(2)} );
  // edge: a fresnel band, (1 - n.v)^2.5, that outlines the silhouette; body: the surface's own colour
  // brightened in the flash colour, never a fill
  float edge = pow( clamp( fres, 0.0, 1.0 ), 0.8333 );
  return f.rgb * a * ( edge * 1.2 + 0.02 ) + max( albedo, vec3( 0.0 ) ) * f.rgb * a * 1.25;
}
`;
