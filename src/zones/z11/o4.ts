/**
 * Z11 `linger` — O4 (optional; SCRIPT_SOURCE Z11 `linger`): Darek, Lyessa, Voss. She stays at the table — the
 * woman who stands because “It is easier to leave.” sits back down — and the conversation the plan made optional
 * plays in the book's own order: Cauldron (with the book's narration of Gate Nine on cards, ruling 10), Voss,
 * belief, “I lied.” in its two blocks, and the closing exchange. Every line is the author's, exact; nothing is new.
 * Selene will not say Lyessa was wrong to fire; she says everything after it was wrong. The scene is skippable and
 * changes no state but `optional.O4` (set by the caller).
 */
import type { CineCtx, Routine, ZoneRuntime } from '@/core/api';
import { S, carry, humanoid } from './state';
import { frame, joined, resetCover, run, type Step } from './stage';

/** the book narrates Gate Nine and gives Tarrik no words for it: shown on cards, exact */
const GATE_NINE = [
  'Then he tells her about Gate Nine.',
  'Darek stumbled through the smoke with a green scan and a puncture wound.',
  'There was not enough evidence to condemn him and too much risk to trust the result. Lyessa raised Egdredil.',
];

export function* o4Scene(z: ZoneRuntime): Routine {
  const g = z.game;
  const tarrik = z.cast('tarrik');
  yield* z.cinematic('z11-o4', function* (c: CineCtx): Routine {
    resetCover();
    // she is holding the recorder; his voice flattens
    carry(S.recorder, z.player, 'handL');
    frame(z, c, 'two', 8);
    yield 1.6;

    const cauldron: Step[] = [
      ['Selene', 'Tell me about Cauldron.', 'S'],
      ['Tarrik', 'Where do you want me to start?', 'T'],
      ['Selene', 'The part you have not told anyone who wasn’t there.', 'S'],
      ['Tarrik', joined('Darek.', 'My brother.'), 'T'],
      ['Tarrik', 'He was three years older and better at almost everything until I was fourteen.', null],
      ['Tarrik', 'He hated ceremonies.', 'otsT'],
      ['Tarrik', 'Every time Crownwatch put us through one, he would whisper how many exits were in the room', null],
      ['Tarrik', 'and which one he thought he could reach before our father noticed.', null],
      ['Selene', 'Your father.', 'S'],
      ['Tarrik', 'Not Caelus.', 'T'],
      ['Tarrik', 'When our mother died, people spent three days explaining what grief was supposed to look like.', 'wide'],
      ['Tarrik', 'Darek spent the funeral whispering descriptions of everyone who came to offer condolences', null],
      ['Tarrik', 'until I laughed during the final prayer.', 'T'],
      ['Selene', 'What happened?', 'S'],
      ['Tarrik', 'Darek took the blame.', 'T'],
      1.2,
    ];
    yield* run(z, c, cauldron, tarrik);

    // Gate Nine: the book's narration, on cards over the darkened room
    frame(z, c, 'T', 14);
    if (!z.skipping) g.ui.fade(0.84, 1.2, 'black');
    yield 1.3;
    for (const card of GATE_NINE) {
      if (!z.skipping) g.ui.card(card, { style: 'context' });
      yield 2.2 + card.length * 0.045;
    }
    g.ui.card(null);
    g.ui.fade(0, 1.2);
    yield 1.4;

    const gate: Step[] = [
      ['Tarrik', 'She shot him in the chest.', 'T'],
      ['Tarrik', 'He stayed standing, so she shot him again.', null],
      ['Tarrik', 'She didn’t know.', 'otsT'],
      ['Selene', 'Whether he was infected.', 'S'],
      ['Tarrik', 'No.', 'T'],
      ['Selene', 'Did Darek know?', 'S'],
      ['Tarrik', joined('No.', 'Tell me she was wrong.'), 'T'],
      // Selene does not: she refuses him the easy answer
      1.2,
      ['Selene', 'I don’t know whether pulling the trigger was wrong.', 'S'],
      ['Selene', 'She had incomplete evidence. Waiting may have risked a catastrophic breach.', null],
      ['Selene', 'Acting made one consequence certain for Darek.', 'otsS'],
      ['Tarrik', 'That sounds like a very Reformation answer.', 'T'],
      ['Selene', 'It is a very unpleasant answer.', 'S'],
      ['Selene', 'But I know everything afterward was wrong.', null],
      ['Selene', 'The memorial was not an uncertain decision.', 'otsS'],
      ['Selene', 'Neither was the falsified report, or allowing you to believe Reformation forces killed him.', null],
      ['Selene', 'The first choice may have been made because she believed hesitation could kill thousands.', 'S'],
      ['Selene', 'The next morning wasn’t.', null],
      ['Tarrik', 'I told her that.', 'T'],
      ['Selene', 'What did she say?', 'S'],
      ['Tarrik', 'That she wanted one more day.', 'T'],
      ['Selene', 'One more day of what?', 'S'],
      ['Tarrik', 'Me loving her the way I did before I knew.', 'T'],
      2.0,
    ];
    yield* run(z, c, gate, tarrik);

    const voss: Step[] = [
      ['Selene', 'Voss would understand her.', 'two'],
      ['Tarrik', 'You say that like it is not an insult.', 'T'],
      ['Selene', 'It isn’t. The scale is different. The logic isn’t.', 'S'],
      ['Selene', 'Voss knows.', null],
      ['Tarrik', 'How long?', 'T'],
      ['Selene', 'Eleven years.', 'S'],
      ['Tarrik', 'She inherited the lie.', 'T'],
      ['Selene', 'At first.', 'S'],
      ['Selene', 'She challenged it.', null],
      ['Tarrik', 'How long?', 'otsT'],
      ['Selene', 'Six months.', 'S'],
      ['Tarrik', 'What happened after that?', 'T'],
      ['Selene', 'She chose to preserve it.', 'S'],
      ['Tarrik', 'Why?', 'T'],
      ['Selene', 'Because the Reformation works. Hospitals function. Courts function.', 'S'],
      ['Tarrik', 'And she thinks one altered record destroys all of that.', 'T'],
      ['Selene', 'No. She thinks people who already want to destroy those institutions will use the record as proof', 'S'],
      ['Selene', 'that everything after the Sundering was fraudulent.', null],
      ['Tarrik', 'They will.', 'T'],
      ['Selene', 'Yes.', 'S'],
      ['Tarrik', 'Do you think she is wrong?', 'otsT'],
      ['Selene', 'Not about all of it. She is wrong about what those risks permit her to do.', 'S'],
      ['Selene', 'I confronted her.', null],
      ['Tarrik', 'How did that go?', 'T'],
      ['Selene', 'She offered me a promotion.', 'S'],
      ['Tarrik', 'You’re joking.', 'T'],
      ['Selene', 'No.', 'S'],
      ['Tarrik', 'I like her.', 'T'],
      ['Selene', 'You should not.', 'S'],
      1.0,
    ];
    yield* run(z, c, voss, tarrik);

    const belief: Step[] = [
      ['Tarrik', 'You still believe in the Reformation.', 'T'],
      ['Selene', 'Yes.', 'S'],
      ['Selene', 'Those things happened because the Reformation failed one of its principles.', null],
      ['Selene', 'The failure does not make the principle false.', 'otsS'],
      ['Selene', 'You still believe in the Dominion.', 'S'],
      ['Tarrik', 'Yes. I do not know what that means anymore.', 'T'],
      ['Selene', 'Neither do I.', 'S'],
      1.4,
    ];
    yield* run(z, c, belief, tarrik);

    // “I lied.” — block 1, the lie
    const lie: Step[] = [
      ['Selene', 'There is more.', 'two'],
      ['Tarrik', 'Of course there is.', 'T'],
      ['Selene', 'I lied.', 'S'],
      ['Selene', 'At the Forum.', null],
      ['Selene', 'A historian asked whether the public Admonition had been deliberately altered.', null],
      ['Tarrik', 'What did you tell him?', 'otsT'],
      ['Selene', 'That the question was part of an active provenance review.', 'S'],
      ['Tarrik', 'You knew the answer.', 'T'],
      ['Selene', 'Yes.', 'S'],
      ['Tarrik', 'That was a lie.', 'T'],
      ['Selene', 'Yes.', 'S'],
      // she starts to assemble a technical defense; then she lets all of it go
      1.6,
      ['Tarrik', 'Why?', 'T'],
      ['Selene', 'By then I knew the Meridian had a fifth Crownmark.', 'S'],
      ['Selene', 'I knew the terminal was linked to containment, and I knew governments were already reacting to the first four.', null],
      ['Selene', 'I believed that if I confirmed the full conspiracy immediately,', 'otsS'],
      ['Selene', 'someone would connect the historical suppression to the active Meridian', null],
      // she gestures toward the fleets beyond the Wound
      () => frame(z, c, 'wide', 7),
      ['Selene', 'and decide whatever remained had to be reached first.', null],
      ['Tarrik', 'You were right.', 'T'],
      ['Selene', joined('About the danger.', 'Not about the lie.'), 'S'],
      ['Tarrik', 'A bad outcome does not retroactively make concealment good.', 'T'],
      ['Selene', 'No.', 'S'],
      1.2,
    ];
    yield* run(z, c, lie, tarrik);

    // block 2 — Lyric's verdict (ends on Selene's second laugh)
    const lyric: Step[] = [
      ['Tarrik', 'Who told you that?', 'T'],
      ['Selene', 'Lyric.', 'S'],
      ['Tarrik', 'Of course.', 'T'],
      ['Selene', 'She asked how it felt.', 'S'],
      ['Tarrik', 'What?', 'T'],
      ['Selene', 'Not telling them.', 'S'],
      ['Tarrik', 'What did you say?', 'otsT'],
      ['Selene', 'Necessary.', 'S'],
      ['Tarrik', 'That sounds terrible.', 'T'],
      ['Selene', 'She thought so.', 'S'],
      ['Tarrik', 'What did she say?', 'T'],
      ['Selene', 'That wasn’t what I asked.', 'S'],
      // Tarrik smiles
      ['Tarrik', 'What did you tell her?', 'T'],
      ['Selene', 'That it felt awful.', 'S'],
      ['Tarrik', 'And?', 'T'],
      ['Selene', 'She said, ‘Good. Keep it awful.’', 'S'],
      ['Tarrik', 'I like her.', 'two'],
      ['Selene', 'You have spoken to her for approximately four minutes.', 'S'],
      ['Tarrik', 'She threatened me during half of them.', 'T'],
      ['Selene', 'That improves your assessment?', 'S'],
      ['Tarrik', 'Usually.', 'T'],
      // “Selene laughs again, more quietly this time, and Tarrik smiles before he can stop himself.”
      () => frame(z, c, 'two', 6),
      2.4,
    ];
    yield* run(z, c, lyric, tarrik);

    // closing — the book's last exchange before the fleet alert
    const closing: Step[] = [
      ['Selene', 'Do you hate her?', 'S'],
      ['Tarrik', 'No.', 'T'],
      ['Tarrik', 'Voss?', null],
      ['Selene', 'No.', 'S'],
      ['Tarrik', 'It would be easier.', 'T'],
      ['Selene', 'Yes.', 'S'],
      ['Tarrik', 'Is that why it hurts?', 'otsT'],
      ['Selene', joined('Partly.', 'Betrayal only works when something worth trusting existed first.'), 'S'],
      ['Tarrik', 'Inconvenient.', 'T'],
      ['Selene', 'Yes.', 'S'],
      () => frame(z, c, 'wide', 6),
      2.2,
    ];
    yield* run(z, c, closing, tarrik);

    // end state: she still holds the recorder; the screen is clear
    g.ui.card(null);
    g.ui.fade(0, 0.4);
    humanoid(z.player)?.lookAt(null);
  }, { blendOut: 0.8 });
}
