import { useCallback, useEffect, useState } from 'react';
import {
  api, type PatientEventsView, type CareView, type CareTaskView, type GateResultView,
} from '../api.js';
import { hhmm, who, Loading } from './day-blocks.js';

/**
 * PATIENT EVENTS — the work a booking made for itself, and what it may not
 * start without.
 *
 * The owner: *"The patient's clinical journey automatically generates work…
 * Nobody needs to manually create these tasks."*
 *
 * And then, correcting me after I put the mandatory list in a tab of its own:
 * *"why have you made a separate tab for mandatory — it should have been a
 * part of patient event, as what procedure is required, that treatment's
 * mandatory task become visible and clickable whether done it or not done
 * it."*
 *
 * He is right, and the reason is worth writing down. A mandatory item is not a
 * category of work — it is a property of *this booking*, and the person who can
 * satisfy it is the person looking at the booking. Putting it on its own screen
 * meant an assistant had to know that the consent she was about to take was
 * "compliance" and go somewhere else to say so. Now the gate is on the card,
 * marked done or not done, and one tap reports it.
 *
 * So each booking shows, in this order:
 *
 *   the verdict          READY / NOT READY / BREACHED
 *   MUST BE DONE FIRST   the mandatory gates, clickable
 *   also to do           the advisory work
 *   after delivery       once it has happened
 *
 * There is still no button anywhere that lets somebody past a gate. Tapping a
 * gate reports that the work was **done**, which is the only way through — the
 * engine takes no argument that could override one.
 */

