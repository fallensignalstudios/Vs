/**
 * Z11 `conversation` → CP8 (SCRIPT_SOURCE Z11, sections a–g) and the fleet alert that ends the gallery.
 * Seated, skippable, about four and a half minutes. Every line is the author's, exact, in order; the two lines of
 * the local-priority callback (c) are new and tagged. Trimmed lines (ext — trimmed) are not played.
 *
 * The exchange: Tarrik slides the black Cauldron recorder across; she sets the Record 7283 wafer down; their hands
 * touch once as he reaches for it. The pact: every clause, four rules and the death clause. A skip applies the
 * same evidence and pact state (story flags, the items where the scene leaves them) and never touches the
 * recorded local priority.
 */
import * as THREE from 'three';
import type { CineCtx, Companion, Routine, ZoneRuntime } from '@/core/api';
import { S, carry, comm, hide, hold, humanoid, placePanels, rest, slide } from './state';
import { SEAT_S, SEAT_T, frame, joined, resetCover, run, sitPlayer, sitTarrik, standPlayer, standTarrik, type Step } from './stage';

// =====================================================================================================================
// Where things rest on the table (world positions; the set's top is at 0.76 m)
// =====================================================================================================================

export interface Spots {
  seal: THREE.Vector3;
  recT: THREE.Vector3;
  recS: THREE.Vector3;
  wafMid: THREE.Vector3;
  wafT: THREE.Vector3;
}
export function spots(z: ZoneRuntime): Spots {
  const t = z.m(SEAT_T);
  const s = z.m(SEAT_S);
  const at = (k: number, dn: number, h: number): THREE.Vector3 => t.clone().lerp(s, k).add(new THREE.Vector3(0, h, -dn));
  return {
    seal: at(0.62, 0.32, 0.769),
    recT: at(0.3, -0.22, 0.773),
    recS: at(0.7, -0.22, 0.773),
    wafMid: at(0.52, 0.12, 0.762),
    wafT: at(0.27, 0.18, 0.762),
  };
}

/** the evidence as the conversation leaves it (linger enter, end states) */
export function evidenceAfterExchange(z: ZoneRuntime): void {
  const sp = spots(z);
  rest(S.seal, sp.seal);
  rest(S.recorder, sp.recS);
  rest(S.wafer, sp.wafT);
}

// =====================================================================================================================
// The conversation
// =====================================================================================================================

