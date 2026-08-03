/**
 * Quality — the IMPROVE stage of the loop, on a screen.
 *
 * The requirement's §8 loop ends: … → ESCALATE → MEASURE → **IMPROVE**. Every
 * other stage had a screen. This one did not, which meant the clinic could see
 * a failure, escalate it, score it — and then do nothing structural about it,
 * for ever.
 *
 * The design follows the same rule as the rest of KuBi: say where the thing is
 * before saying what you owe. An incident is not "open" or "closed", it is
 * somewhere on a journey, so the rail across the top of each card shows how far
 * round it has travelled and the line underneath says the single next step. A
 * status word tells you where a thing is; it does not tell you what to do.
 *
 * The refusals are the point, so the screen states them BEFORE you hit them:
 * the close button explains what is missing rather than failing when pressed.
 */
import { useEffect, useState } from 'react';
import { AuditTrail } from './audit.js';
import { api, type Incident, type CapaAction } from '../api';

const STAGE_LABELS = ['Reported', 'Contained', 'Investigated', 'Actions planned', 'Verifying', 'Closed'];

const PARAMETER_LABEL: Record<string, string> = {
  ATTENDANCE_LEAVE: 'Attendance & leave', OPENING_READINESS: 'Opening readiness',
  CLEANLINESS: 'Cleanliness', MAINTENANCE_UTILITIES: 'Maintenance & utilities',
  INFECTION_CONTROL: 'Infection control', ROOM_CHAIR_READINESS: 'Room & chair readiness',
  APPOINTMENT_CONTROL: 'Appointments', PATIENT_JOURNEY: 'Patient journey',
  CLINICAL_DOCUMENTATION: 'Clinical documentation', SURGICAL_HIGH_RISK: 'Surgery & high-risk',
  FOLLOWUP_EXPERIENCE: 'Follow-up & experience', LABORATORY: 'Laboratory',
  INVENTORY_IMPLANTS: 'Inventory & implants', STAFF_CONDUCT: 'Staff conduct',
  SAFETY_EMERGENCY: 'Safety & emergency', QUALITY_CAPA: 'Quality & CAPA',
};

/**
 * The same severity vocabulary Attention uses, deliberately not a second one.
 *
 * Looked up rather than derived from the enum string: PATIENT_SAFETY through a
 * naive `pill-${lower}` produces `pill-patient-safety`, which matches no rule
 * and silently renders the most serious level as unstyled text. That defect
 * has been fixed here once already.
 */
const SEVERITY: Record<string, { label: string; className: string }> = {
  PATIENT_SAFETY: { label: 'Patient Safety', className: 'pill pill-safety' },
  CRITICAL: { label: 'Needs Immediate Action', className: 'pill pill-critical' },
  IMPORTANT: { label: 'Needs Attention', className: 'pill pill-important' },
  ROUTINE: { label: 'Routine', className: 'pill pill-routine' },
};

export function Quality({ onChanged }: { onChanged?: () => void }) {
  // Quality is how the clinic learns; the audit trail is the evidence it
  // learns from. One destination, two views.
  const [view, setView] = useState<'INCIDENTS' | 'AUDIT'>('INCIDENTS');
  const [items, setItems] = useState<Incident[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setItems(await api.incidents());
    } catch {
      setItems([]);
    }
  }
  useEffect(() => { void reload(); }, []);

  if (!items) return <div className="screen"><p className="screen-sub">Loading…</p></div>;

  const live = items.filter((i) => i.status !== 'CLOSED');
  const closed = items.filter((i) => i.status === 'CLOSED');

  return (
    <div className="screen">
      <h1 className="screen-title">Quality</h1>

      <div className="std-switch">
        <button
          className={`std-tab ${view === 'INCIDENTS' ? 'is-on' : ''}`}
          type="button"
          onClick={() => setView('INCIDENTS')}
        >
          Incidents &amp; CAPA
        </button>
        <button
          className={`std-tab ${view === 'AUDIT' ? 'is-on' : ''}`}
          type="button"
          onClick={() => setView('AUDIT')}
        >
          Audit trail
        </button>
      </div>

      {view === 'AUDIT' && <AuditTrail />}

      {view === 'INCIDENTS' && <>
      <p className="screen-sub">
        What went wrong, why it went wrong, and what stops it happening again.
      </p>

      {error && <div className="notice notice-stop" role="alert">{error}</div>}

      {live.length === 0 && (
        <div className="empty">
          <div className="empty-big">Nothing open</div>
          <div>
            An incident is raised when something worth learning from happens — automatically
            when a control that requires it fails, or by anyone who sees something.
          </div>
        </div>
      )}

      {live.map((inc) => (
        <IncidentCard
          key={inc.id}
          inc={inc}
          expanded={open === inc.id}
          onToggle={() => setOpen(open === inc.id ? null : inc.id)}
          onAct={async (fn) => {
            setError(null);
            try {
              await fn();
              await reload();
              onChanged?.();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'That did not work.');
            }
          }}
        />
      ))}

      {closed.length > 0 && (
        <details className="closed-fold">
          <summary>{closed.length} closed</summary>
          {closed.map((inc) => (
            <div key={inc.id} className="row row-static">
              <div className="row-main">
                <div className="inc-head">
                  <span className="inc-ref">{inc.reference}</span>
                  <span className="pill pill-routine">Closed</span>
                </div>
                <div className="row-title">{inc.summary}</div>
                {/* The learning is the point of keeping it, so it is what shows. */}
                {inc.rootCause && <div className="row-note">Because: {inc.rootCause}</div>}
              </div>
            </div>
          ))}
        </details>
      )}
      </>}
    </div>
  );
}

