import { useCallback, useEffect, useState } from 'react';
import { api, type ClinicView, type DayBlock } from '../api.js';

/**
 * What the morning and the evening have in common, and nothing else.
 *
 * The two screens are deliberately separate places in the rail — the owner:
 * *"clinic closing should be in a different tab… it should not be mixed with
 * opening procedures which are making the clinic ready for the patient"*. They
 * are different jobs, at different hours, for people who are rarely thinking
 * about both at once.
 *
 * What they do share is the shape of a block and the way it is reported, so
 * that lives here once. Neither screen computes anything: whether the clinic
 * is ready, which block is holding it, how long closing took — all of it
 * arrives from `/api/v1/clinic` already decided, so a number on a screen and
 * the rule that refuses an event cannot disagree.
 */

export const hhmm = (m: number | null | undefined): string =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const who = (role: string) =>
  role.replace(/_/g, ' ').toLowerCase().replace(/^./, (ch) => ch.toUpperCase());

/**
 * The clinic, and a way to report a block done.
 *
 * Polls, because the clock runs whether or not anybody is looking. Thirty
 * seconds is soon enough to watch a colleague's block land and slow enough not
 * to fight somebody mid-tap.
 */
export function useClinic() {
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

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const report = useCallback(async (block: DayBlock) => {
    setBusy(block.id);
    setProblem(null);
    try {
      const r = await api.recordEvent(
        block.completedBy,
        block.subjectId ?? 'today',
        `${block.completedBy}:${block.subjectId ?? 'today'}:${Date.now()}`,
      );
      // A refusal is a state of the clinic, not a failure of the click, and it
      // is shown as the clinic's own sentence. Set AFTER the reload, not
      // before: `load()` clears the message on success, so setting it first
      // produced a button that visibly did nothing.
      await load();
      if (!r.ok) setProblem(r.refusal.because);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  }, [load]);

  return { view, problem, busy, report };
}

/**
 * Whether a block is this person's to report.
 *
 * A courtesy, not the enforcement — the server refuses anybody else regardless.
 * Senior counts as an assistant for the rooms, exactly as the rule does.
 */
export const ownedBy = (role: string) => (owner: string) =>
  owner === role || (owner === 'DENTAL_ASSISTANT' && role === 'SENIOR_ASSISTANT');

/**
 * The blocks, done and not.
 *
 * Done ones stay on the list rather than disappearing: the question at 09:20
 * is "what is left", and at 09:50 it is "did anybody do the floors" — a list
 * that hides its own history can only answer the first.
 */
export function BlockList({
  blocks, busy, mine, onReport, hideOwner = false,
}: {
  blocks: DayBlock[];
  busy: string | null;
  mine: (owner: string) => boolean;
  onReport: (b: DayBlock) => void;
  /**
   * Drop the owner from each row.
   *
   * For a list already sitting under a heading that names the role. Repeating
   * "Dental assistant" on five consecutive rows inside a lane called *Dental
   * assistants* is the kind of noise that makes the useful part of the line —
   * the fifteen minutes, the time it was done — harder to find.
   */
  hideOwner?: boolean;
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
              {[
                hideOwner ? null : who(b.owner),
                b.expectMinutes ? `${b.expectMinutes} min` : null,
                b.done && b.doneAt !== null ? `done ${hhmm(b.doneAt)}` : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
          {/* Somebody else's job is shown, never offered. Watching a button
              refuse you is worse than not having one. */}
          {!b.done && mine(b.owner) && (
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
export function Meter({ percent, good }: { percent: number; good: boolean }) {
  return (
    <div className={`meter ${good ? 'is-good' : ''}`} role="img"
      aria-label={`${percent}% complete`}>
      <span className="meter-value">{percent}%</span>
    </div>
  );
}

/** Waiting, or unable to read the clinic at all. */
export function Loading({ problem }: { problem: string | null }) {
  return (
    <div className="screen">{problem
      ? <div className="notice notice-stop" role="alert">{problem}</div>
      : <p className="screen-sub">Reading the clinic…</p>}</div>
  );
}
