import type { AttendanceView } from '../api.js';
import {
  useClinic, ownedBy, BlockList, Meter, Loading, hhmm, who,
} from './day-blocks.js';

/**
 * CLINIC READINESS — the morning, and only the morning.
 *
 * Getting the clinic ready for the first patient. The evening is its own place
 * in the rail, at the owner's instruction: *"clinic closing should be in a
 * different tab… it should not be mixed with opening procedures which are
 * making the clinic ready for the patient"*. Nobody standing in the clinic at
 * nine in the morning is thinking about fumigation, and a list that mixes the
 * two makes them read past half of it.
 */
export function ClinicReadiness() {
  const { view, problem, busy, report } = useClinic();
  if (!view) return <Loading problem={problem} />;

  const r = view.readiness;
  const mine = ownedBy(view.role);

  return (
    <div className="screen screen-wide">
      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      <section className="ready-panel">
        <div className="ready-head">
          <div>
            <div className="ready-kicker">BEFORE THE FIRST PATIENT</div>
            <h2 className={`ready-verdict ${r.ready ? 'is-good' : r.overdue ? 'is-bad' : ''}`}>
              {r.unconfigured.length > 0
                ? 'Clinic not set up'
                : !view.unlocked
                  ? 'The clinic has not been unlocked'
                  : r.ready ? 'Clinic is ready' : `${r.outstanding.length} still to do`}
            </h2>
            <p className="ready-sub">
              {r.unconfigured.length > 0
                ? r.unconfigured[0]
                : r.ready
                  ? r.varianceMinutes === null
                    ? `Ready at ${hhmm(r.readyAt)}.`
                    : r.varianceMinutes <= 0
                      ? `Ready at ${hhmm(r.readyAt)} — ${Math.abs(r.varianceMinutes)} min before the first patient.`
                      : `Ready at ${hhmm(r.readyAt)} — ${r.varianceMinutes} min after the first patient was due.`
                  : r.targetAt === null
                    ? 'Nobody is booked today, so there is no time to be ready by.'
                    : r.overdue
                      ? `The first patient was due at ${hhmm(r.targetAt)}.`
                      : `First patient at ${hhmm(r.targetAt)}, in ${r.minutesToTarget} min.`}
            </p>
          </div>
          <Meter percent={Math.round(r.compliance * 100)} good={r.ready} />
        </div>

        {r.startBy !== null && !r.ready && (
          <p className="ready-note">
            Must start by <strong>{hhmm(r.startBy)}</strong> — driven by {r.startDrivenBy}.
          </p>
        )}

        {/* Who is here, before what is undone. A clinic four blocks short with
            nobody to do them has one problem, not four, and the person reading
            this at 09:15 needs to know which. */}
        <Staffing a={view.attendance} />

        {/* Mandatory only. The as-required work has its own section below, and
            listing it twice made the count and the list disagree. */}
        <BlockList
          blocks={r.blocks.filter((b) => b.mandatory !== false)}
          busy={busy}
          mine={mine}
          onReport={(b) => void report(b)}
        />

        {r.advisory.length > 0 && (
          <div className="ready-advisory">
            <div className="ready-advisory-head">As required — does not hold the clinic</div>
            <BlockList blocks={r.advisory} busy={busy} mine={mine}
              onReport={(b) => void report(b)} />
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Who is here.
 *
 * The owner: *"this is an important part of clinic readiness."* Every block
 * below this panel assumes somebody is in the building to do it, so a
 * readiness screen that reports nine outstanding items without noticing the
 * sterilization technician is on leave is reporting the symptom.
 */
function Staffing({ a }: { a: AttendanceView }) {
  return (
    <div className="staffing">
      <div className="care-group-title">
        WHO IS HERE — {a.staffed ? 'every position covered' : 'a position is short'}
      </div>
      <p className={`ready-note ${a.staffed ? '' : 'is-bad'}`}>{a.headline}</p>

      <div className="staff-roles">
        {a.coverage.map((c) => (
          <div key={c.role} className={`staff-role ${c.covered ? 'is-clear' : 'is-open'}`}>
            <span className="staff-mark" aria-hidden="true">{c.covered ? '✓' : '○'}</span>
            <span className="staff-name">{who(c.role)}</span>
            <span className="staff-count">{c.here}/{c.needed}</span>
            {!c.covered && <span className="staff-owns">{c.owns}</span>}
          </div>
        ))}
      </div>

      {/* Each of these is one of the eight controls, and each names what
          somebody has to do rather than adding a number to a dashboard. */}
      {a.unaccounted > 0 && (
        <p className="ready-note is-bad">
          {a.unaccounted} unaccounted for — no attendance and no classified absence.
        </p>
      )}
      {a.lateUnexplained > 0 && (
        <p className="ready-note is-warn">
          {a.lateUnexplained} late with no reason recorded.
        </p>
      )}
      {a.uncovered.map((u) => (
        <p key={u.label} className="ready-note is-bad">
          {u.label} is on approved {u.kind.toLowerCase()} leave and nobody is covering.
        </p>
      ))}
      {a.pendingApproval > 0 && (
        <p className="ready-note is-warn">
          {a.pendingApproval} leave request still undecided with the date approaching.
        </p>
      )}

      {/* Two published standards that cannot both be met. Arithmetic, not an
          opinion — and the owner's to settle, so it is reported not resolved. */}
      {a.contradiction.length > 0 && (
        <div className="clash">
          <div className="clash-title">
            Report for duty is {hhmm(a.reportBy)}, and {a.contradiction.length} roles
            cannot make the morning from there
          </div>
          {a.contradiction.map((c) => (
            <div key={c.role} className="clash-row">
              <strong>{who(c.role)}</strong> — {c.owns}, so their work starts at{' '}
              {hhmm(c.workStartsAt)}. That is {c.shortMinutes} minutes before they
              are asked to be here.
            </div>
          ))}
          <div className="clash-note">
            Both are the clinic’s own standards. Nothing here overrules either —
            the arithmetic is shown so somebody can decide which one moves.
          </div>
        </div>
      )}

      {a.sundayRuleQuestion !== null && a.needsSundayRuling > 0 && (
        <p className="ready-note is-warn">
          {a.needsSundayRuling} leave request spans a Sunday. {a.sundayRuleQuestion}
        </p>
      )}
    </div>
  );
}
