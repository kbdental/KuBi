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
import { Row, Tag, Empty, type Tone } from '../ui.js';

const SEVERITY_TONE: Record<string, Tone> = {
  EMERGENCY: 'stop', CRITICAL: 'stop', IMPORTANT: 'warn', ROUTINE: 'calm',
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

  if (rows.length === 0) {
    return (
      <Empty big="Nothing to tell you">
        No condition in the clinic currently warrants a message.
      </Empty>
    );
  }

  return (
    <>
      <p className="screen-sub">
        Derived from what is true right now. Nothing here is dismissed — an item leaves
        when the condition behind it stops being true.
      </p>

      {rows.map((n) => {
        const tone = SEVERITY_TONE[n.severity] ?? 'calm';
        return (
          <Row
            key={n.id}
            title={n.headline}
            {...(n.detail ? { note: n.detail } : {})}
            tone={tone}
            tags={(
              <>
                <Tag tone={tone}>{KIND_WORD[n.kind] ?? n.kind}</Tag>
                <Tag>{n.to}</Tag>
                {/* Every notification traces to a standard where one exists. */}
                {n.activityId && <Tag mono>{n.activityId}</Tag>}
              </>
            )}
          />
        );
      })}
    </>
  );
}
