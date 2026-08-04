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
import { Screen, Title, Row, Tag, Empty, toneOf } from '../ui.js';

const SEVERITY_WORD: Record<string, string> = {
  PATIENT_SAFETY: 'Patient safety', CRITICAL: 'Critical',
  IMPORTANT: 'Important', ROUTINE: 'Routine',
};

const role = (r: string) => r.replace(/_/g, ' ').toLowerCase();

export function Exceptions({ embedded = false }: { embedded?: boolean } = {}) {
  const [rows, setRows] = useState<ExceptionRow[] | null>(null);
  useEffect(() => { void api.exceptions().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <p className="screen-sub">Loading…</p>;

  const body = rows.length === 0
    ? (
      <Empty big="Nothing is overdue">
        Every control is running to standard right now.
      </Empty>
    )
    : (
      <>
        <p className="screen-sub">
          Work that was due and is not done, with who has been told.
        </p>
        {rows.map((r) => (
          <Row
            key={r.id}
            title={r.headline}
            /* The ladder, running. Not a description of escalation policy —
               where this item has actually reached, and where it goes next. */
            note={(
              <>
                <b>{r.minutesLate} min late</b>
                {r.escalatedTo && <> · with {role(r.escalatedTo)}</>}
                {r.nextRung && <> · then {role(r.nextRung.to)} at {r.nextRung.afterMinutes} min</>}
                {/* Accountable for the result, whoever happened to be doing it. */}
                {r.owner && <> · owned by {role(r.owner)}</>}
                {r.detail && <> — {r.detail}</>}
              </>
            )}
            tone={toneOf(r.severity)}
            tags={(
              <>
                {/* Not yet escalated is a real state. Showing L1 immediately
                    would make every late thing look identical. */}
                <Tag tone={r.level === null ? 'calm' : 'warn'}>
                  {r.level === null ? 'not yet escalated' : `L${r.level}`}
                </Tag>
                <Tag tone={toneOf(r.severity)}>{SEVERITY_WORD[r.severity] ?? r.severity}</Tag>
                {r.activityCode && <Tag mono>{r.activityCode}</Tag>}
              </>
            )}
          />
        ))}
      </>
    );

  // Rendered inside Attention, which already asks "what needs a person".
  // A separate destination would split one question across two places.
  if (embedded) return body;
  return (
    <Screen wide>
      <Title>What is not happening</Title>
      {body}
    </Screen>
  );
}
