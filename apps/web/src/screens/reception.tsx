import { useState } from 'react';
import {
  api, type ReceptionScreenView, type SlotView, type CoverScreenView,
} from '../api.js';
import {
  Screen, Title, Answer, Group, Fact, Facts, Notice, Switch,
  useLoad, Loading, Failed, type Tone,
} from '../ui.js';

/**
 * RECEPTION — the appointment book and the front desk.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The missing link, and what it links
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every other screen in KuBi starts from a booking that already exists. The
 * morning works backwards from the first appointment; readiness measures
 * itself against it; the horizon warns before a patient reaches a chair.
 * Nothing produced that appointment. This screen is where it comes from, which
 * is why it sits directly after clinic readiness on the rail — *the clinic is
 * made ready, then the patient arrives, then the patient event happens.*
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The day, not a table
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A booking list sorted by time with a status column is what every practice
 * management system already shows, and it is why reception ends up keeping a
 * paper list beside it. What reception actually needs to know at 09:15 is
 * *which of these is going to go wrong*, and the slot row is built around that
 * — the problems are the body of the row, not a warning triangle you hover.
 *
 * Nothing here decides anything. The engine has already asked attendance
 * whether this slot's own assistant is in the building, the equipment register
 * whether its room may take a patient, and compliance whether a special
 * patient's preparation is done.
 */

const hhmm = (m: number | null | undefined): string =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/* Spelled out rather than built from the state, so the library test can see
   every class name this file uses. */
const SLOT_CLASS: Record<SlotView['state'], string> = {
  UNCONFIRMED: 'slot slot-open',
  CONFIRMED: 'slot slot-ok',
  CANCELLED: 'slot slot-off',
  ARRIVED: 'slot slot-here',
  SEATED: 'slot slot-ok',
  LATE: 'slot slot-late',
  NO_SHOW: 'slot slot-bad',
};

const STATE_WORD: Record<SlotView['state'], string> = {
  UNCONFIRMED: 'Not confirmed',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  ARRIVED: 'Waiting',
  SEATED: 'In the chair',
  LATE: 'Call them now',
  NO_SHOW: 'Did not arrive',
};

const COVER_CLASS: Record<CoverScreenView['rooms'][number]['state'], string> = {
  COVERED: 'chair is-done',
  STOOD_IN: 'chair is-warn',
  UNCOVERED: 'chair is-bad',
  UNUSED: 'chair is-dim',
};

const COVER_WORD: Record<CoverScreenView['rooms'][number]['state'], string> = {
  COVERED: 'Covered',
  STOOD_IN: 'Stand-in',
  UNCOVERED: 'Nobody',
  UNUSED: 'Not in use',
};

const PRIORITY_CLASS: Record<string, string> = {
  PS: 'slot-why is-bad',
  C: 'slot-why is-bad',
  I: 'slot-why is-warn',
  R: 'slot-why',
};

/**
 * One appointment, built around what is going to go wrong with it.
 *
 * The problems are the body of the row rather than an icon, because a row that
 * hides its own findings is a row somebody has to click every one of to find
 * the two that matter.
 */
function Slot({ s }: { s: SlotView }) {
  return (
    <div className={SLOT_CLASS[s.state]}>
      <div className="slot-head">
        <span className="slot-time">{hhmm(s.at)}</span>
        <span className="slot-who">
          <b className="slot-name">{s.patientLabel}</b>
          {s.isNewPatient && <span className="slot-tag">New</span>}
          {s.special && <span className="slot-tag is-warn">Needs preparation</span>}
        </span>
        <span className="slot-state">{STATE_WORD[s.state]}</span>
      </div>

      <div className="slot-meta">
        {[
          s.treatmentName,
          s.operatoryId ? `Operatory ${s.operatoryId.replace('op-', '')}` : 'No room',
          `${s.endsAt - s.at} min${s.bufferMinutes > 0 ? ` incl. ${s.bufferMinutes} buffer` : ''}`,
          // The owner's KPI, on the row it belongs to. A number in a summary
          // panel cannot tell you which person has been sitting there.
          s.waitingMinutes === null ? null
            : s.stillWaiting
              ? `waiting ${s.waitingMinutes} min`
              : `waited ${s.waitingMinutes} min`,
        ].filter(Boolean).join(' · ')}
      </div>

      {s.specialBecause !== null && (
        <div className="slot-special">{s.specialBecause}</div>
      )}

      {s.problems.map((p) => (
        <div key={p.control + p.what} className={PRIORITY_CLASS[p.priority] ?? 'slot-why'}>
          <span className="slot-control">{p.control}</span> {p.what}
        </div>
      ))}

      {s.problems.length === 0 && <div className="slot-why">{s.because}</div>}
    </div>
  );
}

