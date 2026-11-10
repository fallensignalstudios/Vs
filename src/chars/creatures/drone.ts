/**
 * Reformation security drone (`secDrone`) and its contaminated state variant (`contamDrone`).
 *
 * One chassis: an armoured octagonal core with a single lens eye in a steel collar, an under-slung gimballed
 * muzzle, clip-on side modules carrying four articulated stabiliser vanes, a belly repulsor and a louvred
 * rear cooling vent (the weak point). The contaminated variant is the same machine with Eclipse tissue
 * threading its seams, a pried-up carapace, dangling filaments, a drooping vane that twitches on the Eclipse
 * cadence and a flickering lens — recognisable by listing silhouette and broken rhythm, not only by violet.
 *
 * Model space: centred on the hover point (root origin), front = −Z, ≈1.1 m vane span.
 */
import * as THREE from 'three';
import type { CharacterCreateOpts, Game } from '@/core/api';
import type { DroneVisual } from '@/core/api/creatures';
import { clamp01, damp } from '@/core/mathx';
import { groundDeficit, impact, keys, noise1, probe, rot, move, win, type GroundProbe } from './core/anim';
import { CreatureBase, type ActionDef, type Slot } from './core/base';
import { arcPath, band, blob, box, cyl, plate, prism, sphere, T, torus, tube, type Pt2, type Pt3 } from './core/geo';
import { P, tint } from './core/palette';
import { getTemplate, RigBuilder, type RigTemplate } from './core/rig';

const G = { eye: 1, vent: 2, muzzle: 3, lights: 4, repulsor: 5, growth: 6 } as const;

const VANES = ['UR', 'UL', 'LR', 'LL'] as const;
/** contaminated filament lengths (metres) */
const FIL_LEN = [0.46, 0.34, 0.26];
const DOWN = new THREE.Vector3(0, -1, 0);
const _mb = new THREE.Matrix4(), _qb = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _pf = new THREE.Vector3(), _df = new THREE.Vector3();

function mul(...m: THREE.Matrix4[]): THREE.Matrix4 {
  const out = new THREE.Matrix4();
  for (const x of m) out.multiply(x);
  return out;
}

