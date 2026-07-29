import { useEffect, useState } from 'react';
import type { ClinicContext } from '../api.js';

/**
 * Where the clinic is, before anything about what you personally have to do.
 *
 * This is the answer to "where is the clinic?" — a morning has a shape, and a
 * person walking in already knows it: which clinic, what time, what phase,
 * whether we're ready, how long is left. A task list answers none of that.
 *
 * Four lines, in the order someone actually asks them:
 *   where am I   → the clinic's name
 *   when is it   → a live clock, because a deadline without a now is useless
 *   what phase   → Opening / Open
 *   are we ready → 3 of 5 areas ready
 *   how long     → 13 minutes left
 *
 * Nothing here is inferred. If the clinic has no opening set today, this says
 * so rather than implying readiness; if the first-patient time is unknown —
 * which it always is until appointments are integrated — the line is absent
 * rather than guessed.
 */

/**
 * Every time on this screen is the CLINIC's time, not the viewer's. A manager
 * checking from home, or a browser left on the wrong zone, must still read
 * "ready by 09:00" as nine o'clock at the clinic.
 */
function clockFace(at: Date, timezone: string): string {
  return at.toLocaleTimeString([], { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
}

function hourAt(at: Date, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false })
      .format(at),
  );
}

function greeting(at: Date, timezone: string): string {
  const h = hourAt(at, timezone);
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "13 minutes left", "Due now", "20 minutes late" — never a bare timestamp. */
function countdown(target: Date, now: Date): { text: string; late: boolean } {
  const mins = Math.round((target.getTime() - now.getTime()) / 60_000);
  if (mins > 90) {
    const h = Math.floor(mins / 60);
    return { text: `${h} hour${h === 1 ? '' : 's'} left`, late: false };
  }
  if (mins > 1) return { text: `${mins} minutes left`, late: false };
  if (mins >= 0) return { text: 'Due now', late: false };
  const over = -mins;
  if (over > 90) {
    const h = Math.floor(over / 60);
    return { text: `${h} hour${h === 1 ? '' : 's'} late`, late: true };
  }
  return { text: `${over} minute${over === 1 ? '' : 's'} late`, late: true };
}

export function ClinicHeader({ clinic }: { clinic: ClinicContext }) {
  // The clock has to move. A frozen time on a screen about time remaining is
  // worse than no clock at all.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const ready = clinic.readyBy ? countdown(new Date(clinic.readyBy), now) : null;
  // Open OR already seeing patients — either way the morning's job is done and
  // the screen should stop counting down to it.
  const open = clinic.phase === 'OPEN' || clinic.phase === 'SEEING_PATIENTS';
  const phaseName = clinic.phase === 'SEEING_PATIENTS' ? 'Seeing patients'
    : clinic.phase === 'OPEN' ? 'Clinic open'
    : 'Clinic opening';

  return (
    <header className={`clinic${open ? ' is-open' : ''}`}>
      <div className="clinic-top">
        <div>
          <div className="clinic-name">{clinic.name}</div>
          <div className="clinic-greeting">{greeting(now, clinic.timezone)}</div>
        </div>
        <div className="clinic-clock">{clockFace(now, clinic.timezone)}</div>
      </div>

      {clinic.phase === null ? (
        <div className="clinic-phase">
          <div className="clinic-phase-name">No opening scheduled today</div>
        </div>
      ) : (
        <div className="clinic-phase">
          <div className="clinic-phase-name">{phaseName}</div>
          {clinic.opening && (
            <div className="clinic-progress">
              <div className="clinic-track" aria-hidden="true">
                <div
                  className="clinic-fill"
                  style={{ width: `${(clinic.opening.done / clinic.opening.total) * 100}%` }}
                />
              </div>
              <span className="clinic-count">
                {clinic.opening.done} of {clinic.opening.total} areas ready
              </span>
            </div>
          )}
        </div>
      )}

      <div className="clinic-facts">
      {/* The deadline is the clinic's own configured opening time. Once the
          clinic is open there is nothing left to count down to. */}
      {ready && !open && (
        <div className="clinic-when">
          <span className="clinic-when-label">Ready by</span>
          <span className="clinic-when-time">
            {clockFace(new Date(clinic.readyBy!), clinic.timezone)}
          </span>
          <span className={ready.late ? 'clinic-when-left is-late' : 'clinic-when-left'}>
            {ready.text}
          </span>
        </div>
      )}

      {/* Real since VS-02, and absent rather than guessed when there is nobody
          left today. A patient already past their time is the most serious
          number on this screen, so it is not allowed to read as neutral. */}
      {clinic.firstPatientAt && (() => {
        const next = countdown(new Date(clinic.firstPatientAt), now);
        return (
          <div className="clinic-when">
            {/* Once the day is underway "first" is wrong — it is whoever is
                next. Same number, honest label. */}
            <span className="clinic-when-label">
              {clinic.phase === 'OPENING' ? 'First patient' : 'Next patient'}
            </span>
            <span className="clinic-when-time">
              {clockFace(new Date(clinic.firstPatientAt), clinic.timezone)}
            </span>
            <span className={next.late ? 'clinic-when-left is-late' : 'clinic-when-left'}>
              {next.text}
            </span>
          </div>
        );
      })()}
      </div>
    </header>
  );
}