function IncidentCard({
  inc, expanded, onToggle, onAct,
}: {
  inc: Incident;
  expanded: boolean;
  onToggle: () => void;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const sev = SEVERITY[inc.priority] ?? SEVERITY.ROUTINE!;
  return (
    <article className="row row-static">
      <div className="row-main">
        <div className="inc-head">
          <span className={sev.className}>{sev.label}</span>
          <span className="inc-ref">{inc.reference}</span>
          <span className="inc-meta">
            {PARAMETER_LABEL[inc.parameter] ?? inc.parameter}
            {' · '}
            {inc.ageDays === 0 ? 'today' : `${inc.ageDays} day${inc.ageDays === 1 ? '' : 's'} old`}
          </span>
        </div>

        <div className="row-title">{inc.summary}</div>

      {/* Where it is on the journey, before what it owes. */}
      <ol className="rail" aria-label="Progress">
        {STAGE_LABELS.map((label, i) => (
          <li
            key={label}
            className={`rail-step ${i < inc.stage ? 'done' : i === inc.stage ? 'here' : ''}`}
          >
            <span className="rail-dot" aria-hidden="true" />
            <span className="rail-label">{label}</span>
          </li>
        ))}
      </ol>

        {inc.blockedBy && <div className="next-step">Next: {inc.blockedBy}</div>}

        <button className="btn btn-quiet" type="button" onClick={onToggle}>
          {expanded ? 'Hide' : 'Open'}
        </button>

        {expanded && <IncidentBody inc={inc} onAct={onAct} />}
      </div>
    </article>
  );
}

function IncidentBody({
  inc, onAct,
}: {
  inc: Incident;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [correction, setCorrection] = useState('');
  const [cause, setCause] = useState('');
  const [actionText, setActionText] = useState('');
  const [actionType, setActionType] = useState<'CORRECTIVE' | 'PREVENTIVE'>('PREVENTIVE');

  return (
    <div className="inc-body">
      {inc.description && <p className="row-note">{inc.description}</p>}

      {/* Step 1 — what was done about today. */}
      <section className="step">
        <h3>What was done about it today</h3>
        {inc.immediateCorrection ? (
          <p className="said">{inc.immediateCorrection}</p>
        ) : (
          <>
            <p className="row-note">
              The patient in the chair cannot wait for a root cause. Record the immediate
              correction first — it is not the fix, and KuBi keeps the two apart.
            </p>
            <textarea
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              placeholder="What was done right away"
              rows={2}
            />
            <button
              type="button"
              className="btn"
              disabled={!correction.trim()}
              onClick={() => void onAct(() => api.containIncident(inc.id, correction))}
            >
              Record it
            </button>
          </>
        )}
      </section>

      {/* Step 2 — why. Locked until step 1 exists. */}
      <section className={`step ${inc.immediateCorrection ? '' : 'step-locked'}`}>
        <h3>Why it happened</h3>
        {inc.rootCause ? (
          <p className="said">{inc.rootCause}</p>
        ) : inc.immediateCorrection ? (
          <>
            <textarea
              value={cause}
              onChange={(e) => setCause(e.target.value)}
              placeholder="The reason it was possible — not who did it"
              rows={2}
            />
            <button
              type="button"
              className="btn"
              disabled={!cause.trim()}
              onClick={() => void onAct(() => api.investigateIncident(inc.id, cause))}
            >
              Record the cause
            </button>
          </>
        ) : (
          <p className="row-note">Record what was done about today first.</p>
        )}
      </section>

      {/* Step 3 — actions. Locked until there is a cause. */}
      <section className={`step ${inc.rootCause ? '' : 'step-locked'}`}>
        <h3>What happens now</h3>
        {inc.actions.map((a) => (
          <ActionRow key={a.id} action={a} onAct={onAct} />
        ))}

        {inc.rootCause ? (
          <div className="add-action">
            <div className="seg">
              <button
                type="button"
                className={actionType === 'CORRECTIVE' ? 'on' : ''}
                onClick={() => setActionType('CORRECTIVE')}
              >
                Corrective — fixes this one
              </button>
              <button
                type="button"
                className={actionType === 'PREVENTIVE' ? 'on' : ''}
                onClick={() => setActionType('PREVENTIVE')}
              >
                Preventive — stops the next
              </button>
            </div>
            <textarea
              value={actionText}
              onChange={(e) => setActionText(e.target.value)}
              placeholder={actionType === 'PREVENTIVE'
                ? 'What changes so this cannot happen again'
                : 'What fixes this instance'}
              rows={2}
            />
            <button
              type="button"
              className="btn"
              disabled={!actionText.trim()}
              onClick={() => void onAct(async () => {
                await api.addCapaAction(inc.id, actionType, actionText);
                setActionText('');
              })}
            >
              Add
            </button>
          </div>
        ) : (
          <p className="row-note">Record why it happened first.</p>
        )}
      </section>

      {/* Step 4 — close, with the reason it cannot stated up front. */}
      <section className="step">
        {inc.canClose ? (
          <button
            type="button"
            className="btn"
            onClick={() => void onAct(() => api.closeIncident(inc.id))}
          >
            Close {inc.reference}
          </button>
        ) : (
          <p className="row-note">
            {closeBlockedBecause(inc)}
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Why the close button is not there yet.
 *
 * Stated before the press rather than as an error after it — the same reason
 * the disabled Finish button on a task explains itself: a control that refuses
 * without saying why reads as broken rather than as not-yet.
 */
function closeBlockedBecause(inc: Incident): string {
  if (inc.actions.length === 0) {
    return 'Closing needs at least one action. An incident closed without one has taught the clinic nothing.';
  }
  if (!inc.actions.some((a) => a.type === 'PREVENTIVE')) {
    return 'Closing needs a preventive action. Correcting this one instance does not stop the next.';
  }
  const n = inc.actions.filter((a) => a.status !== 'EFFECTIVE' && a.status !== 'CLOSED').length;
  if (n > 0) {
    // Not "checked" — proven. Carried out and worked are different claims, and
    // closing on the first one is how a clinic fixes the same thing for ever.
    return `Closing needs every action proven to have worked — ${n} still ${n === 1 ? 'has' : 'have'} not been.`;
  }
  return '';
}

function ActionRow({
  action, onAct,
}: {
  action: CapaAction;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <div className="action-row">
      <span className={`tag ${action.type === 'PREVENTIVE' ? 'tag-prevent' : 'tag-correct'}`}>
        {action.type === 'PREVENTIVE' ? 'Preventive' : 'Corrective'}
      </span>
      <div className="action-main">
        <p>{action.description}</p>
        <p className="row-note">
          {action.responsibleName}
          {action.status === 'EFFECTIVE' && action.verifiedBy && ` · checked by ${action.verifiedBy}`}
          {action.status === 'EFFECTIVENESS_PENDING' && ' · waiting to see if it worked'}
          {/* A CAPA on its third attempt is a different conversation from one
              on its first, so the count is said rather than hidden. */}
          {action.ineffectiveCount > 0
            && ` · didn’t work ${action.ineffectiveCount === 1 ? 'once' : `${action.ineffectiveCount} times`} before`}
        </p>
      </div>
      {action.status === 'EFFECTIVE' || action.status === 'CLOSED' ? (
        <span className="pill pill-routine">Worked</span>
      ) : action.status === 'EFFECTIVENESS_PENDING' ? (
        // Two answers, not one. A check that can only be answered yes is a
        // formality, and the loop never actually turns.
        <div className="eff">
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => void onAct(() => api.checkCapaEffectiveness(action.id, true))}
          >
            It worked
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => void onAct(() => api.checkCapaEffectiveness(action.id, false))}
          >
            It didn’t
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => void onAct(() => api.implementCapaAction(action.id))}
        >
          Done
        </button>
      )}
    </div>
  );
}