function buildDrone(contam: boolean): RigTemplate {
  const b = new RigBuilder();
  const HALF_PI = Math.PI / 2;
  b.bone('body', null, [0, 0, 0]);
  b.bone('eye', 'body', [0, 0.005, -0.24]);
  b.bone('gun', 'body', [0, -0.135, -0.08]);
  for (let i = 0; i < 3; i++) b.bone('flap' + i, 'body', [0, 0.058 - i * 0.04, 0.312]);
  b.bone('vaneUR', 'body', [0.235, 0.05, 0.04]);
  b.bone('vaneUL', 'body', [-0.235, 0.05, 0.04]);
  b.bone('vaneLR', 'body', [0.225, -0.05, 0.1]);
  b.bone('vaneLL', 'body', [-0.225, -0.05, 0.1]);
  b.bone('tipUR', 'vaneUR', [0.33, 0.1, 0.07]);
  b.bone('tipUL', 'vaneUL', [-0.33, 0.1, 0.07]);
  b.bone('tipLR', 'vaneLR', [0.29, -0.1, 0.13]);
  b.bone('tipLL', 'vaneLL', [-0.29, -0.1, 0.13]);
  b.bone('carapace', 'body', [0, 0.13, 0.2]);
  b.bone('antenna', 'body', [0.07, 0.14, 0.16]);

  // --- core: chamfered octagonal hull, front collar, layered belly keel
  const oct: Pt2[] = [[0.17, -0.062], [0.17, 0.062], [0.108, 0.125], [-0.108, 0.125], [-0.17, 0.062], [-0.17, -0.062], [-0.108, -0.125], [0.108, -0.125]];
  b.add('body', P.refSlate, prism(oct, 0.46, 0.022), T(0, 0, 0.02));
  b.add('body', P.refSteel, cyl(0.15, 0.118, 0.07, 8, 0.012, Math.PI / 8), T(0, 0, -0.235, -HALF_PI, 0, 0, [1, 1, 0.8]));
  b.add('body', P.refDark, box(0.2, 0.03, 0.34, 0.01), T(0, -0.132, 0.03));
  // panel breaks: recessed dark strips on the hull flanks
  b.addPair('body', 'body', P.refDark, box(0.006, 0.075, 0.3, 0.002), T(0.171, 0, 0.04));
  // --- armoured carapace (pried up and skewed by growth on the contaminated machine)
  const cara: Pt2[] = [[-0.135, -0.23], [0.135, -0.23], [0.165, -0.03], [0.125, 0.17], [0.05, 0.25], [0.03, 0.2], [-0.03, 0.2], [-0.05, 0.25], [-0.125, 0.17], [-0.165, -0.03]];
  const caraM = contam ? T(-0.012, 0.158, 0.03, -HALF_PI + 0.05, 0, 0.13) : T(0, 0.137, 0.02, -HALF_PI, 0, 0);
  b.add('carapace', P.refNavy, plate(cara, 0.024, 0.009, 0.26, 0, 0.004), caraM);
  // dorsal fin + brow
  b.add('carapace', P.refNavy, prism([[-0.15, 0], [0.07, 0], [0.0, 0.045], [-0.1, 0.1], [-0.16, 0.092]], 0.018, 0.006), mul(caraM, T(0, -0.06, 0.01, 0, HALF_PI, HALF_PI)));
  b.add('body', P.refNavy, box(0.2, 0.03, 0.05, 0.012), T(0, 0.108, -0.245, 0.35, 0, 0));
  // --- side modules with clamps (the vanes mount on these)
  b.addPair('body', 'body', P.refNavy, box(0.075, 0.11, 0.24, 0.016), T(0.205, 0, 0.07));
  b.addPair('body', 'body', P.refSteel, box(0.084, 0.118, 0.026, 0.006), T(0.205, 0, 0.0));
  b.addPair('body', 'body', P.refSteel, box(0.084, 0.118, 0.026, 0.006), T(0.205, 0, 0.15));
  for (let i = 0; i < 3; i++) b.addPair('body', 'body', P.refDark, box(0.005, 0.012, 0.085, 0.002), T(0.2435, 0.03 - i * 0.026, 0.075));
  // belt line: one long running light down each side module (the read at 8–12 m on a dark stage)
  b.addPair('body', 'body', P.refGlow, box(0.007, 0.016, 0.21, 0.002), T(0.2437, -0.043, 0.07), { group: G.lights });
  // --- the eye: steel bezel, dark lens, lit iris + pupil
  b.add('eye', P.refSteel, band(0.098, 0.034, 0.05, 16, 0.009), T(0, 0.005, -0.275, -HALF_PI, 0, 0));
  b.add('eye', P.refNavy, band(0.125, 0.022, 0.03, 8, 0.007), T(0, 0.005, -0.262, -HALF_PI, 0, 0));
  b.add('eye', P.glass, sphere(0.084, 2), T(0, 0.005, -0.272, 0, 0, 0, [1, 1, 0.52]), { crease: 180 });
  const iris = contam ? tint(P.violetEye, { e: 2.4 }) : tint(P.refGlow, { e: 1.9 });
  b.add('eye', iris, torus(0.05, 0.0075, 20, 6), T(0, 0.005, -0.306, -HALF_PI, 0, 0), { group: G.eye, crease: 180 });
  b.add('eye', tint(iris, { e: contam ? 3.4 : 2.7 }), sphere(0.017, 1), T(0, 0.005, -0.316), { group: G.eye, crease: 180 });
  b.addPair('eye', 'eye', P.refGlowSoft, box(0.03, 0.006, 0.006, 0.002), T(0.105, 0.075, -0.292), { group: G.lights });
  // --- under-slung muzzle on a gimbal
  b.add('gun', P.refSteel, box(0.06, 0.055, 0.06, 0.012), T(0, -0.148, -0.08));
  b.add('gun', P.refNavy, box(0.08, 0.066, 0.19, 0.014), T(0, -0.19, -0.14));
  b.add('gun', P.refSteel, cyl(0.02, 0.02, 0.22, 8), T(0, -0.19, -0.31, -HALF_PI, 0, 0));
  b.add('gun', P.refDark, cyl(0.031, 0.031, 0.05, 8, 0.007), T(0, -0.19, -0.4, -HALF_PI, 0, 0));
  b.addPair('gun', 'gun', P.refSteel, box(0.008, 0.016, 0.2, 0.003), T(0.03, -0.19, -0.3));
  for (const z of [-0.33, -0.36]) b.add('gun', tint(P.refGlow, { e: 1.2 }), torus(0.027, 0.006, 12, 5), T(0, -0.19, z, -HALF_PI, 0, 0), { group: G.muzzle, crease: 180 });
  b.add('gun', P.refDark, box(0.03, 0.02, 0.05, 0.005), T(0, -0.15, -0.19));
  b.add('gun', P.rubber, tube(arcPath([0.055, -0.12, 0.02], [0.075, -0.2, -0.03], [0.038, -0.19, -0.1], 6), 0.008, 5), undefined, { crease: 180 });
  // --- belly repulsor
  b.add('body', P.refSteel, band(0.088, 0.03, 0.034, 16, 0.007), T(0, -0.15, 0.13));
  b.add('body', tint(P.refGlow, { e: 1.5 }), cyl(0.072, 0.072, 0.012, 16), T(0, -0.158, 0.13), { group: G.repulsor });
  // --- rear cooling vent: frame, hot core, three louvre flaps
  b.add('body', P.refSteel, box(0.25, 0.18, 0.05, 0.012), T(0, 0, 0.268));
  b.add('body', tint(P.refHot, { e: 1 }), box(0.19, 0.115, 0.016), T(0, 0.0, 0.3), { group: G.vent });
  for (let i = 0; i < 3; i++) {
    b.add('body', P.refDark, box(0.2, 0.004, 0.014), T(0, 0.058 - i * 0.04, 0.304));
    b.add('flap' + i, P.refNavy, box(0.196, 0.037, 0.011, 0.004), T(0, 0.039 - i * 0.04, 0.314));
  }
  b.add('body', P.rubber, tube(arcPath([-0.1, 0.1, 0.2], [-0.15, 0.13, 0.27], [-0.09, 0.05, 0.285], 6), 0.009, 5), undefined, { crease: 180 });
  // --- stabiliser vanes: strut + raked blade with a lit tip
  const blade: Pt2[] = [[0, 0.05], [0.09, 0.062], [0.21, 0.005], [0.27, -0.11], [0.25, -0.15], [0.12, -0.095], [0, -0.07]];
  const bladeS: Pt2[] = blade.map((p) => [p[0] * 0.72, p[1] * 0.72] as Pt2);
  const flat = T(0, 0, 0, -HALF_PI, 0, 0);
  const vane = (tag: 'U' | 'L', shoulder: Pt3, tip: Pt3, dihedral: number, outline: Pt2[]): void => {
    const [R, L] = [`vane${tag}R`, `vane${tag}L`];
    const [tR, tL] = [`tip${tag}R`, `tip${tag}L`];
    b.addPair(R, L, P.refSteel, cyl(0.03, 0.03, 0.03, 8, 0.006), T(shoulder[0], shoulder[1], shoulder[2], 0, 0, HALF_PI));
    b.addPair(R, L, P.refSteel, tube([shoulder, tip], 0.014, 6), new THREE.Matrix4(), { crease: 180 });
    const place = mul(T(tip[0], tip[1], tip[2], 0, 0, dihedral), flat);
    b.addPair(tR, tL, P.refNavy, prism(outline, 0.016, 0.006), place);
    const k = outline === blade ? 1 : 0.72;
    const tipX = outline[3]![0], tipY = outline[3]![1];
    const lead: Pt2[] = ([[0, 0.05], [0.09, 0.062], [0.21, 0.005], [0.2, -0.015], [0.09, 0.04], [0, 0.03]] as Pt2[]).map((p) => [p[0] * k, p[1] * k] as Pt2);
    b.addPair(tR, tL, P.refSteel, prism(lead, 0.02, 0.004), place);
    b.addPair(tR, tL, P.refGlow, box(0.05, 0.022, 0.01, 0.003), mul(place, T(tipX - 0.035, tipY + 0.022, 0, 0, 0, -1.05)), { group: G.lights });
    // leading-edge strip: the vanes draw an X of light, so the drone's attitude reads from its lights alone
    b.addPair(tR, tL, P.refGlowSoft, box(0.125 * k, 0.011, 0.024, 0.003), mul(place, T(0.152 * k, 0.04 * k, 0, 0, 0, -0.44)), { group: G.lights });
  };
  vane('U', [0.235, 0.05, 0.04], [0.33, 0.1, 0.07], 0.5, blade);
  vane('L', [0.225, -0.05, 0.1], [0.29, -0.1, 0.13], -0.62, bladeS);
  // --- whip antenna (asymmetry)
  b.add('antenna', P.refSteel, tube([[0.07, 0.14, 0.16], [0.078, 0.26, 0.19], [0.09, 0.37, 0.235]], [0.007, 0.005, 0.003], 5), undefined, { crease: 180 });
  b.add('antenna', P.refGlow, sphere(0.011, 1), T(0.09, 0.372, 0.236), { group: G.lights, crease: 180 });

  if (contam) {
    // tissue erupting through the carapace seam, threading forward to the eye and back to the vent
    b.add('body', P.tissue, blob(0.085, 2, 0.4, 3, [1.25, 0.75, 1.5]), T(-0.115, 0.135, 0.06), { crease: 180 });
    b.add('body', P.tissueWet, blob(0.06, 2, 0.45, 7, [1, 0.9, 1.3]), T(-0.19, 0.045, -0.07), { crease: 180 });
    b.add('body', P.tissue, blob(0.07, 2, 0.4, 11, [1.3, 0.7, 1.1]), T(0.1, -0.115, 0.2), { crease: 180 });
    const strands: [Pt3, Pt3, Pt3, number][] = [
      [[-0.12, 0.15, 0.02], [-0.16, 0.13, -0.16], [-0.09, 0.07, -0.275], 0.016],
      [[-0.1, 0.15, 0.1], [0.02, 0.19, 0.2], [0.09, 0.09, 0.285], 0.014],
      [[-0.19, 0.04, -0.05], [-0.2, -0.09, 0.02], [-0.12, -0.13, 0.12], 0.013],
      [[0.1, -0.12, 0.2], [0.19, -0.03, 0.1], [0.172, 0.06, -0.05], 0.012],
      [[-0.14, 0.12, 0.08], [-0.26, 0.13, 0.06], [-0.33, 0.1, 0.07], 0.022],
    ];
    for (const [a, c, d, r] of strands) b.add('body', P.sinew, tube(arcPath(a, c, d, 8), (t) => r * (1 - 0.55 * t), 5), undefined, { crease: 180 });
    b.add('tipUL', P.tissue, blob(0.05, 1, 0.4, 5, [1.4, 0.6, 1.2]), T(-0.37, 0.125, 0.075), { crease: 180 });
    const nodes: Pt3[] = [[-0.13, 0.19, 0.06], [-0.2, 0.07, -0.09], [0.11, -0.16, 0.21], [-0.07, 0.165, 0.13]];
    for (const n of nodes) b.add('body', P.violet, sphere(0.014, 1), T(n[0], n[1], n[2]), { group: G.growth, crease: 180 });
    // dangling filaments
    const roots: Pt3[] = [[-0.1, -0.13, 0.1], [0.085, -0.15, 0.22], [-0.02, -0.13, 0.26]];
    roots.forEach((r, i) => {
      const seg = FIL_LEN[i]! / 3;
      const chain = b.chain('fil' + i + '_', 'body', [r, [r[0], r[1] - seg, r[2] + 0.01], [r[0], r[1] - seg * 2, r[2] + 0.02]]);
      b.tubeOn(chain, [r[0], r[1] - seg * 3, r[2] + 0.03], P.sinew, (t) => 0.013 * (1 - t * 0.8) + 0.002, 5);
      b.add(chain[2]!, P.violet, sphere(0.012, 1), T(r[0], r[1] - seg * 3, r[2] + 0.03), { group: G.growth, crease: 180 });
    });
  }

  b.socket('core', 'body', [0, 0, 0]);
  b.socket('eye', 'eye', [0, 0.005, -0.325]);
  b.socket('muzzle', 'gun', [0, -0.19, -0.43]);
  b.socket('vent', 'body', [0, 0, 0.33]);
  b.socket('top', 'body', [0, 0.18, 0]);
  b.socket('head', 'eye', [0, 0.005, -0.3]);
  return b.build();
}

