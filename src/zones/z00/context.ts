/**
 * Z00 `context` — the opening of the whole game (SCRIPT_SOURCE Z00 `context`): five narrative cards (the
 * author's narration and the terminal's / fleets' readouts, exact) over slow authored shots of the crash
 * aftermath seen through the fractured rib, ending on the contained black Wound. The voice fragments of
 * Caelus, Sol, Tharne and Selene play offscreen over cards 3 and 4. Skippable: every state change (sky,
 * music, cards cleared) happens unconditionally in the routine; only flashes and stingers are cosmetic.
 *
 * Card text uses the `context` style (serif statement); the readouts of cards 2 and 3 run as the card's text
 * on their own lines, and each fleet's order sits under its fleet as the card's small-caps subline.
 */
import * as THREE from 'three';
import type { CineCtx, Routine, SayOpts, SpeakerId, ZoneRuntime } from '@/core/api';

/** one card step: text (+ optional subline) held for `hold` seconds; `lines` start `at` seconds in */
interface Step {
  text: string;
  sub?: string;
  hold: number;
  at?: number;
  lines?: Array<[SpeakerId, string]>;
  /** called when the step begins (camera / sky changes) */
  begin?: () => void;
}

const VOICE: SayOpts = { offscreen: true, channel: 'radio' };

/** sky state the context ends on — and the landing starts in (also applied by the landing's `enter`) */
export const LANDING_SKY = { battle: 0.38, wound: 0.3 } as const;

/** where the camera looks along the Wound's bearing, `up` metres above the horizon line per 100 m out */
function woundLook(z: ZoneRuntime, from: THREE.Vector3, up: number): THREE.Vector3 {
  const d = z.game.sky.woundDir;
  const flat = new THREE.Vector3(d.x, 0, d.z);
  if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1);
  flat.normalize();
  return from.clone().addScaledVector(flat, 100).add(new THREE.Vector3(0, up + d.y * 100, 0));
}

/**
 * The context cinematic. `wreck` = plan position of the wreck centre, `rib` = plan position of the fractured
 * rib's apex line (the frame the shots look through).
 */
