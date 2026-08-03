/**
 * Patient 360 — and Journey 2, because they are the same thing.
 *
 * A patient record organised by module would be sixteen equal sections and
 * would repeat the mistake the owner just named: every page starting at
 * level 2. So this screen leads with one answer, and the journey is its spine.
 *
 *   Mrs Sharma
 *   NOT READY — signed consent, implant components
 *   ────────────────────────────────
 *   Arrival ✓ · Readiness ✗ · Consent ✗ · Treatment · Lab · Payment …
 *
 * Everything below the headline explains why. Everything KuBi does not hold is
 * named as missing rather than omitted, because a record that silently lacks
 * payments looks complete and is not.
 */
import { useEffect, useState } from 'react';
import { api, type Patient360, type JourneyStage } from '../api.js';

const STATE_CLASS: Record<string, string> = {
  DONE: 'jr-done', NOW: 'jr-now', BLOCKED: 'jr-blocked',
  WAITING: 'jr-waiting', ABSENT: 'jr-absent',
};
const STATE_MARK: Record<string, string> = {
  DONE: '✓', NOW: '●', BLOCKED: '✗', WAITING: '·', ABSENT: '–',
};

export function Patient360({
  patientLabel, onBack,
}: {
  patientLabel: string;
  onBack: () => void;
}) {
  const [p, setP] = useState<Patient360 | null>(null);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = () => { void api.patient(patientLabel).then(setP).catch(() => setFailed(true)); };
  useEffect(load, [patientLabel]);

  /**
   * Move the journey on, from the journey.
   *
   * The whole point of the domain pass: a patient screen that only describes
   * work is a picture. Moving somebody through a morning used to mean leaving
   * this record for the clinic list and back again.
   */
  async function advance(act: NonNullable<JourneyStage['act']>) {
    setBusy(act.id);
    setProblem(null);
    try {
      if (act.kind === 'VISIT') {
        const [visitId, to] = act.id.split(':');
        await api.setAppointmentStatus(visitId!, to as 'ARRIVED' | 'IN_CHAIR' | 'COMPLETED');
      } else {
        await api.startPatientProcedure(act.id);
      }
      load();
    } catch (e) {
      // The server's refusal, passed through unchanged. It is written for a
      // person to read and is usually more useful than anything invented here.
      setProblem(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  if (failed) {
    return (
      <div className="screen">
        <button className="back" type="button" onClick={onBack}>Back</button>
        <p className="screen-sub">No record for that patient.</p>
      </div>
    );
  }
  if (!p) return <div className="screen"><p className="screen-sub">Loading…</p></div>;

  const ready = p.headline.verdict === 'READY';
  const blocked = p.headline.verdict === 'NOT READY';

  return (
    <div className="screen screen-wide p360">
      <button className="back" type="button" onClick={onBack}>Back</button>

      {/* The answer, first and biggest. Everything below explains why. */}
      <h1 className="p360-name">{p.patientLabel.replace('SYNTHETIC ', '')}</h1>
      {p.uhid && <div className="p360-uhid">{p.uhid}</div>}

      <div className={`p360-verdict ${blocked ? 'is-blocked' : ready ? 'is-ready' : 'is-neutral'}`}>
        <b>{p.headline.verdict}</b>
        <span>{p.headline.why}</span>
      </div>

      {/* Safety before anything else, never inside a tab. */}
      {p.alerts.length > 0 && (
        <div className="p360-alerts">
          <div className="p360-alerts-head">Medical alerts — read before treating</div>
          {p.alerts.map((a) => <div key={a} className="p360-alert">{a}</div>)}
        </div>
      )}

      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      {/* Journey 2, as the spine of the record. */}
      <h2 className="cc-head">The journey</h2>
      <ol className="jr">
        {p.journey.map((s) => (
          <li key={s.key} className={`jr-step ${STATE_CLASS[s.state] ?? 'jr-absent'}`}>
            <span className="jr-mark" aria-hidden="true">{STATE_MARK[s.state] ?? '·'}</span>
            <div className="jr-main">
              <div className="jr-label">{s.label}</div>
              {s.detail && <div className="row-note">{s.detail}</div>}
              {/* What is standing in the way, by name. */}
              {s.needs && <div className="jr-needs">{s.needs}</div>}
              {/* One action, at the stage it belongs to. */}
              {s.act && (
                <button
                  className="btn jr-act"
                  type="button"
                  disabled={busy === s.act.id}
                  onClick={() => void advance(s.act!)}
                >
                  {busy === s.act.id ? 'Working…' : s.act.label}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>

      {/* Progressive disclosure: the detail is here, and folded away until
          somebody asks for it. */}
      <button
        className="btn btn-quiet"
        type="button"
        onClick={() => setShowAll(!showAll)}
        aria-expanded={showAll}
      >
        {showAll ? 'Hide the detail' : 'Show the full record'}
      </button>

      {showAll && (
        <div className="p360-detail">
          {/* One continuous log. A timeline explains a day without opening a
              report, which is why owners read them and not dashboards. */}
          <Section title="Timeline" empty="Nothing has happened yet.">
            {p.timeline.map((t, i) => (
              <div key={`${t.at}-${i}`} className={`p360-tl p360-tl-${t.tone.toLowerCase()}`}>
                <span className="p360-tl-at">{t.at}</span>
                <span className="p360-tl-what">{t.what}</span>
              </div>
            ))}
          </Section>

          <Section title="Appointments" empty="Nothing booked.">
            {p.appointments.map((a) => (
              <div key={a.id} className="p360-row">
                <span className="p360-row-main">{a.visitType}</span>
                <span className="row-note">
                  {a.chairLabel} · {a.status.toLowerCase().replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </Section>

          <Section title="Procedures and readiness" empty="No procedure planned.">
            {p.procedures.map((pr) => (
              <div key={pr.id} className="p360-row">
                <span className="p360-row-main">{pr.name}</span>
                <span className="row-note">{pr.status.toLowerCase().replace(/_/g, ' ')}</span>
                <ul className="p360-reqs">
                  {pr.requirements.map((r) => (
                    <li key={r.label} className={r.result === 'PASS' ? 'is-ok' : 'is-not'}>
                      {r.label} — {r.result.toLowerCase().replace(/_/g, ' ')}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Section>

          <Section title="Laboratory" empty="No lab work.">
            {p.labCases.map((l) => (
              <div key={l.id} className="p360-row">
                <span className="p360-row-main">{l.workType}</span>
                <span className="row-note">{l.reference}</span>
                {/* The gate says why, not merely that it refuses. */}
                {l.reason && <div className="jr-needs">{l.reason}</div>}
              </div>
            ))}
          </Section>

          <Section title="Follow-ups" empty="None due.">
            {p.followups.map((f) => (
              <div key={f.id} className="p360-row">
                <span className="p360-row-main">{f.procedureName}</span>
                <span className="row-note">
                  {f.dueLabel} · {f.outcome.toLowerCase().replace(/_/g, ' ')}
                </span>
                {f.redFlagReason && <div className="jr-needs">{f.redFlagReason}</div>}
              </div>
            ))}
          </Section>

          {/* Principle 3 — say the gap out loud. */}
          <section className="p360-missing">
            <div className="why-head">Not held in KuBi yet</div>
            {p.notHeld.map((m) => (
              <div key={m.what} className="p360-row">
                <span className="p360-row-main">{m.what}</span>
                <span className="row-note">needs {m.needs}</span>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

function Section({
  title, empty, children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section className="p360-section">
      <div className="why-head">{title}</div>
      {has ? children : <p className="bf-empty">{empty}</p>}
    </section>
  );
}