const ACTIONS: Record<string, ActionDef> = {
  idle: { dur: 2, loop: true },
  shoot: { dur: 0.42, hits: [0.05], hitName: 'release', fade: 0.03 },
  volley: { dur: 0.9, hits: [0.06, 0.3, 0.54], hitName: 'release', fade: 0.04 },
  hitLight: { dur: 0.4, fade: 0.03, react: true, ignoreFreeze: true },
  hitHeavy: { dur: 0.65, fade: 0.03, react: true, ignoreFreeze: true },
  stagger: { dur: 1.15, fade: 0.05, out: 0.3 },
  death: { dur: 2.3, hold: true, fade: 0.05, ignoreFreeze: true, thaw: true, events: [[1.25, 'impact']] },
  spawn: { dur: 0.9, fade: 0, revive: true },
  scan: { dur: 2.4, loop: true },
  generic: { dur: 0.6, react: true, ignoreFreeze: true },
};
const FALL_START = 0.45, LAND_T = 1.25;
const K = {
  deSpin: [0, 0, 0.5, 2.2, LAND_T, 7.5, 2.3, 8.1],
  deSettle: [LAND_T - 0.15, 0, LAND_T + 0.25, 1],
  deLimp: [0, 0, 0.4, 1],
  deGun: [0, 0, 0.3, 1],
  spFold: [0.1, 0, 0.75, 1],
} as const;