export function* contextScene(z: ZoneRuntime, wreck: [number, number], rib: [number, number]): Routine {
  const game = z.game;
  const ui = game.ui;
  const sky = game.sky;

  yield* z.cinematic('z00-context', function* (c: CineCtx): Routine {
    // the zone card would land on the first statement: it waits for control in `landing`
    ui.zoneCard('');
    ui.fade(1, 0);
    game.audio.setMusic('context', 0.5);
    sky.setBattleIntensity(0.3);
    sky.setWoundActivity(0.15);

    // S1 — inside the fractured rib, looking out over the burning wreck (slow push)
    const s1a = z.P(rib[0] - 4.5, rib[1] - 9.5, 5.2);
    const s1b = z.P(rib[0] - 3, rib[1] - 6, 4.4);
    const wreckAt = z.P(wreck[0], wreck[1], 3.2);
    c.cut({ pos: s1a, look: wreckAt, fov: 46 });
    c.moveAsync({ pos: s1b, look: z.P(wreck[0] + 1, wreck[1], 2.6), fov: 43 }, 15, 'inOut');

    const steps: Step[] = [
      {
        text: 'Aurelion does not look like a battlefield.\nIt looks like the aftermath of an argument between gods.',
        hold: 8.6,
        begin: () => ui.fade(0, 4.2),
      },
      {
        // S2 — up through the fracture at the sky: the Wound, contained, far off
        text: 'REMOTE ANCHORS: 4 / 4 RELEASE-READY\nTERMINAL ANCHOR: SEALED\nPRIMARY CONTAINMENT: CLOSED\nBOUNDARY PRESSURE: RISING',
        hold: 6.2,
        begin: () => {
          const p = z.P(rib[0] + 1.5, rib[1] - 3.2, 1.4);
          c.cut({ pos: p, look: woundLook(z, p, 34), fov: 52 });
          c.moveAsync({ pos: p.clone().add(new THREE.Vector3(0, 0.5, -0.8)), look: woundLook(z, p, 22), fov: 48 }, 11, 'inOut');
        },
      },
      { text: 'Four lights. One dark.', hold: 4.2 },
      {
        // S3 — along the Dominion hull: amber emergency light in the smoke
        text: 'The Dominion names the operation LAST THRONE.',
        sub: 'SECONDARY OBJECTIVE: DENY HOSTILE ACCESS',
        hold: 5,
        at: 1.4,
        lines: [['Caelus', 'Then arrive first.']],
        begin: () => {
          c.cut({ pos: z.P(wreck[0] - 10, wreck[1] - 8, 2.4), look: z.P(wreck[0] - 1, wreck[1] + 1, 2.8), fov: 40 });
          c.moveAsync({ pos: z.P(wreck[0] - 8.5, wreck[1] - 9.5, 2.0), look: z.P(wreck[0] + 1, wreck[1] + 1, 2.6), fov: 38 }, 16, 'inOut');
        },
      },
      {
        text: 'The Reformation names its deployment LAST WOUND.',
        sub: 'SECONDARY OBJECTIVE: DENY UNILATERAL DOMINION CONTROL',
        hold: 5,
        at: 1.4,
        lines: [['Sol', 'Then arrive first.']],
      },
      {
        text: 'CROWNMARK V: NO ACTIVATION WITHOUT SOVEREIGN AUTHORITY\nCROWNMARK V: NO ACTIVATION WITHOUT COUNCIL AUTHORITY',
        hold: 5.4,
      },
      {
        // S4 — low on the apron, the fleet battle across the sky
        text: 'Two boundary zones appear over the system: Dominion’s western exclusion perimeter and the Reformation’s navigational safety corridor. On a stellar scale, they overlap by almost nothing. It is still enough to start a war.',
        hold: 9,
        at: 3.4,
        lines: [
          ['Tharne', 'The Dominion perimeter is calculated from Orison’s stellar frame.'],
          ['Tharne', 'Ours uses Glass Citadel’s pre-Sundering correction.'],
          ['Tharne', 'Seven-point-three kilometers at Mapping Group Three.'],
        ],
        begin: () => {
          sky.setBattleIntensity(0.85);
          const p = z.P(wreck[0] + 7, wreck[1] - 12, 1.1);
          c.cut({ pos: p, look: woundLook(z, p, 30).add(new THREE.Vector3(18, 0, 0)), fov: 50 });
          c.moveAsync({ pos: p.clone().add(new THREE.Vector3(-1.2, 0.3, 0)), look: woundLook(z, p, 26).add(new THREE.Vector3(6, 0, 0)), fov: 47 }, 18, 'inOut');
        },
      },
      {
        text: 'Calibrated fire is still fire.',
        hold: 4.2,
        at: 1.2,
        lines: [['Selene', 'Do not return fire. If we fire now, the next shot becomes intentional.']],
      },
      { text: 'Nobody declares war. Both fleets simply discover they have already entered one.', hold: 5.6 },
      {
        // S5 — back inside: through the fractured rib toward the Wound; something moves in it
        text: 'Something moves out of the Wound.',
        hold: 4.4,
        begin: () => {
          sky.setBattleIntensity(0.06);
          sky.setWoundActivity(0.95);
          const p0 = z.P(rib[0], rib[1] - 13, 2.0);
          const p1 = z.P(rib[0], rib[1] - 7.5, 2.5);
          c.cut({ pos: p0, look: woundLook(z, p0, 9), fov: 40 });
          c.moveAsync({ pos: p1, look: woundLook(z, p1, 8), fov: 34 }, 14, 'inOut');
        },
      },
      {
        text: 'The fleets stop shooting at one another for nearly four seconds. Then the Eclipse fires.',
        hold: 6.4,
      },
    ];

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      s.begin?.();
      ui.card(s.text, { style: 'context', sub: s.sub });
      // the card's own fade-in, then the reading time
      let used = 0;
      if (s.lines && s.lines.length) {
        const at = s.at ?? 0;
        yield at;
        used += at;
        const t0 = z.time;
        for (const [who, text] of s.lines) yield* z.say(who, text, VOICE);
        used += z.time - t0;
      }
      if (i === steps.length - 1) {
        // "Then the Eclipse fires." — a violet discharge from the Wound, then the fleets resume
        yield 3.2;
        used += 3.2;
        if (!z.skipping) {
          sky.impact({ dir: sky.woundDir, color: 0x7a3cff, strength: 1 });
          game.camera.shake(0.18, 0.6);
          game.audio.play('fleetImpact', { volume: 0.7 });
        }
        sky.setBattleIntensity(0.6);
      } else if (i === 6 && !z.skipping) {
        sky.impact({ color: 0xffa033, strength: 0.6 });
      }
      if (s.hold > used) yield s.hold - used;
    }
    ui.card(null);
    yield 1.6;

    // end state — identical watched or skipped: cards gone, sky as the landing finds it
    ui.card(null);
    ui.fade(0, 0);
    sky.setBattleIntensity(LANDING_SKY.battle);
    sky.setWoundActivity(LANDING_SKY.wound);
  }, { blendOut: 0 });
}
