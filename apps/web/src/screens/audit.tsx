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

      <div className="std-switch">
        {(['ALL', 'REFUSALS', 'DEVIATIONS'] as const).map((k) => (
          <button
            key={k}
            className={`std-tab ${only === k ? 'is-on' : ''}`}
            type="button"
            onClick={() => setOnly(k)}
          >
            {k === 'ALL' ? 'Everything' : k === 'REFUSALS' ? 'What was refused' : 'Deviations'}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <div className="empty-big">
            {rows.length === 0 ? 'Nothing recorded yet' : 'Nothing of that kind'}
          </div>
          <p className="row-note">
            {rows.length === 0
              ? 'Complete or start a task and it appears here.'
              : only === 'REFUSALS'
                ? 'The system has not had to refuse anything.'
                : 'No departure from a standard has been recorded.'}
          </p>
        </div>
      ) : (
        <ul className="au-list">
          {shown.map((r) => (
            <li
              key={r.id}
              className={`au-row ${REFUSALS.includes(r.action) ? 'au-refusal' : ''}`}
            >
              <div className="au-head">
                <span className="au-action">{ACTION_WORD[r.action] ?? r.action}</span>
                <span className="bf-code">{r.activityId}</span>
                <span className="au-at">{new Date(r.at).toLocaleTimeString()}</span>
              </div>
              <div className="au-subject">{r.subject}</div>
              <div className="row-note">
                by {r.by}
                {r.verifiedBy && ` · verified by ${r.verifiedBy}`}
              </div>
              {/* What the evidence actually said, not merely that some existed. */}
              {r.evidenceValue && <div className="au-evidence">{r.evidenceValue}</div>}
              {r.deviation && <div className="au-deviation">{r.deviation}</div>}
              {r.supersedes && (
                <div className="row-note">Supersedes {r.supersedes} — both are kept.</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