const ALIASES: Record<string, string> = {
  hover: 'idle', frozen: 'idle', linkedSync: 'idle', aim: 'idle', lookAround: 'scan',
  attackLight1: 'shoot', attackLight2: 'shoot', attackLight3: 'shoot', attackLight4: 'shoot', attackHeavy: 'volley',
  pulse: 'shoot', guardHit: 'hitLight', guardBreak: 'stagger', knockdown: 'stagger', spawnDrop: 'spawn', spawnBreach: 'spawn',
};

export class Drone extends CreatureBase implements DroneVisual {
  private readonly contam: boolean;
  private hoverHeight = 1.8;
  private telegraph = 0;
  private flicker = 1;
  private flickerT = 0;
  private twitch = 0;
  private lastBeat = 1;
  private readonly bBody: THREE.Bone;
  private readonly bEye: THREE.Bone;
  private readonly bGun: THREE.Bone;
  private readonly bCara: THREE.Bone;
  private readonly bAnt: THREE.Bone;
  private readonly bFlaps: THREE.Bone[];
  private readonly bVane: THREE.Bone[];
  private readonly bTip: THREE.Bone[];
  private readonly bFil: THREE.Bone[][] = [];
  private readonly wreckProbes: GroundProbe[];

  constructor(game: Game | null, contam: boolean, opts: CharacterCreateOpts = {}) {
    super(game, {
      archetype: contam ? 'contamDrone' : 'secDrone',
      height: 0.55,
      radius: 0.5,
      template: getTemplate(contam ? 'contamDrone' : 'secDrone', () => buildDrone(contam)),
      actions: ACTIONS,
      aliases: ALIASES,
      groups: G,
      frostOrigin: [0, 0, 0.1],
      frostRange: 0.7,
      eclipse: contam,
      baseCorruption: contam ? 0.5 : 0,
      rim: contam ? [0x9a86e0, 0.26] : [0xa8d8ff, 0.3],
    }, opts);
    this.contam = contam;
    const r = this.rig;
    this.bBody = r.b('body');
    this.bEye = r.b('eye');
    this.bGun = r.b('gun');
    this.bCara = r.b('carapace');
    this.bAnt = r.b('antenna');
    this.bFlaps = [0, 1, 2].map((i) => r.b('flap' + i));
    this.bVane = VANES.map((v) => r.b('vane' + v));
    this.bTip = VANES.map((v) => r.b('tip' + v));
    if (contam) for (let i = 0; i < 3; i++) this.bFil.push([0, 1, 2].map((j) => r.b(`fil${i}_${j}`)));
    // what touches the floor first when the wreck comes down: vane tips, muzzle, hull
    this.wreckProbes = [
      probe(this.bTip[0]!, [0.33, 0.1, 0.07], [0.33 + 0.237, 0.1 + 0.129, 0.18], 0.015),
      probe(this.bTip[1]!, [-0.33, 0.1, 0.07], [-0.33 - 0.237, 0.1 + 0.129, 0.18], 0.015),
      probe(this.bTip[2]!, [0.29, -0.1, 0.13], [0.29 + 0.158, -0.1 - 0.113, 0.209], 0.015),
      probe(this.bTip[3]!, [-0.29, -0.1, 0.13], [-0.29 - 0.158, -0.1 - 0.113, 0.209], 0.015),
      probe(this.bTip[0]!, [0.33, 0.1, 0.07], [0.33, 0.1, 0.07], 0.03),
      probe(this.bTip[1]!, [-0.33, 0.1, 0.07], [-0.33, 0.1, 0.07], 0.03),
      probe(this.bTip[2]!, [0.29, -0.1, 0.13], [0.29, -0.1, 0.13], 0.03),
      probe(this.bTip[3]!, [-0.29, -0.1, 0.13], [-0.29, -0.1, 0.13], 0.03),
      probe(this.bGun, [0, -0.135, -0.08], [0, -0.19, -0.43], 0.035),
      probe(this.bBody, [0, 0, 0], [0, 0, 0.02], 0.2),
      probe(this.bBody, [0, 0, 0], [0, 0, 0.3], 0.1),
      probe(this.bAnt, [0.07, 0.14, 0.16], [0.09, 0.37, 0.235], 0.01),
    ];
    this.u.uDissolveColor.value.setHex(contam ? 0x7a3cff : 0xa8d8ff);
    this.u.uHot.value.set(1, 0.97, 0.92, 1);
  }

