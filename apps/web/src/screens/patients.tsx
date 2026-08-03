/**
 * Patients — readiness before the chair, follow-up after it.
 *
 * The requirement is emphatic about what this screen is for: the missing
 * requirement must appear "before the patient reaches the chair, not when the
 * doctor asks for the component." So this never summarises readiness into a
 * single word. It names the requirement that is missing, in clinic language,
 * with the reason attached.
 *
 * Three things the design refuses to do:
 *
 *   It does not hide the medical alerts in a tab. An allergy is not a detail
 *   you go looking for; it sits above everything else on the record.
 *
 *   It does not show a Start button that fails when pressed. A hard block says
 *   so in place, with what is missing, because a control that refuses without
 *   explaining reads as broken rather than as not-yet.
 *
 *   It does not render "could not be determined" as "not ready". A requirement
 *   nothing can evaluate is a question nobody asked, and saying NOT READY
 *   would claim knowledge the clinic does not have.
 */
import { useEffect, useState } from 'react';
import { api, type PatientProcedure, type Requirement, type Followup } from '../api';

/** Result → how it reads and looks. Never derived from the enum string. */
const RESULT: Record<string, { label: string; cls: string }> = {
  PASS: { label: 'Met', cls: 'req-pass' },
  FAIL: { label: 'Missing', cls: 'req-fail' },
  UNKNOWN: { label: 'Unknown', cls: 'req-unknown' },
  NOT_CONFIGURED: { label: 'Cannot check', cls: 'req-unknown' },
  NOT_APPLICABLE: { label: 'Not needed', cls: 'req-na' },
};

const STATUS: Record<string, { label: string; cls: string }> = {
  READY: { label: 'Ready', cls: 'rd-ready' },
  PARTIAL: { label: 'Not ready', cls: 'rd-partial' },
  NOT_READY: { label: 'Not ready', cls: 'rd-notready' },
  PENDING: { label: 'Cannot confirm', cls: 'rd-pending' },
  OVERRIDDEN: { label: 'Released by manager', cls: 'rd-overridden' },
};

