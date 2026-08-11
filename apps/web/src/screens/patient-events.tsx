import { useCallback, useEffect, useState } from 'react';
import { api, type PatientEventsView, type CareView, type CareTaskView } from '../api.js';
import { hhmm, who, Loading } from './day-blocks.js';

/**
 * PATIENT EVENTS — the work a booking made for itself.
 *
 * The owner: *"The patient's clinical journey automatically generates work…
 * Nobody needs to manually create these tasks."*
 *
 * So this screen shows six bookings and about ninety pieces of work, and
 * nobody typed any of the ninety. Every row was derived from the booking by
 * the engine, which means the screen has nothing to add up and nothing to
 * decide: `mayStart`, `blockedBy` and the state of each item all arrive from
 * `/api/v1/patient-events` already settled, exactly as readiness and closing
 * do. A number here and the rule that refuses an event cannot disagree.
 *
 * The one thing the screen does insist on is the difference between an item
 * that is **outstanding** and one that is **unknown**. They look identical on
 * a checklist and they are not the same thing at all — the first is work
 * somebody has not done, the second is a question nobody has asked, and only
 * the second is fixed by talking to the patient.
 */

export function PatientEvents() {
  const [view, setView] = useState<PatientEventsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.patientEvents());
      setProblem(null);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not read the day’s bookings.');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (view === null) return <Loading problem={problem} />;

  const held = view.care.filter((c) => !c.mayStart && !c.delivered);
  const unknown = view.care.filter((c) => c.unknownFacts.length > 0);
  // Everything the bookings generated, not only what is still open — the
  // point being made is how much work exists that nobody typed in.
  const generated = view.care.reduce((n, c) => n + c.before.length + c.after.length, 0);
  const stillOpen = view.care.reduce((n, c) => n + c.open.length, 0);

  return (
    <div className="screen screen-wide">
      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      {/* ── Where the day is, before what anybody owes ─────────────────── */}
      <section className="ready-panel">
        <div className="ready-head">
          <div>
            <div className="ready-kicker">BOOKED TODAY</div>
            <h2 className={`ready-verdict ${held.length > 0 ? 'is-bad' : 'is-good'}`}>
              {view.care.length} treatment{view.care.length === 1 ? '' : 's'} generated{' '}
              {generated} pieces of work
            </h2>
            <p className="ready-sub">
              Nobody typed any of them, and {stillOpen} {stillOpen === 1 ? 'is' : 'are'} still
              open. Booking the treatment is what made the rest exist.
            </p>
          </div>
        </div>
        {held.length > 0 && (
          <p className="ready-note is-bad">
            {held.length} cannot start yet.
            {unknown.length > 0
              && ` ${unknown.length} of those is waiting on a question nobody has asked.`}
          </p>
        )}
      </section>

      {/* ── What the signed-in role owes, across every patient ──────────── */}
      {view.mine.length > 0 && (
        <section className="ready-panel">
          <div className="ready-kicker">{who(view.role).toUpperCase()} — ACROSS EVERY PATIENT</div>
          <div className="block-list">
            {view.mine.slice(0, 8).map((t) => (
              <div key={`${t.bookingId}#${t.id}`} className="block">
                <span className={`care-pip ${pipClass(t)}`} aria-hidden="true" />
                <div className="block-body">
                  <div className="block-label">{t.label}</div>
                  <div className="block-meta">
                    {t.patientLabel} · due {dueWord(t.dueAt)}
                    {t.late ? ' · late' : ''}
                    {holds(t)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── The bookings ───────────────────────────────────────────────── */}
      {view.care.map((c) => (
        <Booking key={c.bookingId} care={c}
          expanded={open === c.bookingId}
          onToggle={() => setOpen(open === c.bookingId ? null : c.bookingId)} />
      ))}

      {/* ── What this catalogue is, and what it is not ──────────────────── */}
      <section className="ready-panel">
        <div className="ready-kicker">THE CATALOGUE</div>
        <p className="ready-sub">
          {view.catalogue.treatments} treatments across {view.catalogue.categories}{' '}
          categories, carrying {view.catalogue.items} pieces of work between them.
          Booking any of them creates its own.
        </p>
        {view.unratified && (
          <p className="ready-note is-warn">
            None of it has been signed off. The timings, the gates and the
            conditions were drawn from ordinary practice so the engine had
            something real to run on — every one is the clinical director’s to
            confirm or overrule.
          </p>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * One booking
 * ---------------------------------------------------------------------- */

function Booking({ care, expanded, onToggle }: {
  care: CareView; expanded: boolean; onToggle: () => void;
}) {
  const c = care;
  const live = c.delivered ? c.after : c.before;

  return (
    <section className={`ready-panel care ${c.mayStart ? '' : 'is-held'}`}>
      <div className="care-head">
        <div>
          <div className="ready-kicker">
            {hhmm(c.at)} · {c.patientLabel}
            {c.sittings > 1 ? ` · sitting ${c.sitting} of ${c.sittings}` : ''}
          </div>
          <h3 className="care-title">{c.treatmentName}</h3>
        </div>
        <span className={`care-state ${c.delivered ? 'is-done' : c.mayStart ? 'is-ready' : 'is-held'}`}>
          {c.delivered ? 'Delivered' : c.mayStart ? 'May start' : 'Held'}
        </span>
      </div>

      {/* The one sentence for whoever is standing next to the chair. */}
      {c.blockedBy !== null && <p className="ready-note is-bad">{c.blockedBy}</p>}

      {c.delivered && c.owedAfter.length > 0 && (
        <p className="ready-note is-warn">
          {c.owedAfter.length} thing{c.owedAfter.length === 1 ? '' : 's'} owed
          before the day can close on this treatment.
        </p>
      )}

      <div className="care-counts">
        <Count n={live.filter((t) => t.state === 'MET').length} what="done" />
        <Count n={live.filter((t) => t.state === 'OUTSTANDING').length} what="to do" />
        <Count n={live.filter((t) => t.state === 'UNKNOWN').length} what="unknown" bad />
        <Count n={live.filter((t) => t.state === 'NOT_APPLICABLE').length} what="not applicable" />
      </div>

      <button className="btn btn-quiet care-more" type="button" onClick={onToggle}>
        {expanded ? 'Hide the work' : `Show all ${c.before.length + c.after.length}`}
      </button>

      {expanded && (
        <div className="care-detail">
          <TaskGroup title="Before the appointment" tasks={c.before} />
          <TaskGroup title={c.delivered ? 'After delivery' : 'After delivery — not live yet'}
            tasks={c.after} dim={!c.delivered} />
        </div>
      )}
    </section>
  );
}

function Count({ n, what, bad }: { n: number; what: string; bad?: boolean }) {
  if (n === 0) return null;
  return (
    <span className={`care-count ${bad ? 'is-bad' : ''}`}>
      <strong>{n}</strong> {what}
    </span>
  );
}

function TaskGroup({ title, tasks, dim }: {
  title: string; tasks: CareTaskView[]; dim?: boolean;
}) {
  if (tasks.length === 0) return null;
  return (
    <div className={`care-group ${dim ? 'is-dim' : ''}`}>
      <div className="care-group-title">{title}</div>
      <div className="block-list">
        {tasks.map((t) => (
          <div key={t.id} className={`block ${t.state === 'MET' ? 'is-done' : ''}`}>
            <span className={`care-pip ${pipClass(t)}`} aria-hidden="true" />
            <div className="block-body">
              <div className="block-label">{t.label}</div>
              <div className="block-meta">
                {who(t.owner)} · due {dueWord(t.dueAt)}
                {t.late ? ' · late' : ''}
                {holds(t)}
              </div>
              {/* An unknown says what is unknown, not what is undone. */}
              {t.state === 'UNKNOWN' && (
                <div className="care-why">Nobody has asked. {t.because}</div>
              )}
              {t.standsAsideBecause !== null && (
                <div className="care-why is-quiet">{t.standsAsideBecause}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A due minute that may fall on another day, said the way a person would.
 *
 * The implant scan is due a fortnight before the appointment and the next-day
 * call a day after it, so a due time is not always today — and formatting one
 * with the clock alone produced "due -7:00", which is not a time.
 */
function dueWord(m: number): string {
  const day = Math.floor(m / 1440);
  const clock = hhmm(((m % 1440) + 1440) % 1440);
  if (day === 0) return clock;
  if (day === -1) return `${clock} the day before`;
  if (day === 1) return `${clock} the next day`;
  return day < 0 ? `${clock}, ${-day} days before` : `${clock}, ${day} days on`;
}

/**
 * What an outstanding gate actually holds.
 *
 * Before the appointment it holds the patient out of the chair. After it, the
 * patient has gone home and it holds the *day* — the clinic cannot be closed
 * on an unwritten note. Saying "holds the chair" about a post-operative
 * instruction is the kind of small wrongness that teaches people the words
 * mean nothing.
 */
const holds = (t: CareTaskView) =>
  t.gate === 'BLOCK' ? (t.stage === 'BEFORE' ? ' · holds the chair' : ' · holds the day') : '';

/**
 * The pip, which is the whole reason this screen is not a checklist.
 *
 * Four states, four marks. Grey for met, amber for outstanding, red for
 * unknown, hollow for not applicable — because an unanswered question is more
 * serious than an undone task, not less, and a tick box has no way to say so.
 */
function pipClass(t: CareTaskView): string {
  if (t.state === 'MET') return 'is-met';
  if (t.state === 'NOT_APPLICABLE') return 'is-aside';
  if (t.state === 'UNKNOWN') return 'is-unknown';
  return t.late ? 'is-late' : 'is-open';
}