export function* conversationScene(z: ZoneRuntime): Routine {
  const g = z.game;
  const tarrik = z.cast('tarrik');
  const sp = spots(z);
  const east = z.state.rescuePriority === 'EastWalkers';
  const lookAt = (who: 'T' | 'S', p: THREE.Vector3 | null): void => {
    const v = who === 'T' ? humanoid(tarrik?.actor) : humanoid(z.player);
    v?.lookAt(p);
  };

  yield* z.cinematic('z11-table', function* (c: CineCtx): Routine {
    resetCover();
    placePanels(z);
    // “Tarrik chooses a chair. Selene remains standing.”
    sitTarrik(z, tarrik);
    standPlayer(z, 'seleneStand');
    frame(z, c, 'wide', 10);
    if (!z.skipping) g.audio.play('chairSettle', { pos: z.m(SEAT_T) });
    yield 3.4;

    // ---- (a) sitting down ------------------------------------------------------------------------------------
    const standing = (): void => {
      c.shot(z.player.pos, { yawDeg: 212, distance: 2.7, height: 1.3, lookHeight: 1.72, fov: 33 });
    };
    const a: Step[] = [
      ['Tarrik', 'You do that often.', 'T'],
      () => standing(),
      ['Selene', 'What?', null],
      ['Tarrik', 'Stand while everyone else sits.', 'T'],
      () => standing(),
      ['Selene', 'It is easier to leave.', null],
      ['Tarrik', 'That is encouraging.', 'T'],
      // she gives him a dry look, then sits; she stays seated until the alert
      () => {
        frame(z, c, 'two', 8);
        sitPlayer(z);
        if (!z.skipping) g.audio.play('chairSettle', { pos: z.m(SEAT_S) });
      },
      2.0,
      // he puts a field seal on the table for the cut at her temple; she looks at it. Silent.
      (cc) => fieldSeal(z, cc, tarrik, sp),
      ['Tarrik', 'You are extremely difficult to talk to.', 'T'],
      ['Selene', 'So far you have mostly tried with a sword.', 'S'],
      ['Tarrik', 'That was easier.', 'otsT'],
      ['Selene', 'I noticed.', 'S'],
      // (b) the look held after “I noticed.” is the acknowledgment (ruling 18: no new line)
      () => frame(z, c, 'two', 6),
      2.6,
    ];
    yield* run(z, c, a, tarrik);

    // ---- (c) the local-priority callback (NEW, from the recorded priority) -----------------------------------
    const cb: Step[] = east
      ? [['Tarrik', 'You left the route to the people walking it.', 'T'], ['Selene', 'Yes.', 'S']] // NEW · NEW
      : [['Tarrik', 'You made space for the ones who couldn’t run.', 'T'], ['Selene', 'Yes.', 'S']]; // NEW · NEW
    yield* run(z, c, [...cb, 1.2], tarrik);

    // ---- (d) what each side buried ---------------------------------------------------------------------------
    const d1: Step[] = [
      ['Selene', 'The Reformation teaches the King’s Final Civic Admonition as one of the foundations of its political order.', 'S'],
      ['Tarrik', 'I know.', 'T'],
      ['Selene', 'You know the version we teach. You do not know the version he gave.', 'otsS'],
      // she activates a small projection over the table (her command strip)
      () => projection(z, c, ['PEOPLE FLOURISH THROUGH ORDER.']),
      () => z.say('Command strip', 'PEOPLE FLOURISH THROUGH ORDER.', { channel: 'system' }), // speaker label NEW (Z05's)
      1.0,
      () => projection(z, c, ['ORDER EXISTS THAT PEOPLE MAY FLOURISH.', 'PEOPLE DO NOT EXIST THAT ORDER MAY ENDURE.']),
      () => z.say('Command strip', 'ORDER EXISTS THAT PEOPLE MAY FLOURISH. PEOPLE DO NOT EXIST THAT ORDER MAY ENDURE.', { channel: 'system' }),
      1.4,
      ['Tarrik', 'They reversed it.', 'T'],
      ['Selene', 'Yes.', 'S'],
      () => S.proj?.show(0, 1.2),
      // “Tarrik laughs, and Selene frowns.”
      ['Tarrik', 'We did the opposite.', 'T'],
      () => frame(z, c, 'S', 4),
      1.4,
    ];
    yield* run(z, c, d1, tarrik);

    // the recorder: from a compartment at his waist, slid across; she does not take it immediately
    yield* recorderAcross(z, c, tarrik, sp);
    const d2: Step[] = [
      ['Selene', 'Cauldron.', 'S'],
      ['Tarrik', 'A full authenticated copy.', 'T'],
      ['Selene', 'Why me?', 'S'],
      ['Tarrik', 'Because mine already buried it once.', 'T'],
      // he looks toward the Dominion fleet; then she takes it
      () => lookAt('T', z.P(2, 40, 6)),
      1.4,
      (cc) => takeRecorder(z, cc, sp),
      // without hesitation after that: the wafer
      (cc) => waferDown(z, cc, sp),
      ['Tarrik', 'Record 7283.', 'T'],
      ['Selene', 'The primary mirror copy, alteration history, founding review chain, and current provenance certification.', 'S'],
      ['Tarrik', 'Why?', 'otsT'],
      ['Selene', 'Because mine already buried it once.', 'S'],
      // her eyes go to the Reformation formation; neither smiles
      () => {
        lookAt('S', z.P(22, 40, 6));
        z.story('evidenceExchanged');
        if (!z.skipping) g.audio.play('evidenceExchange', { pos: sp.wafMid });
      },
      1.6,
      // their hands touch as he reaches for the wafer; hers withdraws a fraction later than necessary
      (cc) => handsTouch(z, cc, tarrik, sp),
      ['Tarrik', 'You’re freezing.', 'T'],
      ['Selene', 'Your baseline temperature appears medically unreasonable.', 'S'],
      1.0,
    ];
    yield* run(z, c, d2, tarrik);

    // ---- (e) the visions ---------------------------------------------------------------------------------------
    const e: Step[] = [
      ['Selene', 'Before I knew who you were, I saw you.', 'S'],
      ['Tarrik', 'What did you see?', 'otsT'],
      ['Selene', 'A red sky. You were kneeling.', 'S'],
      // something inside him tightens
      () => frame(z, c, 'T', 5),
      1.8,
      ['Selene', 'There was a woman near him. Dark hair. A weapon raised.', 'otsS'], // the author's emendation (second round)
      ['Tarrik', 'Lyessa.', 'T'],
      ['Selene', 'I don’t know.', 'S'],
      ['Tarrik', 'You think it was.', 'T'],
      ['Selene', 'I think it could have been.', 'S'],
      // he glances toward the door as though the answer might be standing beyond it
      () => lookAt('T', z.P(6, 16, 1.7)),
      ['Tarrik', 'What happened?', 'T'],
      ['Selene', 'I don’t know.', 'S'],
      ['Tarrik', 'Was I injured? Captured? Kneeling to Caelus?', 'otsT'],
      ['Selene', 'I don’t know.', 'S'],
      ['Tarrik', 'Very useful prophecy.', 'T'],
      ['Selene', 'I have raised similar objections.', 'S'],
      ['Tarrik', 'What did you hear?', 'T'],
      ['Selene', 'Do not let him kneel.', 'S'],
      ['Tarrik', 'That is specific.', 'T'],
      ['Selene', 'Yes.', 'S'],
      () => frame(z, c, 'two', 8),
      ['Selene', 'The bear.', null],
      ['Tarrik', 'What?', 'T'],
      ['Selene', 'Vesryn’s vision.', 'S'],
      ['Selene', 'The eagle abandons its nest.', null],
      ['Tarrik', 'You do not have to.', 'T'],
      ['Selene', 'Neither do you.', 'S'],
      ['Selene', 'If we begin using Vesryn’s visions as permission, we have learned nothing.', 'otsS'],
      ['Tarrik', 'We still choose.', 'T'],
      ['Selene', 'Yes.', 'S'],
      1.2,
    ];
    yield* run(z, c, e, tarrik);

    // ---- (f) the pact — four rules and a death clause; every one is heard ------------------------------------
    const f: Step[] = [
      // she activates the terminal authority summary
      () => projection(z, c, ['BOUNDARY STATE: CLOSED', 'TERMINAL RELEASE: AVAILABLE', 'RELEASE AUTHORITY: CONTRARY BEARER CONCURRENCE']),
      () => z.say('Command strip', 'BOUNDARY STATE: CLOSED · TERMINAL RELEASE: AVAILABLE · RELEASE AUTHORITY: CONTRARY BEARER CONCURRENCE', { channel: 'system' }),
      ['Tarrik', 'So Caelus cannot open it.', 'T'],
      ['Selene', 'No.', 'S'],
      ['Tarrik', 'Voss cannot.', 'T'],
      ['Selene', 'No.', 'S'],
      ['Tarrik', 'Only us.', 'two'],
      ['Selene', 'Yes.', null],
      ['Selene', 'The architecture now exists outside Aurelion.', 'S'],
      ['Tarrik', 'But final authorization does not.', 'T'],
      ['Selene', 'Correct.', 'S'],
      () => S.proj?.show(0, 1.5),
      ['Selene', 'We need rules.', 'otsS'],
      ['Tarrik', 'Of course you think that.', 'T'],
      ['Selene', 'Neither bearer authorizes terminal release unless the other is physically present', 'S'],
      ['Selene', 'or directly verified through Meridian recognition.', null],
      ['Tarrik', 'No government relay.', 'T'],
      ['Selene', 'No recorded assent.', 'S'],
      ['Tarrik', 'No proxy authorization.', 'T'],
      ['Selene', 'No extracted signature.', 'S'],
      ['Selene', 'Agreed. Second, if either bearer appears coerced, cognitively compromised, under Eclipse influence,', 'otsS'],
      ['Selene', 'or otherwise incapable of independent judgment, concurrence is automatically refused.', null],
      ['Tarrik', 'So if I ask you to open it, assume something is wrong with me.', 'T'],
      ['Selene', 'Yes.', 'S'],
      ['Selene', 'Third—', 'two', { duration: 1.0 }],
      // rule three is his: he cuts in and points at the Wound
      () => pointAtWound(z, c, tarrik, true),
      ['Tarrik', 'No controlled openings.', null],
      ['Tarrik', 'No test aperture, no opening it slightly, no specimen retrieval, and no research window.', 'T'],
      () => pointAtWound(z, c, tarrik, false),
      ['Tarrik', 'No one gets to crack the prison because they promise they only want to look.', null],
      ['Selene', 'Agreed.', 'S'],
      ['Selene', 'Fourth, neither government studies our bearer authority for purposes of bypassing concurrence.', 'otsS'],
      ['Tarrik', 'Cross will ask.', 'T'],
      ['Selene', 'The Defense Council will too.', 'S'],
      ['Tarrik', 'We refuse.', 'T'],
      ['Selene', 'Yes.', 'S'],
      ['Tarrik', 'If ordered?', 'T'],
      ['Selene', 'No.', 'S'],
      ['Tarrik', 'What if one of us dies?', 'high'],
      ['Selene', 'The surviving bearer does not improvise release authority.', 'S'],
      ['Tarrik', 'What if the prison has to be opened?', 'T'],
      ['Selene', 'Then the terminal must recognize another contrary witness.', 'S'],
      ['Tarrik', 'And if it doesn’t?', 'otsT'],
      ['Selene', 'Then it stays closed.', 'S'],
      ['Tarrik', 'Agreed.', 'T'],
      () => z.story('pactAgreed'),
      1.4,
    ];
    yield* run(z, c, f, tarrik);

    // ---- (g) parting on purpose -------------------------------------------------------------------------------
    const gp: Step[] = [
      ['Selene', 'We should separate.', 'two'],
      ['Tarrik', 'So quickly.', 'T'],
      ['Selene', 'The safest location for two people required to open the prison is not the same location.', 'S'],
      ['Tarrik', 'If I do not return, Cross gets to explain Aurelion to Caelus first.', 'T'],
      ['Selene', 'That does seem irresponsible.', 'S'],
      ['Tarrik', 'Extremely.', 'T'],
      ['Selene', 'Then you should go.', 'otsS'],
      ['Tarrik', 'You say that easily.', 'T'],
      ['Selene', joined('No.', 'I don’t.'), 'S'],
      () => frame(z, c, 'wide', 6),
      2.4,
    ];
    yield* run(z, c, gp, tarrik);

    // end state — both seated (the linger window); the evidence where the exchange left it; projections dark
    S.proj?.show(0, 0.5);
    evidenceAfterExchange(z);
    sitTarrik(z, tarrik);
    if (!S.seated) sitPlayer(z);
    hold(z.player, 'L', null);
    hold(z.player, 'R', null);
    hold(tarrik, 'L', null);
    hold(tarrik, 'R', null);
    lookAt('T', null);
    lookAt('S', null);
    z.story('evidenceExchanged');
    z.story('pactAgreed');
  }, { blendOut: 1.2 });
}

