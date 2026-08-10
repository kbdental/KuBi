import { useCallback, useEffect, useState } from 'react';
import { api, type ClinicView, type DayBlock } from '../api.js';

/**
 * CLINIC READINESS — the morning and the evening, as the engine calculates
 * them.
 *
 * This screen computes nothing. Whether the clinic is ready, which block is
 * holding it, when the morning had to start, how long closing took — all of it
 * arrives from `/api/v1/clinic` already decided. That is the point of the
 * engine: a number on a screen and the rule that refuses an event cannot
 * disagree, because there is only one of them.
 *
 * Two panels rather than one list, because the morning and the evening are
 * different questions to different people at different hours, and merging them
 * would put "fumigate" next to "prepare Operatory 1" at nine in the morning.
 */

const hhmm = (m: number | null | undefined): string =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function ClinicReadiness() {
  const [view, setView] = useState<ClinicView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.clinic());
      setProblem(null);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not read the clinic.');
    }
  }, []);

  // The clock runs whether or not anybody is looking, so the screen catches up
  // on its own. Thirty seconds is often enough to see a block land and slow
  // enough not to fight somebody typing.
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function report(block: DayBlock) {
    setBusy(block.id);
    setProblem(null);
    try {
      const r = await api.recordEvent(
        block.completedBy,
        block.subjectId ?? 'today',
        `${block.completedBy}:${block.subjectId ?? 'today'}:${Date.now()}`,
      );
      // A refusal is a state of the clinic, not a failure of the click. It is
      // shown as the clinic's own sentence and nothing else.
      if (!r.ok) setProblem(r.refusal.because);
      await load();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  }

  if (!view) {
    return <div className="screen">{problem
      ? <div className="notice notice-stop" role="alert">{problem}</div>
      : <p className="screen-sub">Reading the clinic…</p>}</div>;
  }

  const r = view.readiness;
  const c = view.closing;

  return (
    <div className="screen screen-wide">
      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      {/* ── The morning ─────────────────────────────────────────────── */}
      <section className="ready-panel">
        <div className="ready-head">
          <div>
            <div className="ready-kicker">THE MORNING</div>
            <h2 className={`ready-verdict ${r.ready ? 'is-good' : r.overdue ? 'is-bad' : ''}`}>
              {r.unconfigured.length > 0
                ? 'Clinic not set up'
                : r.ready ? 'Clinic is ready' : `${r.outstanding.length} still to do`}
            </h2>
            <p className="ready-sub">
              {r.unconfigured.length > 0
                ? r.unconfigured[0]
                : r.ready
                  ? r.varianceMinutes === null
                    ? `Ready at ${hhmm(r.readyAt)}.`
                    : r.varianceMinutes <= 0
                      ? `Ready at ${hhmm(r.readyAt)} — ${Math.abs(r.varianceMinutes)} min before the first patient.`
                      : `Ready at ${hhmm(r.readyAt)} — ${r.varianceMinutes} min after the first patient was due.`
                  : r.targetAt === null
                    ? 'Nobody is booked today, so there is no time to be ready by.'
                    : r.overdue
                      ? `The first patient was due at ${hhmm(r.targetAt)}.`
                      : `First patient at ${hhmm(r.targetAt)}, in ${r.minutesToTarget} min.`}
            </p>
          </div>
          <Meter percent={Math.round(r.compliance * 100)} good={r.ready} />
        </div>

        {r.startBy !== null && !r.ready && (
          <p className="ready-note">
            Must start by <strong>{hhmm(r.startBy)}</strong> — driven by {r.startDrivenBy}.
          </p>
        )}

        {/* Mandatory only. The as-required work has its own section below, and
            listing it twice made the count and the list disagree. */}
        <BlockList
          blocks={r.blocks.filter((b) => b.mandatory !== false)}
          busy={busy}
          onReport={(b) => void report(b)}
        />

        {r.advisory.length > 0 && (
          <div className="ready-advisory">
            <div className="ready-advisory-head">As required — does not hold the clinic</div>
            <BlockList blocks={r.advisory} busy={busy} onReport={(b) => void report(b)} />
          </div>
        )}
      </section>

      {/* ── The evening ─────────────────────────────────────────────── */}
      <section className="ready-panel">
        <div className="ready-head">
          <div>
            <div className="ready-kicker">THE EVENING</div>
            <h2 className={`ready-verdict ${c.clear ? 'is-good' : c.runningLate ? 'is-bad' : ''}`}>
              {c.clear ? 'Day closed down' : `${c.outstanding.length} still to do`}
            </h2>
            <p className="ready-sub">
              {c.shutAt === null
                ? 'No shut time is set for this clinic.'
                : c.clear
                  ? c.varianceMinutes === null
                    ? `Finished at ${hhmm(c.closedAt)}.`
                    : `Out at ${hhmm(c.closedAt)} — closing took ${c.overrunMinutes} min.`
                  : c.runningLate
                    ? `The team should have left at ${hhmm(c.expectedCloseAt)}.`
                    : c.closingNow
                      ? `Shut at ${hhmm(c.shutAt)}. Out by ${hhmm(c.expectedCloseAt)}.`
                      : `Shuts at ${hhmm(c.shutAt)}. Out by ${hhmm(c.expectedCloseAt)}.`}
            </p>
          </div>
          <Meter percent={Math.round(c.compliance * 100)} good={c.clear} />
        </div>

        {c.criticalException.length > 0 && (
          <p className="ready-note is-bad">
            {c.criticalException.length} patient-safety item
            {c.criticalException.length === 1 ? '' : 's'} outstanding.
            The day cannot be closed until {c.criticalException.length === 1 ? 'it is' : 'they are'}.
          </p>
        )}

        <BlockList blocks={c.blocks} busy={busy} onReport={(b) => void report(b)} />
      </section>
    </div>
  );
}

/**
 * The blocks, done and not.
 *
 * Done ones stay on the list rather than disappearing: the question a person
 * asks at 09:20 is "what is left", and the question at 09:50 is "did anybody
 * do the floors" — a list that hides its own history can only answer the first.
 */
function BlockList({
  blocks, busy, onReport,
}: {
  blocks: DayBlock[];
  busy: string | null;
  onReport: (b: DayBlock) => void;
}) {
  return (
    <div className="block-list">
      {blocks.map((b) => (
        <div key={b.id} className={`block ${b.done ? 'is-done' : ''}`}>
          <span className={`block-mark ${b.done ? 'is-done' : ''}`} aria-hidden="true">
            {b.done ? '✓' : ''}
          </span>
          <div className="block-body">
            <div className="block-label">{b.label}</div>
            <div className="block-meta">
              {who(b.owner)}
              {b.expectMinutes ? ` · ${b.expectMinutes} min` : ''}
              {b.done && b.doneAt !== null ? ` · done ${hhmm(b.doneAt)}` : ''}
            </div>
          </div>
          {!b.done && (
            <button
              className="btn btn-quiet block-do"
              type="button"
              disabled={busy === b.id}
              onClick={() => onReport(b)}
            >
              {busy === b.id ? 'Saving…' : 'Done'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** The compliance figure, as a ring rather than a number nobody reads. */
function Meter({ percent, good }: { percent: number; good: boolean }) {
  return (
    <div className={`meter ${good ? 'is-good' : ''}`} role="img"
      aria-label={`${percent}% complete`}>
      <span className="meter-value">{percent}%</span>
    </div>
  );
}

const who = (role: string) =>
  role.replace(/_/g, ' ').toLowerCase().replace(/^./, (ch) => ch.toUpperCase());