/**
 * PAT-001.a — who covers which chair.
 *
 * *"Dental assistants must be aware of all appointments for the day in their
 * assigned operatory."* The clinic has four operatories and two assistants,
 * and until now no assignment existed anywhere in KuBi — so that sentence had
 * nothing to stand on.
 *
 * The room carries the assistant and a booking inherits it. Typing a name on
 * every booking would be two hundred places a month for the roster to be
 * wrong, and nobody edits two hundred rows when somebody calls in sick.
 */
function Chairs({ c }: { c: CoverScreenView }) {
  return (
    <>
      <Group
        title="Chair cover"
        note={c.headline}
        tone={c.clashes.length > 0 ? 'stop'
          : c.rooms.some((r) => r.state === 'UNCOVERED') ? 'stop' : 'good'}
      >
        <div className="chair-list">
          {c.rooms.map((r) => (
            <div key={r.operatoryId} className={COVER_CLASS[r.state]}>
              <span className="chair-room">{r.label}</span>
              <span className="chair-who">{r.coveredBy ?? '—'}</span>
              <span className="chair-state">{COVER_WORD[r.state]}</span>
              <span className="chair-load">
                {r.slots === 0 ? 'nothing booked'
                  : `${r.slots} booked · ${r.bookedMinutes} min`}
              </span>
              <span className="chair-why">{r.because}</span>
            </div>
          ))}
        </div>

        {c.unratified && (
          <p className="screen-sub">
            This split is KuBi’s, not the clinic’s. Two assistants and four
            rooms admits several sensible answers and they are not equivalent —
            putting both surgical rooms under one person is what creates a
            clash when two long cases run together.
          </p>
        )}
      </Group>

      {/* The finding nothing else in KuBi could produce. Arithmetic on two
          intervals, and the kind of thing a clinic discovers at 11:05 when the
          second patient is already in the chair. */}
      {c.clashes.length > 0 && (
        <Notice
          tone="stop"
          title={`${c.clashes.length} time${c.clashes.length === 1 ? '' : 's'} today one assistant is needed in two rooms at once`}
        >
          {c.clashes.map((x) => (
            <div key={x.because} className="slot-why is-bad">
              <b>{x.assistant}</b> — {x.because}
            </div>
          ))}
        </Notice>
      )}

      <Group title="What each assistant is carrying">
        <div className="chair-list">
          {c.load.map((l) => (
            <div key={l.label} className={l.present ? 'chair' : 'chair is-dim'}>
              <span className="chair-room">{l.label}</span>
              <span className="chair-who">{l.present ? 'In' : 'Not in'}</span>
              <span className="chair-state">{l.rooms} room{l.rooms === 1 ? '' : 's'}</span>
              <span className="chair-load">
                {l.slots} patient{l.slots === 1 ? '' : 's'} · {l.bookedMinutes} min
              </span>
              <span className="chair-why" />
            </div>
          ))}
        </div>
      </Group>
    </>
  );
}

/**
 * The check-in script, shown and never ticked.
 *
 * *"Did you smile?"* as a checkbox is the fastest way to make a system feel
 * like surveillance, and it measures nothing. So the script is put in front of
 * reception at the moment it is needed and nobody is asked to report having
 * said it. The one enforceable line in it — consent — is already a mandatory
 * gate on the treatment, where it belongs.
 */
function Script({ v }: { v: ReceptionScreenView }) {
  return (
    <Group title="Check-in" note={v.greeting}>
      <div className="script">
        <div className="script-head">
          <span className="script-col">A new patient</span>
          <span className="script-col">Somebody returning</span>
        </div>
        {v.script.map((l) => (
          <div key={l.newPatient + l.returningPatient} className="script-row">
            <span className="script-line">{l.newPatient}</span>
            <span className="script-line">{l.returningPatient}</span>
          </div>
        ))}
      </div>
      <p className="screen-sub">
        Shown, not ticked. The one line KuBi enforces is the consent, and it is
        enforced on the treatment rather than here — asking reception to
        confirm they said something measures nothing.
      </p>
    </Group>
  );
}

/** The ten fields, and why each one is collected. */
function Form({ v }: { v: ReceptionScreenView }) {
  return (
    <Group title="New patient registration" note={`Consultation Rs. ${v.consultationFee}.`}>
      <div className="form-list">
        {v.form.map((f) => (
          <div key={f.numeral} className={f.priority === 'PS' ? 'ff is-bad' : 'ff'}>
            <span className="ff-num">{f.numeral}</span>
            <span className="ff-label">
              {f.label}
              {!f.required && <span className="ff-opt">optional</span>}
            </span>
            <span className="ff-why">{f.why}</span>
          </div>
        ))}
      </div>
    </Group>
  );
}

