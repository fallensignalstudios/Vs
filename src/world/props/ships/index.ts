/**
 * Generated ships (OWNER: ships) — the four forge-wave-5 GLBs as on-screen craft, used by the hero prop
 * `departureShip` (../ship.ts) and the scenic `sky.scenic.ship()` pieces (src/render/sky/scenic/ships.ts).
 * See catalog.ts (files, scale, facing, engine points), model.ts (one ship: hull + glow + LOD), glow.ts (engine
 * light), escort.ts (escort formation) and loader.ts (session cache, procedural fallback on failure).
 */
export { SHIP_MODELS, SHIP_MODEL_IDS, expandGlow, shipScale, type GlowElement, type GlowShape, type ShipFaction, type ShipModelId, type ShipModelSpec } from './catalog';
export { EscortFlight, type EscortOpts } from './escort';
export { buildGlow, patchHull, type GlowUniforms, type HullLook, type HullShade, type HullUniforms, type ShipHaze } from './glow';
export { parseShipLod, preloadShips, requestShip, setShipLoadingDisabled, shipLoadingEnabled, shipTemplate, shipUnavailable, type ShipTemplate } from './loader';
export { GeneratedShip, SHIP_LOD_SCREEN, ShipLod, setShipLodEnabled, type GeneratedShipOpts, type ShipFrame } from './model';
