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

/** Strength from which a flash also lifts the surface's own colour; below it a flash is a rim only. */
export const FLASH_LIFT_FROM = 0.6;

/**
 * GLSL: `aurHitFlash(uFlash, albedo, fres)` → emissive to add. `albedo` is the shaded surface's diffuse colour,
 * `fres` a pow(1 − n·v, 3) fresnel term.
 *  - At strength 1 a white flash adds 1.25 × the albedo (plate brightens but keeps its pattern) and a blooming
 *    outline on the silhouette — an enemy's hit confirm.
 *  - Up to 0.6 (the protagonist's hurt 0.55, blocks 0.4–0.6, scripted cues) it is a RIM only: a thin fresnel line
 *    on the silhouette and no colour on the body at all, so a drone volley never turns the lead into a flat red
 *    figure. Between 0.6 and 1 the lift and the wider band fade in.
 */
export const HIT_FLASH_GLSL = /* glsl */ `
vec3 aurHitFlash( vec4 f, vec3 albedo, float fres ) {
  float a = clamp( f.a, 0.0, ${FLASH_MAX_STRENGTH.toFixed(2)} );
  float k = smoothstep( ${FLASH_LIFT_FROM.toFixed(2)}, 1.0, a );
  float fr = clamp( fres, 0.0, 1.0 );
  // edge: (1 - n.v)^2.5 for a punchy confirm, narrowing to (1 - n.v)^4.5 for a rim tint
  float edge = mix( fr * sqrt( fr ), pow( fr, 0.8333 ), k );
  // body: the surface's own colour brightened in the flash colour — only for strong flashes, never a fill
  return f.rgb * a * ( edge * 1.2 + 0.02 * k ) + max( albedo, vec3( 0.0 ) ) * f.rgb * ( a * k * 1.25 );
}
`;
