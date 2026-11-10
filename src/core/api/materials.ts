/**
 * Material library contract — OWNER: materials (src/world/materials/*).
 * Procedural PBR materials for the three visual layers (King-era substrate, arriving factions, Eclipse overlay).
 * All textures are generated at boot (no external image assets). World-space/triplanar mapping so procedural
 * geometry needs no UVs.
 *
 * QUICK GUIDE FOR CALLERS
 *  - Geometry needs NORMALS but no UVs. Textures are projected in WORLD space by default, sized in metres
 *    (a wall is panelled every 2.4 × 3.6 m, a black-stone floor slab is 4 m, …) so merged static kit geometry
 *    lines up automatically and never shows a seam between neighbouring meshes.
 *  - Anything that MOVES (doors, lifts, drones, weapons, carried props, debris) must use object-space mapping or
 *    the texture will swim through it: `mats.getLocal(id)` (shared) or `mats.clone(id, { objectSpace: true })`.
 *    Object-space mapping still measures in metres (it compensates for the mesh's scale). Skinned meshes are
 *    switched to object space automatically. `skin`, `hair`, `domCloth`, `refCloth`, `rubber` and `shieldEnergy`
 *    are object-space by default.
 *  - `get()` works before `init()` has finished (flat placeholder maps are swapped for the real ones in place).
 *    Textures follow `game.render.quality` (`textureSize`, `anisotropy`): a quality change after `init()` re-bakes
 *    in place the next time the game is NOT in the 'playing' phase (title / pause / loading), never mid-combat.
 *  - The shared instances are patched through `onBeforeCompile`. If you also need `onBeforeCompile` on one of
 *    them (or on a clone), just assign it: the library keeps its own patches and runs yours after them, and
 *    `material.clone()` keeps the patches. Do not replace three's `#include <...>` tokens you do not own.
 *  - Emissive convention: `emissiveIntensity` 1.5 soft glow · 3 bright strip · 6+ hot core. The glow materials
 *    (`goldChannel`, `whiteLight`, `domAmberGlow`, `refBlueGlow`, `eclipseVein`) are ordinary standard materials:
 *    override `emissive` / `emissiveIntensity` on a clone to recolour or dim them; the pattern follows.
 *  - Transparent materials (`frostIce`, `glass`, `hologram`, `shieldEnergy`, `quarantineBarrier`) do not write
 *    depth; give their meshes a sensible `renderOrder` if several overlap.
 */
import type * as THREE from 'three';

export type MatId =
  // King-era substrate — upper: white-gold ribs and immense spans
  | 'whiteGold'          // warm ivory ceramic-metal, ribs/spans/walls
  | 'whiteGoldPanel'     // panelled wall variant with fine seams
  | 'whiteGoldFloor'     // walkable upper floor, slightly worn, semi-gloss
  | 'goldTrim'           // polished gold metal trim
  | 'goldDark'           // aged darker gold/bronze-gold for recessed structure
  // King-era substrate — lower: polished black stone with narrow angular gold channels
  | 'blackStone'         // walls/pylons
  | 'blackStoneFloor'    // mirror-polished walkable floor (register as reflective floor)
  | 'goldChannel'        // emissive narrow gold light channel ("light as information")
  | 'whiteLight'         // emissive white-gold light panel / white point
  // Dominion equipment — bronze, oxblood, black, amber
  | 'domBronze' | 'domOxblood' | 'domBlack' | 'domAmberGlow' | 'domCloth'
  // Reformation equipment — navy, slate, sterile metal, cold blue-white
  | 'refNavy' | 'refSlate' | 'refSteel' | 'refBlueGlow' | 'refCloth'
  // Frozen atmosphere (Z03)
  | 'frostIce'           // translucent frozen atmosphere panels (conduits shine through)
  | 'frostRime'          // frosted surface coating
  // Eclipse overlay
  | 'eclipseTissue'      // dark tissue appropriating structure
  | 'eclipseVein'        // emissive violet vein
  | 'eclipsePlate'       // appropriated armour/remains plating (elite)
  // Misc
  | 'glass'              // clear architectural glass (observation wall, transparent ceiling)
  | 'hologram'           // additive data display
  | 'shieldEnergy'       // Enforcer shield / protective fields
  | 'quarantineBarrier'  // white-gold isolation barrier light wall
  | 'darkWood'           // observation table
  | 'agedLeather'        // six age-polished chairs
  | 'rubble' | 'scorched' | 'rubber' | 'skin' | 'hair'
  | 'woundBlack';        // pure light-absorbing black