  /** Distance from the hover point down to the floor (metres); the death animation drops the hull this far. */
  setHoverHeight(h: number): void {
    if (Number.isFinite(h)) this.hoverHeight = Math.max(0, h);
  }

  override setTelegraph(amount: number, color?: number): void {
    super.setTelegraph(amount, color);
    this.telegraph = clamp01(amount || 0);
  }

  protected override lookHeight(): number {
    return 0;
  }

  protected override heal(): void {
    this.twitch = 0; this.flicker = 1; this.flickerT = 0; this.lastBeat = 1; this.deathFlicker = 0;
  }

  protected override onRevive(): void {
    this.deathFlicker = 0;
  }

  protected override pose(adt: number): void {
    const t = this.time;
    const body = this.bBody;
    const c = this.contam;
    const live = this.dead ? 0 : 1;
    const tel = this.telegraph;

    // ---- hover: bob + drift. The contaminated machine lists and corrects in jerks.
    const bob = Math.sin(t * 1.7) * 0.03 + Math.sin(t * 0.83 + 1.3) * 0.018;
    move(body, noise1(t * 0.31) * 0.02, bob, noise1(t * 0.27 + 5) * 0.02, live);
    rot(body, noise1(t * 0.5 + 2) * 0.03, noise1(t * 0.23 + 9) * 0.04, noise1(t * 0.4) * 0.03, live);
    if (c) {
      const jerk = Math.floor(t * 1.3);
      const jf = t * 1.3 - jerk;
      const hop = impact(jf, 0, 0.12) * (noise1(jerk * 7.7) * 0.5 + 0.5);
      rot(body, 0.03 + hop * 0.05, 0, 0.13 + noise1(t * 0.9) * 0.05 - hop * 0.07, live);
      move(body, 0, -0.03 - hop * 0.025, 0, live);
    }
    // ---- banking into motion
    const bank = Math.max(-0.5, Math.min(0.5, -this.velX * 0.075));
    const pitch = Math.max(-0.4, Math.min(0.4, this.velZ * 0.05));
    rot(body, pitch, 0, bank, live);
    const sp = clamp01(this.speed / 5);

    // ---- eye + gun follow the look / aim
    const aim = this.aimPitch + this.lookPitch;
    rot(this.bEye, Math.max(-0.35, Math.min(0.35, aim * 0.5)), Math.max(-0.4, Math.min(0.4, this.lookYaw * 0.6)), 0, live);
    rot(this.bGun, Math.max(-0.9, Math.min(0.7, aim)), Math.max(-0.5, Math.min(0.5, this.lookYaw * 0.8)), 0, live);
    rot(body, aim * 0.2 * live, 0, 0);

    // ---- vanes: flutter, sweep back with speed, counter the bank, coil forward while charging
    for (let i = 0; i < 4; i++) {
      const right = i % 2 === 0 ? 1 : -1;
      const upper = i < 2 ? 1 : -1;
      const v = this.bVane[i]!, tip = this.bTip[i]!;
      const fl = Math.sin(t * 3.1 + i * 1.7) * 0.035 + noise1(t * 1.3 + i * 3) * 0.03;
      // spread = how far the X of vanes opens; roll = common counter-roll so the vanes lag the hull's bank
      let spread = (fl + tel * 0.3 - sp * 0.15) * live;
      let sweep = sp * 0.45 - tel * 0.55;
      let fold = Math.sin(t * 2.3 + i) * 0.03 + tel * 0.35;
      if (c && i === 1) {
        // the overgrown vane hangs low and snaps on the cadence, out of phase with the others
        spread = (-0.75 + Math.sin(t * 1.1) * 0.06 + this.twitch * 0.9) * live;
        sweep = 0.35 - this.twitch * 0.5;
        fold = -0.5 + this.twitch * 0.8;
      }
      rot(v, 0, -sweep * right, spread * right * upper - bank * 0.6);
      rot(tip, 0, -sweep * 0.5 * right, fold * right * upper);
    }
    rot(this.bAnt, 0.1 * sp + noise1(t * 2.1) * 0.04, 0, noise1(t * 1.7 + 4) * 0.05 + bank * 0.5);
    if (c) rot(this.bCara, Math.sin(t * 1.9) * 0.012 + this.twitch * 0.06, 0, this.twitch * 0.04);

    // ---- contaminated filaments dangle and lag the motion
    for (let i = 0; i < this.bFil.length; i++) {
      const ch = this.bFil[i]!;
      for (let j = 0; j < ch.length; j++) {
        const lag = (j + 1) * 0.5;
        const hang = j === 0 ? 1 : 0; // the first link cancels the hull's tilt so the filament hangs true
        rot(ch[j]!, Math.sin(t * 1.6 - lag + i) * 0.14 - this.velZ * 0.07 * (j + 1) + this.twitch * 0.25 - body.rotation.x * hang,
          0, Math.sin(t * 1.25 - lag + i * 2.1) * 0.12 + this.velX * 0.07 * (j + 1) - body.rotation.z * hang);
      }
    }

    // ---- weak point: louvres open to the lit core
    const vent = this.exposure('vent');
    for (let i = 0; i < 3; i++) rot(this.bFlaps[i]!, -vent * (1.15 + i * 0.08) - Math.max(0, Math.sin(t * 9 + i)) * 0.04 * vent, 0, 0);

    // ---- actions
    let muzzle = 0.35 + tel * 3.2;
    let lights = 1;
    for (const s of this.active) muzzle += this.applyAction(s, adt);
    if (this.dead) {
      lights = 0;
      // the wreck rests ON the floor: lift the hull by whatever its lowest part is short of it
      for (let i = 0; i < 4; i++) this.bTip[i]!.updateWorldMatrix(true, false);
      this.bGun.updateWorldMatrix(true, false);
      this.bAnt.updateWorldMatrix(true, false);
      const lack = groundDeficit(this.wreckProbes, this.rig.toModel, -this.hoverHeight / this.scale);
      if (lack > 0) body.position.y += lack;
      // contaminated filaments go slack along the ground: each is laid from its root down to the floor
      const flat = keys(this.timeOf('death'), K.deSettle);
      if (this.bFil.length) {
        body.updateWorldMatrix(true, false);
        _mb.multiplyMatrices(this.rig.toModel, body.matrixWorld);
        _qb.setFromRotationMatrix(_mb).invert();
        const floorY = -this.hoverHeight / this.scale + 0.02;
        for (let i = 0; i < this.bFil.length; i++) {
          const ch = this.bFil[i]!;
          _pf.copy(ch[0]!.position).applyMatrix4(_mb);
          const len = FIL_LEN[i]!;
          const dy = Math.max(-1, Math.min(0, -(_pf.y - floorY) / len));
          const h = Math.sqrt(1 - dy * dy), a = 0.6 + i * 2.2;
          _df.set(Math.cos(a) * h, dy, Math.sin(a) * h);
          _qf.setFromUnitVectors(DOWN, _df).premultiply(_qb);
          // free while the root is a filament's length above the floor; fully laid once it is not
          const k = Math.max(flat, clamp01((1 + dy) * 4));
          if (k <= 0) continue;
          ch[0]!.quaternion.slerp(_qf, k);
          for (let j = 1; j < ch.length; j++) ch[j]!.quaternion.slerp(_qi, k);
        }
      }
    }

    // ---- emissive groups
    if (c) {
      this.flickerT -= adt;
      if (this.flickerT <= 0) {
        this.flickerT = 0.04 + this.rndNext() * 0.22;
        this.flicker = this.rndNext() < 0.3 ? 0.12 + this.rndNext() * 0.3 : 0.8 + this.rndNext() * 0.5;
      }
      const beat = this.cadence.beat();
      if (beat > this.lastBeat + 0.3) this.twitch = 1;
      this.lastBeat = beat;
      this.twitch = damp(this.twitch, 0, 7, adt);
    }
    const deathW = this.weight('death');
    const on = 1 - deathW;
    this.groupGlow('eye', (c ? this.flicker : 1) * (1 + tel * 1.4) * on + deathW * this.deathFlicker);
    this.groupGlow('vent', (0.12 + vent * 1.9) * on);
    this.groupGlow('muzzle', muzzle * on);
    this.groupGlow('lights', lights * on * (c ? 0.35 + 0.4 * this.flicker : 1));
    this.groupGlow('repulsor', (0.85 + Math.sin(t * 5.3) * 0.08 + sp * 0.5) * on);
    this.groupGlow('growth', 0.7 + this.cadence.beat() * 1.6);
    this.u.uHot.value.w = vent;
    this.rig.setBoundsCenter(body.position.x, body.position.y, body.position.z, 1.6);
  }