/** the command-strip projection over the table, framed over Tarrik's shoulder */
function projection(z: ZoneRuntime, c: CineCtx, lines: string[]): void {
  const p = S.proj;
  if (!p) return;
  placePanels(z);
  p.show(0, 0.08);
  p.update(0, true);
  p.setLines(lines);
  p.show(1, 0.45);
  frame(z, c, 'otsS', 8);
  if (!z.skipping) z.game.audio.play('ambConsoleTick', { pos: z.m('tableCentre') });
}

function* fieldSeal(z: ZoneRuntime, c: CineCtx, tarrik: Companion | null, sp: Spots): Routine {
  frame(z, c, 'table', 6);
  carry(S.seal, tarrik?.actor ?? null, 'handL');
  yield 0.7;
  rest(S.seal, sp.recT.clone().setY(sp.seal.y));
  slide(S.seal, sp.seal, 0.9);
  hold(tarrik, 'L', S.seal);
  yield 1.0;
  hold(tarrik, 'L', null);
  // she looks at it
  humanoid(z.player)?.lookAt(sp.seal);
  frame(z, c, 'S', 4);
  yield 2.0;
  humanoid(z.player)?.lookAt(null);
}

function* recorderAcross(z: ZoneRuntime, c: CineCtx, tarrik: Companion | null, sp: Spots): Routine {
  frame(z, c, 'table', 7);
  carry(S.recorder, tarrik?.actor ?? null, 'handR');
  tarrik?.play('handOver');
  yield 0.8;
  rest(S.recorder, sp.recT);
  hold(tarrik, 'R', S.recorder);
  yield 0.3;
  slide(S.recorder, sp.recS, 1.2);
  if (!z.skipping) z.game.audio.play('evidenceExchange', { pos: sp.recT, volume: 0.6 });
  yield 1.3;
  hold(tarrik, 'R', null);
  frame(z, c, 'S', 4);
  yield 1.6;
}