export function PatientEvents() {
  const [view, setView] = useState<PatientEventsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  const report = useCallback(async (bookingId: string, itemId: string) => {
    setBusy(`${bookingId}#${itemId}`);
    try {
      await api.reportCareItem(bookingId, itemId);
      await load();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  }, [load]);

  if (view === null) return <Loading problem={problem} />;

  const held = view.care.filter(
    (c) => !(c.mandatory?.ready ?? c.mayStart) && !c.delivered);
  const breached = view.care.filter((c) => (c.mandatory?.breaches.length ?? 0) > 0);
  const generated = view.care.reduce((n, c) => n + c.before.length + c.after.length, 0);
  const stillOpen = view.care.reduce((n, c) => n + c.open.length, 0);

  return (
    <div className="screen screen-wide">
      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      <section className="ready-panel">
        <div className="ready-head">
          <div>
            <div className="ready-kicker">BOOKED TODAY</div>
            <h2 className={`ready-verdict ${held.length > 0 || breached.length > 0
              ? 'is-bad' : 'is-good'}`}>
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
            {held.length} cannot start — something mandatory is missing.
          </p>
        )}
        {breached.length > 0 && (
          <p className="ready-note is-bad">
            {breached.length} {breached.length === 1 ? 'was' : 'were'} delivered
            without something mandatory. That cannot be undone.
          </p>
        )}
      </section>

      {view.care.map((c) => (
        <Booking key={c.bookingId} care={c} busy={busy}
          expanded={open === c.bookingId}
          onToggle={() => setOpen(open === c.bookingId ? null : c.bookingId)}
          onReport={(itemId) => void report(c.bookingId, itemId)} />
      ))}

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

function Booking({ care, busy, expanded, onToggle, onReport }: {
  care: CareView; busy: string | null; expanded: boolean;
  onToggle: () => void; onReport: (itemId: string) => void;
}) {
  const c = care;
  const m = c.mandatory;
  const breaches = m?.breaches ?? [];
  /**
   * The verdict comes from the mandatory list, not from the care engine.
   *
   * They can disagree, and when they do the mandatory one is right: the care
   * engine knows whether somebody reported the stock check, and the mandatory
   * one knows whether the fixture is on the shelf. A card that said "may
   * start" while a stock gate underneath it read MISSING would be the exact
   * kind of quiet disappearance this whole engine exists to stop.
   */
  const ready = m === null ? c.mayStart : m.ready;
  const state = breaches.length > 0 ? 'BREACHED'
    : c.delivered ? 'DELIVERED' : ready ? 'READY' : 'NOT_READY';

  // The mandatory gates, in the order somebody works them: what holds the
  // chair, then what holds the day.
  const gatesBefore = m?.before ?? [];
  const gatesAfter = m?.after ?? [];
  const gateIds = new Set((m?.gates ?? []).map((x) => x.id));
  const advisory = [...c.before, ...(c.delivered ? c.after : [])]
    .filter((t) => !gateIds.has(t.id));

  return (
    <section className={`ready-panel care ${VERDICT_EDGE[state]}`}>
      <div className="care-head">
        <div>
          <div className="ready-kicker">
            {hhmm(c.at)} · {c.patientLabel}
            {c.sittings > 1 ? ` · sitting ${c.sitting} of ${c.sittings}` : ''}
          </div>
          <h3 className="care-title">{c.treatmentName}</h3>
        </div>
        <span className={`care-state ${VERDICT_PILL[state]}`}>{VERDICT_WORD[state]}</span>
      </div>

      {/* The one sentence for whoever is standing next to the chair. */}
      {state === 'NOT_READY' && m !== null && (
        <p className="ready-note is-bad">{m.headline}</p>
      )}

      {/* A breach is permanent, so it is said before anything else about
          the case rather than found at the bottom of a list. */}
      {breaches.map((b) => (
        <div key={b.gateId} className="breach">
          <div className="breach-title">Delivered without: {b.label}</div>
          <div className="breach-line">
            Not held at {hhmm(b.deliveredAt % 1440)}.
            {b.metLateAt !== null
              ? ` Recorded afterwards at ${hhmm(b.metLateAt % 1440)} — which does not undo it.`
              : ' Still not held.'}
          </div>
          <div className="breach-line is-quiet">Would have needed: {b.evidence}</div>
        </div>
      ))}

      {(m?.refusals.length ?? 0) > 0 && (
        <p className="asset-line is-bad">
          {m!.refusals.length} recorded attempt{m!.refusals.length === 1 ? '' : 's'} to
          start this anyway — {m!.refusals.map((r) => hhmm(r.at % 1440)).join(', ')}.
        </p>
      )}

      {/* ── The mandatory list, on the booking, clickable ─────────────── */}
      {gatesBefore.length > 0 && (
        <GateGroup
          title={`MUST BE DONE FIRST — ${gatesBefore.filter(open_).length} of ${gatesBefore.length} outstanding`}
          gates={gatesBefore} busy={busy} bookingId={c.bookingId} onReport={onReport} />
      )}

      {c.delivered && gatesAfter.length > 0 && (
        <GateGroup
          title={`MUST BE DONE BEFORE THE DAY CLOSES — ${gatesAfter.filter(open_).length} of ${gatesAfter.length} outstanding`}
          gates={gatesAfter} busy={busy} bookingId={c.bookingId} onReport={onReport} />
      )}

      <button className="btn btn-quiet care-more" type="button" onClick={onToggle}>
        {expanded ? 'Hide the rest' : `Also to do — ${advisory.length}`}
      </button>

      {expanded && (
        <div className="care-detail">
          <TaskGroup title="Not mandatory, and still somebody’s job" tasks={advisory} />
          {!c.delivered && gatesAfter.length > 0 && (
            <div className="care-group is-dim">
              <div className="care-group-title">
                Mandatory after delivery — not live yet
              </div>
              <div className="block-list">
                {gatesAfter.map((x) => (
                  <div key={x.id} className="block">
                    <span className="care-pip is-open" aria-hidden="true" />
                    <div className="block-body">
                      <div className="block-label">{x.label}</div>
                      <div className="block-meta">{who(x.owner)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const open_ = (x: GateResultView) =>
  x.verdict === 'MISSING' || x.verdict === 'UNKNOWN';

/**
 * A mandatory gate, drawn so that done and not-done are unmistakable, and
 * tappable by whoever can satisfy it.
 *
 * The button says **Done** and nothing else. It reports that the work
 * happened; it does not waive the gate, and there is no control here that
 * could — the engine takes no argument that would let one through.
 */
function GateGroup({ title, gates, busy, bookingId, onReport }: {
  title: string; gates: GateResultView[]; busy: string | null;
  bookingId: string; onReport: (itemId: string) => void;
}) {
  return (
    <div className="care-group">
      <div className="care-group-title">{title}</div>
      <div className="block-list">
        {gates.map((x) => {
          const id = `${bookingId}#${x.id}`;
          const outstanding = open_(x);
          return (
            <div key={x.id} className={`block ${x.verdict === 'MET' ? 'is-done' : ''}`}>
              <span className={`care-pip ${gatePip(x.verdict)}`} aria-hidden="true" />
              <div className="block-body">
                <div className="block-label">
                  {x.label}
                  <span className={`gate-basis ${basisClass(x.basis)}`}>{x.basis}</span>
                </div>
                <div className="block-meta">
                  {who(x.owner)}
                  {x.attestedBy !== null ? ` · only ${who(x.attestedBy)} may attest it` : ''}
                  {x.verdict === 'MET' ? ' · done' : ''}
                  {x.verdict === 'NOT_APPLICABLE' ? ' · does not apply' : ''}
                </div>
                <div className="care-why is-quiet">Proved by: {x.evidence}</div>
                {x.verdict === 'UNKNOWN' && <div className="care-why">{x.because}</div>}
              </div>
              {/* Offered only where there is something to report. A button on a
                  done item invites a second click that means nothing. */}
              {outstanding && (
                <button className="btn btn-quiet block-do" type="button"
                  disabled={busy === id}
                  onClick={() => onReport(x.id)}>
                  {busy === id ? 'Saving…' : 'Done'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskGroup({ title, tasks }: { title: string; tasks: CareTaskView[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="care-group">
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
              </div>
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
 * call a day after it, so formatting one with the clock alone produced
 * "due -7:00", which is not a time.
 */
function dueWord(m: number): string {
  const day = Math.floor(m / 1440);
  const clock = hhmm(((m % 1440) + 1440) % 1440);
  if (day === 0) return clock;
  if (day === -1) return `${clock} the day before`;
  if (day === 1) return `${clock} the next day`;
  return day < 0 ? `${clock}, ${-day} days before` : `${clock}, ${day} days on`;
}

function pipClass(t: CareTaskView): string {
  if (t.state === 'MET') return 'is-met';
  if (t.state === 'NOT_APPLICABLE') return 'is-aside';
  if (t.state === 'UNKNOWN') return 'is-unknown';
  return t.late ? 'is-late' : 'is-open';
}

const gatePip = (v: string) =>
  v === 'MET' ? 'is-met'
    : v === 'NOT_APPLICABLE' ? 'is-aside'
      : v === 'UNKNOWN' ? 'is-unknown' : 'is-late';

const VERDICT_EDGE: Record<string, string> = {
  READY: 'is-ready',
  NOT_READY: 'is-held',
  BREACHED: 'is-breached',
  DELIVERED: 'is-delivered',
};

const VERDICT_PILL: Record<string, string> = {
  READY: 'is-ready',
  NOT_READY: 'is-held',
  BREACHED: 'is-breached',
  DELIVERED: 'is-done',
};

const VERDICT_WORD: Record<string, string> = {
  READY: 'May start',
  NOT_READY: 'NOT READY',
  BREACHED: 'Breached',
  DELIVERED: 'Delivered',
};

/**
 * The basis is shown on every gate, because it decides who may argue.
 *
 * A clinical gate is the clinical director's to change. A statutory one is
 * nobody's — an exposure with no written justification is not a matter of
 * house style, and a badge that says so stops the whole list being read as one.
 */
const basisClass = (b: string) => ({
  STATUTORY: 'gate-statutory',
  CONSENT: 'gate-consent',
  SAFETY: 'gate-safety',
  CLINICAL: 'gate-clinical',
  RECORD: 'gate-record',
}[b] ?? 'gate-clinical');
