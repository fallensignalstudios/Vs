/**
 * Material library contract — OWNER: materials (src/world/materials/*).
 * Procedural PBR materials for the three visual layers (King-era substrate, arriving factions, Eclipse overlay).
 * All textures are generated at boot (no external image assets). World-space/triplanar mapping so procedural
 * geometry needs no UVs.
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

export interface MaterialLibrary {
  /** Bake/generate all textures. Called once by Game.init(). */
  init(): Promise<void>;

  /** Shared instance. DO NOT mutate — use clone() for per-object variations. */
  get(id: MatId): THREE.Material;
  /** Independent copy (cheap: shares textures). Caller disposes. */
  clone<T extends THREE.Material = THREE.MeshStandardMaterial>(id: MatId, overrides?: Record<string, unknown>): T;

  /**
   * Unlit-looking emissive material; intensity > 1 blooms. Cached per (color,intensity).
   * Convention: 1.5 = soft glow, 3 = bright strip, 6+ = hot core.
   */
  emissive(color: number, intensity?: number): THREE.MeshStandardMaterial;

  /**
   * Add an animated Eclipse corruption overlay to an existing standard material instance
   * (veins creep along surfaces; amount 0..1 can be animated via the returned handle).
   */
  corrupt(material: THREE.MeshStandardMaterial, opts?: { amount?: number; scale?: number }): { amount: number };

  /** Shared uniform time for animated shader materials. Called every frame by Game. */
  update(dt: number, time: number): void;

  /** Palette constants (linear-space friendly hex) so everyone uses identical colours. */
  readonly palette: Palette;
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