export interface TriplanarOpts {
  /** world metres per texture repeat */
  scale?: number;
}

/**
 * Extra keys `MaterialLibrary.clone()` understands in `overrides`, next to ordinary three.js material properties
 * (`color`, `roughness`, `metalness`, `emissive`, `emissiveIntensity`, `opacity`, `side`, `envMapIntensity`, …).
 * Unknown keys are ignored with a single console warning.
 */
export type MatOverrides = Record<string, unknown> & {
  /** true = object-space triplanar (moving meshes); false = world-space. Default depends on the material. */
  objectSpace?: boolean;
} & { [K in MatParam]?: number };

/**
 * Named shader parameters, settable at clone time (`clone(id, { pulse: 0 })`) or later with
 * `MaterialLibrary.setParam(material, name, value)`. A parameter only exists on the materials listed.
 *
 *  - `scale`            metres per texture repeat — every textured material
 *  - `normalStrength`   normal-map strength (1 = authored) — every textured material
 *  - `maskGlow`         emissive intensity of the family accent mask — `eclipseTissue` (veins), `eclipsePlate`
 *                       (cracks), `scorched` (embers; 0 = cold)
 *  - `maskPulse`        0…1 pulse depth of that glow
 *  - `pulse`            0…1 depth of the travelling pulse — glow materials (`goldChannel` 0 = steady light)
 *  - `pulseSpeed`       m/s — glow materials
 *  - `pulseWavelength`  metres between pulse packets — `goldChannel`, `eclipseVein`
 *  - `pattern`          strength of the fine pattern (data ticks / louvres / diode segments) — glow materials
 *  - `flicker`          0…1 slow flicker — `domAmberGlow`, `hologram`
 *  - `amount`           0…1 raised/lowered — `quarantineBarrier`
 *  - `reveal`           0…1 fade of the display (use this, not `material.visible`) — `hologram`
 *  - `gain`             HDR brightness — `hologram`, `shieldEnergy`, `quarantineBarrier`
 *  - `integrity`        1 = intact → 0 = cells flicker out — `shieldEnergy`
 *  - `rim`              fresnel rim strength — `frostIce`, `glass`
 *  - `iceOpacity` / `iceCloud`  clear-ice opacity / extra opacity of trapped cloud — `frostIce`
 *  - `sparkle`          glint intensity — `frostIce`, `frostRime`
 *  - `translucency`     back-light strength — `frostIce`, `frostRime`, `skin`
 *  - `corruption`       0…1, same value as the `corrupt()` handle — any corrupted material
 *  - `corruptionGlow`   emissive intensity of the corruption veins (default 2.4) — any corrupted material
 */
export type MatParam =
  | 'scale' | 'normalStrength' | 'maskGlow' | 'maskPulse'
  | 'pulse' | 'pulseSpeed' | 'pulseWavelength' | 'pattern' | 'flicker'
  | 'amount' | 'reveal' | 'gain' | 'integrity'
  | 'rim' | 'iceOpacity' | 'iceCloud' | 'sparkle' | 'translucency' | 'corruption' | 'corruptionGlow';

/** The baked maps behind a textured material, for custom shaders that want the same surface. */
export interface MatTextureSet {
  /** sRGB base colour; alpha = height */
  albedo: THREE.Texture;
  /** tangent-space normal (+Z out) */
  normal: THREE.Texture;
  /** R = ambient occlusion, G = roughness variation (0.5 = nominal), B = metalness multiplier, A = accent mask */
  orm: THREE.Texture;
  /** the tile size the material was authored for */
  metresPerRepeat: number;
}

export interface MaterialLibrary {
  /** Bake/generate all textures. Called once by Game.init(). */
  init(): Promise<void>;

  /** Shared instance. DO NOT mutate — use clone() for per-object variations. */
  get(id: MatId): THREE.Material;
  /**
   * Independent copy (cheap: shares textures). Caller disposes.
   * `overrides` takes ordinary three.js material properties plus the keys of {@link MatOverrides}
   * (`objectSpace`, and the named shader parameters of {@link MatParam}); unknown keys warn once and are ignored.
   * Pass the matching class as `T` for non-standard bases: `clone<THREE.MeshBasicMaterial>('hologram')`
   * (`hologram`, `shieldEnergy`, `quarantineBarrier`, `woundBlack` are MeshBasicMaterial; `blackStone*`,
   * `domOxblood`, `domCloth`, `refCloth`, `glass` are MeshPhysicalMaterial; everything else MeshStandardMaterial).
   */
  clone<T extends THREE.Material = THREE.MeshStandardMaterial>(id: MatId, overrides?: Record<string, unknown>): T;

