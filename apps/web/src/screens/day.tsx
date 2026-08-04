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
  runDay, clockLabel, CLINIC_DAY,
  theJourney, needsOwner, journeyCompleteness,
  type DailyStandard, type RunItem, type ClinicState,
} from '@kubi/contracts';
import {
  Screen, Title, Answer, Group, Row, Tag, Switch, Action, Empty, type Tone,
} from '../ui.js';

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
  const [view, setView] = useState<'DAY' | 'RUN' | 'PATIENT' | 'TRUST'>('DAY');
  const mix = proofMix();
  const gaps = ungoverned();

  return (
    <>
      {/* One answer per screen. Each view brings its own, so the standard's
          headline is the standard's — stacking two was the exact mistake this
          product spent a week removing. */}
      <Switch
        value={view}
        onChange={setView}
        options={[
          { value: 'DAY', label: 'The standard' },
          { value: 'RUN', label: 'Watch it run' },
          { value: 'PATIENT', label: 'Every patient' },
          { value: 'TRUST', label: 'Taken on trust', count: gaps.length },
        ]}
      />

      {view === 'RUN' && <Run />}
      {view === 'PATIENT' && <PatientJourney />}

      {view === 'DAY' && (
        <Answer
          verdict={`${DAILY_STANDARD.length} things happen every day`}
          why={`Whatever the patient load. ${theDay()[0]?.items.length ?? 0} before you open, `
            + `${theDay().at(-1)?.items.length ?? 0} before you lock up. `
            + `${mix.CONFIRMATION + mix.NOT_YET} of them close because somebody says so.`}
          tone="calm"
        />
      )}

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

/* -------------------------------------------------------------------------
 * Watch it run
 *
 * The owner's words were *"I see no systemized running"*, and they were fair.
 * KuBi had a standard, a control matrix and an escalation ladder, each on its
 * own screen, and nowhere you could watch them act on one another.
 *
 * So: a clock you move, and a clinic that responds. Set it to nine and the
 * doors are still shut, with the reasons named. Tick the opening set and they
 * open. Leave the eleven o'clock washroom round and watch it go late, climb
 * the ladder — and reach nobody, because no control governs housekeeping.
 * That last part is the point. It is the decision the owner has to make,
 * shown rather than asked.
 *
 * Every state here comes from `runDay()` in contracts, which is pure and has
 * seventeen tests standing at specific minutes. This file only draws it.
 * ---------------------------------------------------------------------- */

const MOMENTS: Array<{ value: string; label: string; at: number }> = [
  { value: 'EARLY', label: '8:00am', at: CLINIC_DAY.staffArrive },
  { value: 'OPEN', label: '9:00am', at: CLINIC_DAY.opens },
  { value: 'MID', label: '11:20am', at: 11 * 60 + 20 },
  { value: 'LUNCH', label: '2:00pm', at: CLINIC_DAY.lunch },
  { value: 'LAST', label: '7:30pm', at: CLINIC_DAY.lastPatient },
  { value: 'LOCK', label: '8:40pm', at: 20 * 60 + 40 },
];

const CLINIC_TONE: Record<ClinicState, Tone> = {
  LOCKED: 'calm', PREPARING: 'warn', OPEN: 'good', CLOSING: 'warn', CLOSED: 'good',
};
const CLINIC_WORD: Record<ClinicState, string> = {
  LOCKED: 'Locked', PREPARING: 'Not open yet', OPEN: 'Open',
  CLOSING: 'Closing', CLOSED: 'Closed for the day',
};

function Run() {
  const [now, setNow] = useState(CLINIC_DAY.opens);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const day = runDay(now, done);

  const tick = (key: string) => setDone((d) => new Set([...d, key]));

  return (
    <>
      {/* Where the clinic is, and why — the same question every KuBi screen
          leads with, except here you can move the cause. */}
      <Answer
        verdict={`${CLINIC_WORD[day.clinic]} · ${day.nowLabel}`}
        why={day.why}
        tone={CLINIC_TONE[day.clinic]}
      />

      <Switch
        value={MOMENTS.find((m) => m.at === now)?.value ?? 'CUSTOM'}
        onChange={(v) => setNow(MOMENTS.find((m) => m.value === v)?.at ?? now)}
        options={MOMENTS.map((m) => ({ value: m.value, label: m.label }))}
      />

      <Action quiet onClick={() => setNow((n) => Math.min(n + 15, 22 * 60))}>
        Move the clock on fifteen minutes — {clockLabel(Math.min(now + 15, 22 * 60))}
      </Action>

      {day.blocking.length > 0 && (
        <Group
          title={day.clinic === 'CLOSING' ? 'Holding the keys' : 'Holding the doors'}
          count={day.blocking.length}
          note="Press one to do it. The clinic moves when the last of them is done."
          tone="warn"
        >
          {day.blocking.map((i) => <RunRow key={i.key} i={i} onDo={() => tick(i.key)} />)}
        </Group>
      )}

      <Group
        title="Late right now"
        count={day.late.length}
        note="Minutes are counted from when it was due, not from when anybody noticed."
        {...(day.late.length > 0 ? { tone: 'stop' as const } : {})}
      >
        {day.late.length === 0
          ? <Empty>Nothing is late.</Empty>
          : day.late.map((i) => <RunRow key={i.key} i={i} onDo={() => tick(i.key)} />)}
      </Group>

      {/* The finding, running. Not an argument — a count that climbs as the
          day goes on and never reaches anybody. */}
      {day.unsupervised.length > 0 && (
        <Group
          title="Late, and reaching nobody"
          count={day.unsupervised.length}
          note="No control governs these, so there is no ladder for them to climb.
                This is the decision waiting on you."
          tone="stop"
        >
          {day.unsupervised.map((i) => <RunRow key={i.key} i={i} onDo={() => tick(i.key)} />)}
        </Group>
      )}

      <Group
        title="Raised by a patient, not by the clock"
        count={day.patientDriven.length}
        note="These thirteen have no time of day. A patient arriving raises them."
      >
        {day.patientDriven.map((s) => <Standard key={s.id} s={s} />)}
      </Group>
    </>
  );
}

function RunRow({ i, onDo }: { i: RunItem; onDo: () => void }) {
  const late = i.state === 'LATE';
  return (
    <Row
      title={i.standard.task}
      note={late
        ? `Due ${clockLabel(i.dueAt)} · ${i.minutesLate} minutes late`
        : `Due ${clockLabel(i.dueAt)}`}
      {...(late ? { tone: 'stop' as const } : {})}
      tags={(
        <>
          <Tag>{role(i.standard.role)}</Tag>
          {/* Where it has climbed to — or that there is nowhere for it to go. */}
          {i.unsupervised
            ? <Tag tone="stop">escalates to nobody</Tag>
            : i.escalatedTo
              ? <Tag tone="warn">L{i.level} · {role(i.escalatedTo)}</Tag>
              : <Tag>not escalated yet</Tag>}
        </>
      )}
      onOpen={onDo}
    />
  );
}

/* -------------------------------------------------------------------------
 * Every patient
 *
 * Thirteen stages, ninety-six tasks. Stages 1 and 2 arrived with an owner and
 * a standard against every task; stages 3 to 13 arrived with those columns
 * blank, and they are shown blank. Filling them in with a plausible role would
 * make the library look finished and name the wrong person the first time
 * something went wrong.
 * ---------------------------------------------------------------------- */

function PatientJourney() {
  const done = journeyCompleteness();

  return (
    <>
      <Answer
        verdict={`${done.tasks} tasks, ${done.owned} with an owner`}
        why={`Thirteen stages from booking to case completion. `
          + `${needsOwner().length} of them have nobody assigned and no standard set — `
          + `and a task with no owner cannot escalate to anybody when it does not happen.`}
        tone="warn"
      />

      {theJourney().map((stage) => (
        <Group key={stage.stage} title={stage.label} count={stage.tasks.length}>
          {stage.tasks.map((p) => (
            <Row
              key={p.id}
              title={p.task}
              {...(p.kpi ? { note: p.kpi } : {})}
              {...(p.role === null ? { tone: 'warn' as const } : {})}
              tags={(
                <>
                  {p.role
                    ? <Tag>{role(p.role)}</Tag>
                    : <Tag tone="warn">owner not decided</Tag>}
                  {p.covers
                    ? <Tag mono>{p.covers}</Tag>
                    : <Tag tone="warn">no control yet</Tag>}
                </>
              )}
            />
          ))}
        </Group>
      ))}
    </>
  );
}