export function Patients({
  onChanged, onOpenPatient,
}: {
  onChanged?: () => void;
  /** Everything in a clinic ends at a patient, so every list reaches one. */
  onOpenPatient?: (patientLabel: string) => void;
}) {
  const [procs, setProcs] = useState<PatientProcedure[] | null>(null);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function reload() {
    try {
      const [p, f] = await Promise.all([api.patientProcedures(), api.followups()]);
      setProcs(p);
      setFollowups(f);
    } catch {
      setProcs([]);
    }
  }
  useEffect(() => { void reload(); }, []);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await reload();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    }
  }

  if (!procs) return <div className="screen"><p className="screen-sub">Loading…</p></div>;

  const pending = followups.filter((f) => f.outcome === 'PENDING');
  const flagged = followups.filter((f) => f.outcome === 'RED_FLAG');

  return (
    <div className="screen">
      <h1 className="screen-title">Patients</h1>
      <p className="screen-sub">
        Whether each patient is ready for what they are booked for — and how the last ones are doing.
      </p>

      {error && <div className="notice notice-stop" role="alert">{error}</div>}

      {/* A red flag outranks everything else on this screen. It is somebody
          in trouble at home, not a task on a list. */}
      {flagged.length > 0 && (
        <section className="flagged">
          {flagged.map((f) => (
            <div key={f.id} className="flag-card">
              <span className="pill pill-safety">Clinical review</span>
              <div className="flag-main">
                <div className="row-title">{f.patientLabel}</div>
                <div className="row-note">
                  {f.redFlagReason} · {f.procedureName} · follow-up {f.dueLabel.toLowerCase()}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      <h2 className="group-head">Booked today</h2>
      {procs.map((p) => (
        <ProcedureCard
          onOpenPatient={onOpenPatient}
          key={p.id}
          p={p}
          expanded={open === p.id}
          onToggle={() => setOpen(open === p.id ? null : p.id)}
          onAct={act}
        />
      ))}

      {pending.length > 0 && (
        <>
          <h2 className="group-head">Follow-up calls due</h2>
          {pending.map((f) => <FollowupCard key={f.id} f={f} onAct={act} />)}
        </>
      )}
    </div>
  );
}

function ProcedureCard({
  p, expanded, onToggle, onAct,
  onOpenPatient,
}: {
  onOpenPatient?: ((patientLabel: string) => void) | undefined;
  p: PatientProcedure;
  expanded: boolean;
  onToggle: () => void;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const st = STATUS[p.status] ?? STATUS.PENDING!;

  return (
    <article className="row row-static">
      <div className="row-main">
        <div className="pt-head">
          <span className={`rd ${st.cls}`}>{st.label}</span>
          <span className="pt-when">{p.whenLabel}</span>
        </div>

        {/* The name opens the record. Everything in a clinic ends at a
            patient, so every list reaches one. */}
        {onOpenPatient ? (
          <button
            className="row-title visit-who-link"
            type="button"
            onClick={() => onOpenPatient(p.patientLabel)}
          >
            {p.patientLabel}
          </button>
        ) : (
          <div className="row-title">{p.patientLabel}</div>
        )}
        <div className="row-note">{p.procedureName} · {p.patientUhid}</div>

        {/* Above everything. An allergy is not a detail you go looking for. */}
        {p.alerts.length > 0 && (
          <div className="alerts">
            {p.alerts.map((a) => <span key={a} className="alert-chip">{a}</span>)}
          </div>
        )}

        {/* The exact missing requirement, in place, before the chair. */}
        {p.blocking.length > 0 && (
          <div className="blocking">
            {p.blocking.map((r) => (
              <div key={r.kind} className="blocking-line">
                <span className={`req-dot ${RESULT[r.result]?.cls ?? ''}`} aria-hidden="true" />
                <span><strong>{r.label}</strong> — {r.detail}</span>
              </div>
            ))}
          </div>
        )}

        {p.overriddenBy && (
          <p className="said">
            Released by {p.overriddenBy}: {p.overrideReason}
          </p>
        )}

        <div className="pt-actions">
          <button className="btn btn-quiet" type="button" onClick={onToggle}>
            {expanded ? 'Hide requirements' : `All ${p.requirements.length} requirements`}
          </button>

          {p.decision === 'PROCEED' || p.overriddenBy ? (
            <button
              className="btn"
              type="button"
              onClick={() => void onAct(() => api.startPatientProcedure(p.id))}
            >
              Start
            </button>
          ) : p.decision === 'BLOCK_HARD' ? (
            // Stated rather than offered-then-refused. Nobody may override
            // this, so there is no button to disable and no route to try.
            <span className="cannot">Cannot start until this is resolved</span>
          ) : null}
        </div>

        {p.overridable && !p.overriddenBy && (
          <div className="override">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="If it is safe to proceed, say why"
            />
            <button
              className="btn btn-quiet"
              type="button"
              disabled={!reason.trim()}
              onClick={() => void onAct(() => api.overridePatientProcedure(p.id, reason))}
            >
              Release
            </button>
          </div>
        )}

        {expanded && (
          <ul className="reqs">
            {p.requirements.map((r) => <RequirementRow key={r.kind} r={r} />)}
          </ul>
        )}
      </div>
    </article>
  );
}

function RequirementRow({ r }: { r: Requirement }) {
  const res = RESULT[r.result] ?? RESULT.UNKNOWN!;
  return (
    <li className="req">
      <span className={`req-dot ${res.cls}`} aria-hidden="true" />
      <span className="req-label">{r.label}</span>
      <span className={`req-state ${res.cls}`}>{res.label}</span>
      {/* Only a hard block is worth naming here; the rest is noise on a
          requirement that is already met. */}
      {r.enforcement === 'BLOCK_HARD' && r.result !== 'PASS' && (
        <span className="req-mand">mandatory</span>
      )}
      <span className="req-detail">{r.detail}</span>
    </li>
  );
}

function FollowupCard({
  f, onAct,
}: {
  f: Followup;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [r, setR] = useState({
    pain: 'NONE', swelling: 'EXPECTED', bleeding: 'NO', medication: 'TAKING',
  });
  const [open, setOpen] = useState(false);

  return (
    <article className="row row-static">
      <div className="row-main">
        <div className="row-title">{f.patientLabel}</div>
        <div className="row-note">
          {f.procedureName} · due {f.dueLabel.toLowerCase()}
          {f.overdue && <span className="overdue"> · overdue</span>}
        </div>

        {!open ? (
          <button className="btn btn-quiet" type="button" onClick={() => setOpen(true)}>
            Record the call
          </button>
        ) : (
          <div className="fu-form">
            {/* Four questions, not a tick. Whoever rings records what the
                patient said; whether it is dangerous is the system's call. */}
            <Choice label="Pain" value={r.pain} options={['NONE', 'MILD', 'MODERATE', 'SEVERE']}
              onPick={(v) => setR({ ...r, pain: v })} />
            <Choice label="Swelling" value={r.swelling} options={['EXPECTED', 'EXCESSIVE']}
              onPick={(v) => setR({ ...r, swelling: v })} />
            <Choice label="Bleeding" value={r.bleeding} options={['NO', 'YES']}
              onPick={(v) => setR({ ...r, bleeding: v })} />
            <Choice label="Medication" value={r.medication} options={['TAKING', 'PROBLEM']}
              onPick={(v) => setR({ ...r, medication: v })} />
            <button
              className="btn"
              type="button"
              onClick={() => void onAct(() => api.respondToFollowup(f.id, r))}
            >
              Save
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function Choice({
  label, value, options, onPick,
}: {
  label: string;
  value: string;
  options: string[];
  onPick: (v: string) => void;
}) {
  return (
    <div className="choice">
      <span className="choice-label">{label}</span>
      <div className="choice-opts">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={value === o ? 'on' : ''}
            onClick={() => onPick(o)}
          >
            {o.charAt(0) + o.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
