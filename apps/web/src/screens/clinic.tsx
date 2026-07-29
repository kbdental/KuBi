import { useState } from 'react';
import { api, type Schedule, type ScheduleRow } from '../api.js';

/**
 * CLINIC — the day, as a list of people rather than a list of jobs.
 *
 * This is the screen reception actually works from. It answers "who is here,
 * who is next, and is anyone waiting too long", which is the whole front-desk
 * job, and it moves each visit along with one press.
 *
 * Deliberately not a calendar grid. A grid is good for booking and bad for
 * running a morning: at 09:40 nobody needs to see 4pm, they need to know who
 * is standing in reception right now.
 */

/** One press moves a visit to the state it is realistically going to next. */
const NEXT_STEP: Partial<Record<ScheduleRow['status'], { to: 'ARRIVED' | 'IN_CHAIR' | 'COMPLETED'; label: string }>> = {
  BOOKED: { to: 'ARRIVED', label: 'They’re here' },
  ARRIVED: { to: 'IN_CHAIR', label: 'Taken through' },
  IN_CHAIR: { to: 'COMPLETED', label: 'Finished' },
};

function hhmm(iso: string, timezone: string | undefined): string {
  return new Date(iso).toLocaleTimeString([], {
    ...(timezone ? { timeZone: timezone } : {}),
    hour: '2-digit', minute: '2-digit',
  });
}

export function Clinic({
  schedule, canAct, onChanged,
}: {
  schedule: Schedule;
  canAct: boolean;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const rows = schedule.rows;
  const waiting = rows.filter((r) => r.status === 'ARRIVED').length;
  const inChair = rows.filter((r) => r.status === 'IN_CHAIR').length;
  const left = rows.filter((r) => ['BOOKED', 'ARRIVED', 'IN_CHAIR'].includes(r.status)).length;

  async function advance(row: ScheduleRow) {
    const step = NEXT_STEP[row.status];
    if (!step) return;
    setBusyId(row.id);
    setProblem(null);
    try {
      await api.setAppointmentStatus(row.id, step.to);
      onChanged();
    } catch (err) {
      // The server owns these transitions; carry its refusal as written.
      setProblem(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="screen">
      <h1 className="screen-title">Clinic</h1>
      <p className="screen-sub">
        {rows.length === 0
          ? 'Nothing booked today.'
          : `${left} still to see · ${waiting} waiting · ${inChair} in the chair`}
      </p>

      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      {rows.length === 0 && (
        <div className="empty">
          <div className="empty-big">No visits today</div>
          <div>The day&rsquo;s list will appear here.</div>
        </div>
      )}

      {rows.map((row) => {
        const step = NEXT_STEP[row.status];
        const done = row.status === 'COMPLETED' || row.status === 'CANCELLED' || row.status === 'NO_SHOW';
        // Someone standing in reception for 15 minutes is the thing reception
        // most needs to notice, so it is called out rather than left to be
        // worked out from an arrival time.
        const tooLong = row.waitingMinutes !== null && row.waitingMinutes >= 15;

        // The one being seen right now gets a stripe, so a glance finds it.
        const classes = ['visit'];
        if (done) classes.push('is-done');
        if (row.status === 'IN_CHAIR' || row.status === 'ARRIVED') classes.push('is-now');

        return (
          <div key={row.id} className={classes.join(' ')}>
            <div className="visit-head">
              <span className="visit-when">{hhmm(row.scheduledStart, schedule.timezone)}</span>
              <span className="visit-who">{row.patientLabel}</span>
            </div>
            <div className="visit-what">
              {row.visitType}{row.chairLabel ? ` · ${row.chairLabel}` : ''}
            </div>
            <div className="visit-state">
              <span className={`pill ${
                row.status === 'IN_CHAIR' ? 'pill-important'
                  : tooLong ? 'pill-critical'
                  : 'pill-routine'
              }`}>
                {row.statusLabel}
              </span>
              {row.waitingMinutes !== null && (
                <span className={tooLong ? 'visit-waiting is-long' : 'visit-waiting'}>
                  waiting {row.waitingMinutes} min
                </span>
              )}
            </div>
            {canAct && step && (
              <button
                className="btn btn-quiet visit-do"
                type="button"
                disabled={busyId === row.id}
                onClick={() => void advance(row)}
              >
                {busyId === row.id ? 'Saving…' : step.label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
