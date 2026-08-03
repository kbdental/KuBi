/**
 * Notifications — module 9, on screen.
 *
 * Lives inside Attention as a second view rather than a new tab, because
 * Attention already answers "what needs a person" and a separate destination
 * would split one question across two places.
 *
 * The distinction between the two views is worth keeping straight:
 *
 *   Attention     things somebody has to resolve and close.
 *   Notifications things somebody has to be told, derived from current state.
 *
 * A notification disappears when the condition it came from stops being true.
 * Nobody dismisses it, because dismissing a derived fact only hides it.
 */
import { useEffect, useState } from 'react';
import { api, type NotificationRow } from '../api.js';

const SEVERITY: Record<string, string> = {
  EMERGENCY: 'nt-emergency', CRITICAL: 'nt-critical',
  IMPORTANT: 'nt-important', ROUTINE: 'nt-routine',
};
const KIND_WORD: Record<string, string> = {
  TASK_OVERDUE: 'Overdue', LOW_STOCK: 'Stock',
  EQUIPMENT_MAINTENANCE: 'Equipment', FOLLOWUP_DUE: 'Follow-up',
  CONSENT_MISSING: 'Consent', LAB_DELAYED: 'Laboratory',
  PATIENT_WAITING: 'Waiting', EMERGENCY: 'Emergency',
};

export function Notifications() {
  const [rows, setRows] = useState<NotificationRow[] | null>(null);
  useEffect(() => { void api.notifications().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <p className="screen-sub">Loading…</p>;

  return (
    <>
      <p className="screen-sub">
        Derived from what is true right now. Nothing here is dismissed — an item leaves
        when the condition behind it stops being true.
      </p>

      {rows.length === 0 ? (
        <div className="empty">
          <div className="empty-big">Nothing to tell you</div>
          <p className="row-note">No condition in the clinic currently warrants a message.</p>
        </div>
      ) : (
        <ul className="nt-list">
          {rows.map((n) => (
            <li key={n.id} className={`nt-row ${SEVERITY[n.severity] ?? 'nt-routine'}`}>
              <div className="nt-head">
                <span className="nt-kind">{KIND_WORD[n.kind] ?? n.kind}</span>
                <span className="nt-to">{n.to}</span>
                {/* Every notification traces to a standard where one exists. */}
                {n.activityId && <span className="bf-code">{n.activityId}</span>}
              </div>
              <div className="nt-headline">{n.headline}</div>
              {n.detail && <div className="row-note">{n.detail}</div>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