  /**
   * Unlit-looking emissive material; intensity > 1 blooms. Cached per (color,intensity).
   * Convention: 1.5 = soft glow, 3 = bright strip, 6+ = hot core.
   */
  emissive(color: number, intensity?: number): THREE.MeshStandardMaterial;

  /**
   * Add an animated Eclipse corruption overlay to an existing standard material instance
   * (veins creep along surfaces; amount 0..1 can be animated via the returned handle).
   * Works on any MeshStandard/PhysicalMaterial, including ones this library did not create (their own
   * `onBeforeCompile` is kept). `scale` = metres per repeat of the vein network (default 1.8). Corrupt a
   * `clone()`, not a shared instance — the overlay changes the instance for every mesh that uses it. Calling it
   * again on the same instance returns the same handle. Violet only where a real source exists (BRIEF §4).
   */
  corrupt(material: THREE.MeshStandardMaterial, opts?: { amount?: number; scale?: number }): { amount: number };

  /** Shared uniform time for animated shader materials. Called every frame by Game. */
  update(dt: number, time: number): void;

  /** Palette constants (linear-space friendly hex) so everyone uses identical colours. */
  readonly palette: Palette;

  // ---- added by the materials owner ---------------------------------------------------------------------

  /** true once `init()` has baked the real textures (before that, materials render with flat placeholder maps). */
  readonly ready: boolean;
  /** 0…1 progress of `init()` — for the loading screen. */
  readonly progress: number;

  /**
   * Shared OBJECT-SPACE variant of a material: the texture is projected in the mesh's local frame (in metres),
   * so it stays glued to doors, lifts, drones, weapons, armour and other moving things. DO NOT mutate.
   */
  getLocal(id: MatId): THREE.Material;

  /** Set a named shader parameter (see {@link MatParam}) on a material from `get` / `getLocal` / `clone`. */
  setParam(material: THREE.Material, name: MatParam | (string & {}), value: number): void;

  /**
   * Start a hit ripple on a `shieldEnergy` material: a ring expands from `localPoint` and lights the hex cells it
   * crosses for ~0.7 s. `localPoint` is in the shield mesh's LOCAL space (`mesh.worldToLocal(p.clone())`), in
   * metres. One ripple at a time per material instance — use `clone('shieldEnergy')` per shield.
   */
  rippleShield(material: THREE.Material, localPoint: { x: number; y: number; z: number }, strength?: number): void;

  /** The baked maps behind a textured MatId (null for untextured ones such as glows, glass, hologram). */
  textures(id: MatId): MatTextureSet | null;
}

export interface Palette {
  whiteGold: number; gold: number; goldLight: number; goldDeep: number;
  blackStone: number;
  domBronze: number; domOxblood: number; domBlack: number; domAmber: number;
  refNavy: number; refSlate: number; refSteel: number; refBlue: number;
  frost: number; frostDeep: number;
  cinder: number; cinderHot: number;
  eclipseViolet: number; eclipseDeep: number;
  redRemnant: number; whiteRemnant: number;
}

/** Canonical palette values. Subsystems that cannot reach the library (UI, CSS) should mirror these. */
export const PALETTE: Palette = {
  whiteGold: 0xd9d2c0, gold: 0xc9a45c, goldLight: 0xffe2a8, goldDeep: 0x8a6a2e,
  blackStone: 0x0b0c10,
  domBronze: 0x8a5a2b, domOxblood: 0x5a1616, domBlack: 0x121012, domAmber: 0xffa033,
  refNavy: 0x1b2a44, refSlate: 0x3a4656, refSteel: 0xc5ccd4, refBlue: 0xa8d8ff,
  frost: 0xcfeeff, frostDeep: 0x7fd0ff,
  cinder: 0xff6a1a, cinderHot: 0xffb347,
  eclipseViolet: 0x7a3cff, eclipseDeep: 0x2a0f4d,
  redRemnant: 0xff3b2a, whiteRemnant: 0xf4f8ff,
};