export function Reception() {
  const { data: v, failed, reload } = useLoad<ReceptionScreenView>(
    () => api.reception(), []);
  const [tab, setTab] = useState<'BOOK' | 'CHAIRS' | 'DESK'>('BOOK');

  if (failed) return <Failed what="Could not read the appointment book." back={reload} />;
  if (!v) return <Loading />;

  const worst = v.blockers[0];
  const tone: Tone = worst ? 'stop'
    : v.unconfirmed > 0 || v.callNow > 0 ? 'warn' : 'good';

  return (
    <Screen wide>
      <Title question="Who is coming, and what will go wrong?">Reception</Title>

      <Answer
        verdict={v.reviewComplete ? 'BOOK REVIEWED' : 'BOOK NOT REVIEWED'}
        why={v.headline}
        tone={tone}
      />

      <Facts>
        <Fact
          value={v.firstAppointmentAt === null ? '—' : hhmm(v.firstAppointmentAt)}
          label="First patient"
        />
        {/* APT-001.a. Reception's own deadline, derived from the book rather
            than from a shift pattern — 30 minutes before the first patient. */}
        <Fact value={hhmm(v.reviewBy)} label="Review the book by" />
        <Fact value={v.unconfirmed} label="Still to confirm"
          tone={v.unconfirmed > 0 ? 'warn' : 'good'} />
        <Fact value={v.retryDue} label="Retry due"
          tone={v.retryDue > 0 ? 'warn' : 'good'} />
        <Fact value={v.noShows} label="Did not arrive"
          tone={v.noShows > 0 ? 'stop' : 'good'} />
        {/* The owner's KPI. Null is "nobody has been seated yet", never zero
            minutes — a clinic that has seated nobody has not achieved a
            perfect waiting time. */}
        <Fact
          value={v.waiting.averageMinutes === null ? '—' : `${v.waiting.averageMinutes} min`}
          label={`Average wait · ${v.waiting.seated} seated`}
          tone={v.waiting.overdue > 0 ? 'warn' : 'good'}
        />
      </Facts>

      {/* APT-012. Derived like clinic readiness — nobody ticks it, and it goes
          back to incomplete if a slot breaks at half past ten. */}
      {v.blockers.length > 0 && (
        <Notice tone="stop" title={`${v.blockers.length} critical issue${v.blockers.length === 1 ? '' : 's'} in today’s book`}>
          {v.blockers.map((b) => (
            <div key={b.control + b.what} className="slot-why is-bad">
              <span className="slot-control">{b.control}</span> {b.what}
            </div>
          ))}
        </Notice>
      )}

      <Switch
        value={tab}
        onChange={setTab}
        options={[
          { value: 'BOOK', label: `Today’s book · ${v.slots.length}` },
          { value: 'CHAIRS', label: 'Who is on which chair' },
          { value: 'DESK', label: 'The front desk' },
        ]}
      />

      {tab === 'BOOK' && (
        <>
          <Group title="Today" count={v.slots.length}>
            <div className="slot-list">
              {v.slots.map((s) => <Slot s={s} key={s.id} />)}
            </div>
          </Group>

          {/* APT-008. Computed, never reported — a gap is the absence of
              something and nobody reports an absence. */}
          {v.gaps.length > 0 && (
            <Group
              title="Free chair time"
              count={v.gaps.length}
              note="Somebody on the waiting list could have this."
              tone="warn"
            >
              <div className="slot-list">
                {v.gaps.map((g) => (
                  <div key={`${g.from}-${g.to}`} className="slot slot-off">
                    <div className="slot-head">
                      <span className="slot-time">{hhmm(g.from)}</span>
                      <span className="slot-who">
                        <b className="slot-name">{g.minutes} minutes free</b>
                      </span>
                      <span className="slot-state">to {hhmm(g.to)}</span>
                    </div>
                    <div className="slot-why">{g.because}</div>
                  </div>
                ))}
              </div>
            </Group>
          )}
        </>
      )}

      {tab === 'CHAIRS' && <Chairs c={v.cover} />}

      {tab === 'DESK' && (
        <>
          <Script v={v} />
          <Form v={v} />

          <Group title="How the waiting area should feel">
            {/* A plain list, not the registration grid. These are sentences to
                read, and squeezing them into a column sized for "Full name"
                made them wrap three deep and look like fields. */}
            <div className="standards">
              {v.hospitality.map((h) => (
                <p key={h} className="standard">{h}</p>
              ))}
            </div>
            <p className="screen-sub">
              Standards to read, not boxes to tick. “Was the atmosphere calming”
              as a daily tick produces a column of ticks and no calm — the two
              things here with a number behind them, the waiting time and the
              apology for a delay, are measured on the book instead.
            </p>
          </Group>
        </>
      )}

      {/* Named, not resolved. Constitution rule 4. */}
      {v.openQuestions.length > 0 && (
        <div className="clash">
          <div className="clash-title">
            {v.openQuestions.length} things these standards do not settle
          </div>
          {v.openQuestions.map((q) => (
            <div key={q} className="clash-row">{q}</div>
          ))}
          <div className="clash-note">
            Each changes what the engine reports, and each has more than one
            defensible answer.
          </div>
        </div>
      )}
    </Screen>
  );
}
