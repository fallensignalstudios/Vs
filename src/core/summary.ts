/**
 * Mission-complete summary (FOUNDATION). Pure: MissionState in, rows out — `flow.ts` hands them to the UI.
 *
 * Wording is fixed by SCRIPT_SOURCE.md «System text»: first the book's four states, then the records in neutral
 * words. No «victory», no word that calls the prison safe, no score and no right answer for either choice; the
 * carrier is never «rescued», «saved» or «diverted» and there is no survivor count.
 */
import type { MissionState, MissionSummary } from './api';

type Row = MissionSummary['lines'][number];

export function buildMissionSummary(state: MissionState): MissionSummary {
  const flags = state.flags ?? {};
  const lines: Row[] = [
    // the book's states (ch26) — fixed outcomes of the mission
    { label: 'Boundary state', value: 'Closed' },
    { label: 'Sovereign Meridian', value: 'Complete' },
    { label: 'Release command', value: 'Withheld' },
    { label: 'Terminal release', value: 'Requires contrary bearer concurrence' },
  ];
  // the records
  if (flags.carrierLost === true) lines.push({ label: 'Reformation carrier', value: 'Lost with all hands' });
  lines.push({
    label: 'Local priority',
    value: state.rescuePriority === 'WestStretchers' ? 'West — stretcher cases first'
      : state.rescuePriority === 'EastWalkers' ? 'East — walking wounded first'
        : 'Unrecorded',
  });
  if (flags.officerFate === 'killed') lines.push({ label: 'The officer', value: 'Killed at his request' });
  else if (flags.officerFate === 'spared') lines.push({ label: 'The officer', value: 'Spared — fate unknown' });
  if (flags.evidenceExchanged === true) lines.push({ label: 'Evidence', value: 'Exchanged' });
  if (flags.pactAgreed === true) lines.push({ label: 'Pact', value: 'Agreed' });
  const optional = Object.values(state.optional ?? {}).filter(Boolean).length;
  const seconds = Math.max(0, Number(state.stats?.playSeconds) || 0);
  lines.push({ label: 'Optional records', value: `${optional} / 4` });
  lines.push({ label: 'Mission time', value: `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` });
  return { state, lines };
}