  private deathFlicker = 0;
  private rngState = 0;
  private rndNext(): number {
    this.rngState += 1;
    return this.rnd(this.rngState);
  }

  /** applies one action layer; returns extra muzzle glow */
  private applyAction(s: Slot, _adt: number): number {
    const body = this.bBody, w = s.w, t = s.t;
    switch (s.name) {
      case 'shoot': {
        const k = impact(t, 0.05, 0.09) * w;
        move(body, 0, 0.012 * k, 0.07 * k);
        rot(body, 0.11 * k, 0, 0);
        move(this.bGun, 0, 0, 0.05 * k);
        rot(this.bGun, 0.12 * k, 0, 0);
        for (let i = 0; i < 4; i++) rot(this.bTip[i]!, 0, 0, (i % 2 === 0 ? 1 : -1) * (i < 2 ? 1 : -1) * 0.18 * k);
        return impact(t, 0.05, 0.07) * 6 * w;
      }
      case 'volley': {
        let glow = 0;
        for (const h of s.def.hits ?? []) {
          const k = impact(t, h, 0.07) * w;
          move(body, 0, 0.008 * k, 0.05 * k);
          rot(body, 0.08 * k, 0, 0);
          move(this.bGun, 0, 0, 0.05 * k);
          glow += k * 6;
        }
        return glow;
      }
      case 'hitLight':
      case 'hitHeavy': {
        const a = s.name === 'hitHeavy' ? 1.9 : 1;
        const k = impact(t, 0, 0.16, 26) * w * a;
        const k2 = impact(t, 0, 0.2, 19) * w * a;
        rot(body, 0.16 * k, 0.1 * k2, 0.22 * k2);
        move(body, 0, -0.04 * Math.abs(k), 0.07 * k);
        for (let i = 0; i < 4; i++) rot(this.bVane[i]!, 0, 0, (i % 2 === 0 ? 1 : -1) * 0.25 * k2 * (i < 2 ? 1 : -1));
        return 0;
      }
      case 'stagger': {
        const env = win(t, 0, 0.12, 0.7, 1.15) * w;
        const spin = Math.sin(t * 9) * env;
        rot(body, 0.3 * Math.sin(t * 7 + 1) * env, 0.5 * spin, 0.6 * Math.sin(t * 6.2) * env);
        move(body, 0.05 * spin, -0.28 * win(t, 0, 0.25, 0.6, 1.1) * w, 0.1 * env);
        for (let i = 0; i < 4; i++) {
          rot(this.bVane[i]!, 0, 0.4 * env * (i % 2 === 0 ? -1 : 1), Math.sin(t * 14 + i * 2) * 0.45 * env);
          rot(this.bTip[i]!, 0, 0, Math.sin(t * 17 + i) * 0.4 * env);
        }
        rot(this.bGun, 0.6 * env, 0, 0);
        return -0.3 * env;
      }
      case 'death': {
        // spin up, lights stutter out, drop under gravity, bounce, settle on its side. The scripted drop aims just
        // below the floor; the wreck probes in pose() seat whatever touches first exactly on it
        const drop = this.hoverHeight / this.scale + 0.05;
        const fallStart = FALL_START, land = LAND_T;
        const f = clamp01((t - fallStart) / (land - fallStart));
        let y = -drop * f * f;
        y += Math.abs(Math.sin((t - land) * 9)) * 0.12 * impact(t, land, 0.22);
        if (t < fallStart) y += 0.06 * Math.sin((t / fallStart) * Math.PI);
        const spin = keys(t, K.deSpin);
        const settle = keys(t, K.deSettle);
        move(body, 0.25 * f, y * w, 0.15 * f);
        // comes down rolled onto its left side module; the pose below is then seated on the floor by the wreck probes
        rot(body, (0.5 * Math.sin(t * 5) * (1 - settle) + 0.18 * settle) * w, spin * w, (0.8 * f * (1 - settle) + 0.62 * settle) * w);
        const limp = keys(t, K.deLimp);
        for (let i = 0; i < 4; i++) {
          const right = i % 2 === 0 ? 1 : -1;
          // falling: every vane trails upward in the airflow. Landed: the left pair is pinned up against the hull
          // by the floor, the right pair flops down across it
          const trail = 0.55 * limp * (1 - settle);
          const rest = (right > 0 ? -0.95 : -0.5) * settle;
          rot(this.bVane[i]!, 0, (0.3 + 0.2 * i) * limp * -right * (1 - settle * 0.5), right * trail + rest + Math.sin(t * 13 + i) * 0.2 * limp * (1 - settle));
          rot(this.bTip[i]!, 0, 0, right * 0.3 * trail + (right > 0 ? -0.6 : -0.45 - (i === 1 ? 0.5 : 0)) * settle);
        }
        rot(this.bGun, 0.8 * keys(t, K.deGun), 0.3 * settle, 0);
        for (let i = 0; i < 3; i++) rot(this.bFlaps[i]!, -0.5 * settle * (i === 1 ? 1.6 : 0.6), 0, 0);
        this.deathFlicker = t < 0.9 ? (Math.sin(t * 43) > 0.2 ? 1.6 : 0.05) * (1 - t / 0.9) : 0;
        return -1;
      }
      case 'spawn': {
        const k = (1 - keys(t, K.spFold)) * w;
        for (let i = 0; i < 4; i++) {
          const right = i % 2 === 0 ? 1 : -1, upper = i < 2 ? 1 : -1;
          rot(this.bVane[i]!, 0, -1.1 * k * right, -0.5 * k * right * upper);
          rot(this.bTip[i]!, 0, -0.9 * k * right, 0);
        }
        rot(this.bGun, -0.7 * k, 0, 0);
        move(body, 0, 0.12 * k * Math.sin(t * 10) * 0.2, 0);
        return -0.35 * k;
      }
      case 'scan': {
        const a = Math.sin((t / s.def.dur) * Math.PI * 2);
        rot(body, 0, 0.5 * a * w, 0);
        rot(this.bEye, 0.1 * Math.sin(t * 2.6) * w, 0.25 * a * w, 0);
        return 0;
      }
      case 'generic': {
        const k = impact(t, 0, 0.18, 14) * w;
        rot(body, 0.1 * k, 0, 0.06 * k);
        return 0;
      }
      default:
        return 0;
    }
  }

  protected override onPlay(name: string): void {
    if (name !== 'death') this.deathFlicker = 0;
  }
}

/** factory used by the creature registry */
export function createDrone(game: Game | null, contam: boolean, opts?: CharacterCreateOpts): Drone {
  return new Drone(game, contam, opts);
}

/** re-exported for tests */
export const DRONE_ACTIONS = ACTIONS;