function* takeRecorder(z: ZoneRuntime, c: CineCtx, sp: Spots): Routine {
  frame(z, c, 'table', 5);
  hold(z.player, 'L', S.recorder);
  yield 0.7;
  carry(S.recorder, z.player, 'handL');
  yield 0.5;
  hold(z.player, 'L', null);
  rest(S.recorder, sp.recS.clone().add(new THREE.Vector3(0.06, 0, 0.1)));
  yield 0.4;
}

function* waferDown(z: ZoneRuntime, c: CineCtx, sp: Spots): Routine {
  frame(z, c, 'table', 5);
  carry(S.wafer, z.player, 'handR');
  yield 0.6;
  rest(S.wafer, sp.wafMid);
  hold(z.player, 'R', S.wafer);
  yield 0.8;
  hold(z.player, 'R', null);
  yield 0.4;
}

function* handsTouch(z: ZoneRuntime, c: CineCtx, tarrik: Companion | null, sp: Spots): Routine {
  frame(z, c, 'table', 5);
  hold(z.player, 'R', S.wafer);
  yield 0.5;
  hold(tarrik, 'R', S.wafer);
  yield 1.1;
  // he takes it; her hand stays a fraction longer
  carry(S.wafer, tarrik?.actor ?? null, 'handR');
  yield 0.35;
  hold(z.player, 'R', null);
  yield 0.4;
  hold(tarrik, 'R', null);
  rest(S.wafer, sp.wafT);
  yield 0.3;
}

