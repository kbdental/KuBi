/**
 * The audit trail — module 7, on screen.
 *
 * Lives inside Quality as a second view, because Quality is already the screen
 * about how the clinic learns and an audit trail is the evidence it learns
 * from.
 *
 * Two things this shows that a log would not:
 *
 *   - **Refusals.** The entries where the system said no are the ones an
 *     auditor asks about, and most products never record them at all.
 *   - **Corrections.** A superseded entry stays visible with its replacement,
 *     so the trail shows the mistake and the fix rather than only the fix.
 */
import { useEffect, useState } from 'react';
import { api, type AuditRow } from '../api.js';
import { Row, Tag, Empty, Switch } from '../ui.js';

const REFUSALS = ['BLOCKED', 'SENT_BACK', 'OVERRIDE_REQUESTED'];

const ACTION_WORD: Record<string, string> = {
  RAISED: 'raised', STARTED: 'started', COMPLETED: 'completed',
  EVIDENCE_RECORDED: 'evidence recorded', VERIFIED: 'verified',
  SENT_BACK: 'sent back', BLOCKED: 'blocked',
  OVERRIDE_REQUESTED: 'override requested', OVERRIDE_GRANTED: 'override granted',
  ESCALATED: 'escalated', DEVIATION_RAISED: 'deviation',
  CAPA_OPENED: 'CAPA opened', CAPA_CLOSED: 'CAPA closed',
  NOT_APPLICABLE_CLAIMED: 'claimed not applicable',
};

export function AuditTrail() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [only, setOnly] = useState<'ALL' | 'REFUSALS' | 'DEVIATIONS'>('ALL');
  useEffect(() => { void api.audit().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <p className="screen-sub">Loading…</p>;

  const shown = rows.filter((r) => {
    if (only === 'REFUSALS') return REFUSALS.includes(r.action);
    if (only === 'DEVIATIONS') return r.deviation != null;
    return true;
  });

  return (
    <>
      <p className="screen-sub">
        Append-only. Nothing here can be edited or removed — a correction is a new entry
        that points at the old one, so the trail shows both.
      </p>

      <Switch
        value={only}
        onChange={setOnly}
        options={[
          { value: 'ALL', label: 'Everything' },
          { value: 'REFUSALS', label: 'What was refused' },
          { value: 'DEVIATIONS', label: 'Deviations' },
        ]}
      />

      {shown.length === 0 ? (
        <Empty big={rows.length === 0 ? 'Nothing recorded yet' : 'Nothing of that kind'}>
          {rows.length === 0
            ? 'Complete or start a task and it appears here.'
            : only === 'REFUSALS'
              ? 'The system has not had to refuse anything.'
              : 'No departure from a standard has been recorded.'}
        </Empty>
      ) : shown.map((r) => {
        const refused = REFUSALS.includes(r.action);
        return (
          <Row
            key={r.id}
            title={r.subject}
            note={(
              <>
                by {r.by}
                {r.verifiedBy && ` · verified by ${r.verifiedBy}`}
                {' · '}{new Date(r.at).toLocaleTimeString()}
                {/* What the evidence actually said, not merely that some existed. */}
                {r.evidenceValue && <> · {r.evidenceValue}</>}
                {r.supersedes && <> · supersedes {r.supersedes}, both are kept</>}
              </>
            )}
            tone={refused ? 'stop' : r.deviation ? 'warn' : 'calm'}
            tags={(
              <>
                <Tag tone={refused ? 'stop' : 'calm'}>{ACTION_WORD[r.action] ?? r.action}</Tag>
                <Tag mono>{r.activityId}</Tag>
                {r.deviation && <Tag tone="warn">{r.deviation}</Tag>}
              </>
            )}
          />
        );
      })}
    </>
  );
}
