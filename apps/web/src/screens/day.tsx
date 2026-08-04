/**
 * The day — the clinic's operating standard, on screen.
 *
 * The owner's brief was *"everyone should know how it moves"*. This is that
 * screen, and it is deliberately the first thing under Standards rather than
 * the last: a new assistant on her first morning should be able to read the
 * whole shape of a day in one scroll, before she has learned a single menu.
 *
 * Nothing here is authored. Every row comes out of DAILY_STANDARD in
 * contracts, in the owner's own words, ordered by the one rhythm the library
 * defines. If somebody adds a non-negotiable, it appears here without this
 * file changing — which is the difference between a library and a document.
 *
 * The second view is the one that makes it honest. Seventeen of the
 * forty-seven have no control behind them and five cannot be proved at all,
 * and a screen that quietly rendered forty-seven identical rows would be
 * claiming a clinic is governed when half of it is being taken on trust.
 */
import { useState } from 'react';
import {
  theDay, unproven, ungoverned, proofMix, DAILY_STANDARD,
  RHYTHM_LABEL, Proof, isGate,
  type DailyStandard,
} from '@kubi/contracts';
import { Screen, Title, Answer, Group, Row, Tag, Switch, type Tone } from '../ui.js';

/** How much a row can be trusted, in one word. */
const PROOF_WORD: Record<string, string> = {
  SYSTEM: 'KuBi knows',
  READING: 'a reading',
  CONFIRMATION: 'somebody says so',
  NOT_YET: 'cannot be proved',
};
const PROOF_TONE: Record<string, Tone> = {
  SYSTEM: 'good', READING: 'good', CONFIRMATION: 'calm', NOT_YET: 'stop',
};

const role = (r: string) => r.replace(/_/g, ' ').toLowerCase();

export function TheDay() {
  const [view, setView] = useState<'DAY' | 'TRUST'>('DAY');
  const mix = proofMix();
  const gaps = ungoverned();

  return (
    <>
      <Answer
        verdict={`${DAILY_STANDARD.length} things happen every day`}
        why={`Whatever the patient load. ${theDay()[0]?.items.length ?? 0} before you open, `
          + `${theDay().at(-1)?.items.length ?? 0} before you lock up. `
          + `${mix.CONFIRMATION + mix.NOT_YET} of them close because somebody says so.`}
        tone="calm"
      />

      <Switch
        value={view}
        onChange={setView}
        options={[
          { value: 'DAY', label: 'How the day moves' },
          { value: 'TRUST', label: 'What is taken on trust', count: gaps.length },
        ]}
      />

      {view === 'DAY' && theDay().map((slot) => (
        <Group
          key={slot.rhythm}
          title={slot.label}
          count={slot.items.length}
          /* The two gates are the ones that stop a clinic. The middle five are
             cadences — being behind on the washroom round raises an exception,
             it does not hold the doors shut. */
          {...(isGate(slot.rhythm)
            ? {
              note: 'The clinic does not move past this with any of it outstanding.',
              tone: 'warn' as const,
            }
            : {})}
        >
          {slot.items.map((s) => <Standard key={s.id} s={s} />)}
        </Group>
      ))}

      {view === 'TRUST' && (
        <>
          <Group
            title="Nothing governs these yet"
            count={gaps.length}
            note="They are in the standard and in nobody's control matrix. Each one says why."
          >
            {gaps.map((s) => <Standard key={s.id} s={s} showGap />)}
          </Group>

          <Group
            title="KuBi cannot prove these at all"
            count={unproven().length}
            note="A tick next to one of these would be an audit trail that is confidently wrong."
            tone="stop"
          >
            {unproven().map((s) => <Standard key={s.id} s={s} showGap />)}
          </Group>
        </>
      )}
    </>
  );
}

function Standard({ s, showGap }: { s: DailyStandard; showGap?: boolean }) {
  return (
    <Row
      title={s.task}
      /* The owner's KPI, verbatim. A standard nobody can quote is not a
         standard, so it sits on the row rather than behind a tap. */
      note={showGap && s.gap ? `${s.standard} — ${s.gap}` : s.standard}
      {...(s.proof === Proof.NOT_YET ? { tone: 'stop' as const } : {})}
      tags={(
        <>
          <Tag>{role(s.role)}</Tag>
          {/* Only where the grouping does not already say it. Under "Before
              opening", a BEFORE OPENING tag on every row is noise. */}
          {showGap && <Tag>{RHYTHM_LABEL[s.rhythm].toLowerCase()}</Tag>}
          {/* Which control governs it, or that none does. Never blank: blank
              would read as "fine" rather than as "nobody owns this". */}
          {s.covers
            ? <Tag mono>{s.covers}</Tag>
            : <Tag tone="warn">no control yet</Tag>}
          <Tag tone={PROOF_TONE[s.proof] ?? 'calm'}>{PROOF_WORD[s.proof] ?? s.proof}</Tag>
        </>
      )}
    />
  );
}

/** Standalone, for the command palette and anywhere else that lands on it. */
export function DayScreen() {
  return (
    <Screen wide>
      <Title question="What must happen today, whatever else does.">
        The clinic’s day
      </Title>
      <TheDay />
    </Screen>
  );
}