/** rule three: his hand goes up toward the Wound beyond the glass, then comes down */
function pointAtWound(z: ZoneRuntime, c: CineCtx, tarrik: Companion | null, on: boolean): void {
  if (!on) {
    hold(tarrik, 'R', null);
    humanoid(tarrik?.actor)?.lookAt(null);
    return;
  }
  frame(z, c, 'wound', 6);
  const t = z.m(SEAT_T);
  hold(tarrik, 'R', t.clone().add(new THREE.Vector3(0.35, 1.45, -0.55)));
  humanoid(tarrik?.actor)?.lookAt(z.m('window').setY(4));
}

// =====================================================================================================================
// The fleet alert — when the player leaves the table, or after O4 (SCRIPT_SOURCE Z11 (g), end)
// =====================================================================================================================

export function* alertScene(z: ZoneRuntime): Routine {
  const g = z.game;
  const tarrik = z.cast('tarrik');
  yield* z.cinematic('z11-alert', function* (c: CineCtx): Routine {
    resetCover();
    placePanels(z);
    const alert = S.alert;
    alert?.setLines(['CEASEFIRE VIOLATION RISK: RISING']);
    frame(z, c, 'two', 7);
    yield 0.4;
    // “A fleet alert appears across the room.”
    alert?.show(1, 0.3);
    if (!z.skipping) g.audio.play('ambPA', { pos: z.m('window') });
    yield 0.6;
    yield* z.say('Fleet alert', 'CEASEFIRE VIOLATION RISK: RISING', { channel: 'system' }); // speaker label NEW
    yield* run(z, c, [['Tarrik', 'We’re running out of time.', 'T'], ['Selene', 'Yes.', 'S']], tarrik);
    // “Selene rises. Tarrik remains seated for half a second before standing.” — she takes the recorder; he the wafer
    frame(z, c, 'T', 4);
    if (S.seated) standPlayer(z, 'seleneRise');
    carry(S.recorder, z.player, 'handL');
    yield 0.55;
    standTarrik(z, tarrik, 'tarrikRise');
    hide(S.wafer);
    c.cut({ pos: z.P(17.4, 21.2, 1.9), look: z.P(11.8, 28.2, 1.6), fov: 40 });
    c.moveAsync({ pos: z.P(17.0, 21.6, 1.85), look: z.P(11.8, 28.2, 1.6), fov: 39 }, 3, 'inOut');
    yield 2.0;
    // end state
    alert?.show(0.5, 2);
    if (S.seated) standPlayer(z, 'seleneRise');
    comm(S.commS, null, null);
    hold(z.player, 'L', null);
    if (tarrik) {
      tarrik.stopAction();
      tarrik.mode = 'follow';
      tarrik.follow(z.player, { right: -1.1, back: 1.3 });
    }
    S.sp?.exit?.setState('ready');
  }, { blendOut: 0.8 });
}
