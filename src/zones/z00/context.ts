/**
 * Z00 `context` — the opening of the whole game (SCRIPT_SOURCE Z00 `context`): five narrative cards (the
 * author's narration and the terminal's / fleets' readouts, exact) over slow authored shots of the crash
 * aftermath seen through the fractured rib, ending on the contained black Wound. The voice fragments of
 * Caelus, Sol, Tharne and Selene play offscreen over cards 3 and 4. Skippable: every state change (sky,
 * music, cards cleared) happens unconditionally in the routine; only flashes and stingers are cosmetic.
 *
 * Card text uses the `context` style (serif statement); the readouts of cards 2 and 3 run as the card's text
 * on their own lines, and each fleet's order sits under its fleet as the card's small-caps subline.
 *
 * Polish 4 (the plan allows 60 s; it ran 76 s): only the waits no voice-over paces were tightened — the reading
 * holds of the cards without a voice line (each still ≥ 13 characters a second or slower) and the closing beat.
 * The voiced cards (Caelus, Sol, Tharne, Selene) keep their timing: the lines pace them.
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

/**
 * A look target from `from` toward the Wound's bearing turned `azDeg` east (clockwise from above) and raised to
 * `elevDeg` above the horizon — shots are composed around the Wound, which sits ~21° up in the north.
 */
function skyLook(z: ZoneRuntime, from: THREE.Vector3, azDeg: number, elevDeg: number): THREE.Vector3 {
  const d = z.game.sky.woundDir;
  const base = Math.atan2(d.x, -d.z) + THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elevDeg);
  return from.clone().add(new THREE.Vector3(Math.sin(base) * Math.cos(el), Math.sin(el), -Math.cos(base) * Math.cos(el)).multiplyScalar(100));
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

    // S1 — inside, under the fractured rib, looking out over the burning wreck (slow push toward the breach)
    c.cut({ pos: z.P(rib[0] - 1.6, rib[1] - 9, 4.6), look: z.P(wreck[0], wreck[1], 9), fov: 48 });
    c.moveAsync({ pos: z.P(rib[0] - 0.6, rib[1] - 5.2, 3.6), look: z.P(wreck[0] + 1, wreck[1], 8), fov: 44 }, 15, 'inOut');

    const steps: Step[] = [
      {
        text: 'Aurelion does not look like a battlefield. It looks like the aftermath of an argument between gods.',
        hold: 7.4,
        begin: () => ui.fade(0, 3.6),
      },
      {
        // S2 — up through the fracture at the sky: the Wound, contained, far off
        text: 'REMOTE ANCHORS: 4 / 4 RELEASE-READY\nTERMINAL ANCHOR: SEALED\nPRIMARY CONTAINMENT: CLOSED\nBOUNDARY PRESSURE: RISING',
        hold: 5.6,
        begin: () => {
          // S2 — at the rubble edge, up at the sky: red remnant left, white remnant right, the Wound low between
          const p = z.P(rib[0], rib[1] - 1.7, 1.0);
          c.cut({ pos: p, look: skyLook(z, p, 0, 31), fov: 52 });
          c.moveAsync({ pos: p.clone().add(new THREE.Vector3(0, 0.35, 0)), look: skyLook(z, p, 0, 29), fov: 48 }, 11, 'inOut');
        },
      },
      { text: 'Four lights. One dark.', hold: 3.2 },
      {
        // S3 — along the Dominion hull: amber emergency light in the smoke
        text: 'The Dominion names the operation LAST THRONE.',
        sub: 'SECONDARY OBJECTIVE: DENY HOSTILE ACCESS',
        hold: 4.6,
        at: 1.4,
        lines: [['Caelus', 'Then arrive first.']],
        begin: () => {
          // S3 — the Dominion wreck from above its tail: the hull still burning in amber
          c.cut({ pos: z.P(wreck[0] + 13, wreck[1] - 12, 7.2), look: z.P(wreck[0] - 1, wreck[1], 1.2), fov: 42 });
          c.moveAsync({ pos: z.P(wreck[0] + 10, wreck[1] - 14, 6.2), look: z.P(wreck[0] - 2, wreck[1] + 1, 1.4), fov: 40 }, 16, 'inOut');
        },
      },
      {
        text: 'The Reformation names its deployment LAST WOUND.',
        sub: 'SECONDARY OBJECTIVE: DENY UNILATERAL DOMINION CONTROL',
        hold: 4.6,
        at: 1.4,
        lines: [['Sol', 'Then arrive first.']],
      },
      {
        // the two orders set as a parallel pair, each broken where it reads (the strings are the book's, whole)
        text: 'CROWNMARK V: NO ACTIVATION\nWITHOUT SOVEREIGN AUTHORITY\n\nCROWNMARK V: NO ACTIVATION\nWITHOUT COUNCIL AUTHORITY',
        hold: 4.8,
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
          // S4 — from the shelter's side of the breach, up past the fractured rib at the fleets' fire
          sky.setBattleIntensity(0.85);
          const p = z.P(rib[0] - 1.5, rib[1] - 1.9, 1.0);
          c.cut({ pos: p, look: skyLook(z, p, 30, 25), fov: 54 });
          c.moveAsync({ pos: p.clone().add(new THREE.Vector3(0.5, 0.25, 0)), look: skyLook(z, p, 24, 24), fov: 50 }, 18, 'inOut');
        },
      },
      {
        text: 'Calibrated fire is still fire.',
        hold: 4.2,
        at: 1.2,
        lines: [['Selene', 'Do not return fire. If we fire now, the next shot becomes intentional.']],
      },
      { text: 'Nobody declares war. Both fleets simply discover they have already entered one.', hold: 4.8 },
      {
        // S5 — back inside: through the fractured rib toward the Wound; something moves in it
        text: 'Something moves out of the Wound.',
        hold: 3.6,
        begin: () => {
          sky.setBattleIntensity(0.06);
          sky.setWoundActivity(0.95);
          // the long lens on the Wound, in the upper third, the nave's arches around it
          const p0 = z.P(rib[0], rib[1] - 2.2, 1.1);
          c.cut({ pos: p0, look: skyLook(z, p0, 0, 13), fov: 31 });
          c.moveAsync({ pos: p0.clone().add(new THREE.Vector3(0, 0.15, -0.9)), look: skyLook(z, p0, 0, 14.5), fov: 23 }, 14, 'inOut');
        },
      },
      {
        text: 'The fleets stop shooting at one another for nearly four seconds. Then the Eclipse fires.',
        hold: 5.6,
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
    yield 1.0;

    // end state — identical watched or skipped: cards gone, sky as the landing finds it
    ui.card(null);
    ui.fade(0, 0);
    sky.setBattleIntensity(LANDING_SKY.battle);
    sky.setWoundActivity(LANDING_SKY.wound);
  }, { blendOut: 0 });
}
