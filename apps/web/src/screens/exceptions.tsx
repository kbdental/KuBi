/**
 * The exception queue — the owner's sixth engine, and the one they called the
 * most important.
 *
 * It asks one question continuously: **what should have happened but didn't?**
 * And it shows the escalation ladder running, rather than describing it:
 *
 *   Autoclaving due 19:00 · not done at 19:15 → assistant ·
 *   19:30 → senior assistant · 20:00 → clinic head
 *
 * The level is computed from minutes past due, so it keeps climbing whether or
 * not anybody is still in the building. That is the point the owner made:
 * *"this creates accountability without management chasing people."*
 *
 * Ordering is by escalation level and then by lateness. A queue in creation
 * order buries the thing that has been failing longest, which is precisely the
 * thing that needed attention first.
 */
import { useEffect, useState } from 'react';
import { api, type ExceptionRow } from '../api.js';

const SEVERITY: Record<string, string> = {
  PATIENT_SAFETY: 'ex-safety', CRITICAL: 'ex-critical',
  IMPORTANT: 'ex-important', ROUTINE: 'ex-routine',
};
const SEVERITY_WORD: Record<string, string> = {
  PATIENT_SAFETY: 'Patient safety', CRITICAL: 'Critical',
  IMPORTANT: 'Important', ROUTINE: 'Routine',
};

const role = (r: string) => r.replace(/_/g, ' ').toLowerCase();

export function Exceptions({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<ExceptionRow[] | null>(null);
  useEffect(() => { void api.exceptions().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <p className="screen-sub">Loading…</p>;

  const body = (
    <>
      <p className="screen-sub">
        Work that was due and is not done, with who has been told.
      </p>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-big">Nothing is overdue</div>
          <p className="row-note">Every control is running to standard right now.</p>
        </div>
      ) : (
        <ul className="ex-list">
          {rows.map((r) => (
            <li key={r.id} className={`ex-row ${SEVERITY[r.severity] ?? 'ex-routine'}`}>
              <div className="ex-main">
                <div className="ex-head">
                  {/* Not yet escalated is a real state. Showing L1 immediately
                      would make every late thing look identical. */}
                  {r.level === null ? (
                    <span className="ex-level ex-level-none">not yet escalated</span>
                  ) : (
                    <span className="ex-level">L{r.level}</span>
                  )}
                  <span className="ex-sev">{SEVERITY_WORD[r.severity] ?? r.severity}</span>
                  {r.activityCode && <span className="ex-code">{r.activityCode}</span>}
                </div>

                <div className="ex-title">{r.headline}</div>
                {r.detail && <div className="row-note">{r.detail}</div>}

                <div className="ex-ladder">
                  <b>{r.minutesLate} min late</b>
                  {r.escalatedTo && <> · with {role(r.escalatedTo)}</>}
                  {r.nextRung && (
                    <> · then {role(r.nextRung.to)} at {r.nextRung.afterMinutes} min</>
                  )}
                </div>

                {/* Accountable for the result, whoever happened to be doing it. */}
                {r.owner && (
                  <div className="ex-owner">Owned by {role(r.owner)}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  // Rendered inside Attention, which already asks "what needs a person".
  // A separate destination would split one question across two places.
  if (embedded) return body;
  return (
    <div className="screen screen-wide">
      <h1 className="screen-title">What is not happening</h1>
      {body}
    </div>
  );
}
