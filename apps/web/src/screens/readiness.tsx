import type {
  AttendanceView, DayBlock, HygieneScreenView, ReadinessLaneView,
} from '../api.js';
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

        {/* One lane per role, in the order the work happens.
            *"There should be clean demarcation of who is doing what."*

            The flat list this replaced could tell you nine of eleven blocks
            were done and not whether the assistants were nearly finished or
            housekeeping had not started — completely different mornings, one
            number. Each lane is one person's share, with its own fraction, so
            the manager reads five short answers instead of one long one and
            every one of them names somebody. */}
        {r.lanes.map((lane) => (
          <Lane
            key={lane.role}
            lane={lane}
            busy={busy}
            mine={mine}
            onReport={(b) => void report(b)}
          />
        ))}

        {r.advisory.length > 0 && (
          <div className="ready-advisory">
            <div className="ready-advisory-head">As required — does not hold the clinic</div>
            <BlockList blocks={r.advisory} busy={busy} mine={mine}
              onReport={(b) => void report(b)} />
          </div>
        )}
      </section>

      <Hygiene h={view.hygiene} />
    </div>
  );
}

/**
 * One role's whole morning.
 *
 * The fraction sits in the heading rather than on the rows, because the
 * question a manager is asking at 09:15 is "who is behind" and not "which of
 * these forty items". Reading down five headings answers it in five seconds;
 * reading eleven rows does not answer it at all.
 */
function Lane({
  lane, busy, mine, onReport,
}: {
  lane: ReadinessLaneView;
  busy: string | null;
  mine: (owner: string) => boolean;
  onReport: (b: DayBlock) => void;
}) {
  return (
    <div className={`lane ${lane.ready ? 'is-done' : ''}`}>
      <div className="lane-head">
        <div className="lane-who">
          <span className="lane-mark" aria-hidden="true">{lane.ready ? '✓' : ''}</span>
          <span className="lane-name">{lane.label}</span>
          <span className="lane-question">{lane.question}</span>
        </div>
        <span className={`lane-count ${lane.ready ? 'is-done' : ''}`}>
          {lane.done}/{lane.of}
        </span>
      </div>
      <BlockList
        blocks={lane.blocks.filter((b) => b.mandatory !== false)}
        busy={busy}
        mine={mine}
        onReport={onReport}
        hideOwner
      />
    </div>
  );
}

/**
 * HK-001 to HK-014 — the cleaning that is not the morning.
 *
 * Three of the fourteen gate the opening and are already in housekeeping's
 * lane above. The other eleven are scheduled, daily or after-use rounds: real
 * work, measured, and no part of "may the clinic open". They are here rather
 * than mixed into the lanes because a list that puts the plants next to the
 * hand wash teaches people to skim both.
 */
function Hygiene({ h }: { h: HygieneScreenView }) {
  return (
    <section className="ready-panel">
      <div className="ready-head">
        <div>
          <div className="ready-kicker">CLEANING ROUNDS — NOT PART OF OPENING</div>
          <h2 className="ready-verdict">Rounds today</h2>
          {/* The section's own sentence, over what it actually shows. The
              engine's headline covers all fourteen controls, and leading this
              list with one that lives in a lane above would send somebody
              looking for a row that is not here. */}
          <p className="ready-sub">
            {h.rounds.filter((r) => r.state === 'NOT_DONE').length} of {h.rounds.length}{' '}
            rounds outstanding. None of them holds the clinic.
          </p>
        </div>
      </div>

      <div className="facts">
        {h.kpis.map((k) => (
          <div key={k.label} className="fact">
            {/* Null is "nothing to measure", never a reassuring zero — and the
                denominator travels with the number, because 82% over eleven
                and 82% over two are different statements. */}
            <div className="fact-value">{k.percent === null ? '—' : `${k.percent}%`}</div>
            <div className="fact-label">{k.label} · {k.done}/{k.of}</div>
          </div>
        ))}
        <div className={`fact ${h.failedAudits > 0 ? 'fact-stop' : ''}`}>
          <div className="fact-value">{h.failedAudits}</div>
          <div className="fact-label">Failed hygiene audits</div>
        </div>
      </div>

      <div className="hk-list">
        {h.rounds.map((r) => (
          <div key={r.id} className={`hk ${HK_STATE[r.state]}`}>
            <span className="hk-id">{r.id}</span>
            <span className="hk-what">{r.activity}</span>
            <span className="hk-who">
              {r.doer.split('/').map(who).join(' / ')}
            </span>
            <span className="hk-when">{TRIGGER_WORD[r.trigger] ?? r.trigger}</span>
            <span className="hk-state">{STATE_WORD[r.state]}</span>
          </div>
        ))}
      </div>

      {/* A failed check, said once and pointing at where the work lives. This
          is what the owner's "Failed Hygiene Audits" KPI counts, and it is the
          one outcome a tick sheet cannot produce: somebody looked and was not
          satisfied. */}
      {h.failed.map((f) => (
        <p key={f.id} className="ready-note is-bad">
          {f.id} {f.activity} — check failed. {f.because}
          {f.lane !== null && ` This one is part of opening: it is in ${who(f.lane)}’s lane above.`}
        </p>
      ))}

      {h.defects.map((d) => (
        <p key={d.id} className="ready-note is-warn">
          {d.id} raised a maintenance ticket — {d.because} A tap that is clean
          and broken is a maintenance job, not a cleaning one.
        </p>
      ))}

      {/* Named, not resolved. Constitution rule 4. */}
      {h.openQuestions.length > 0 && (
        <div className="clash">
          <div className="clash-title">
            {h.openQuestions.length} things this matrix does not settle
          </div>
          {h.openQuestions.map((q) => (
            <div key={q} className="clash-row">{q}</div>
          ))}
          <div className="clash-note">
            KuBi has taken a reading where the two documents agree and left
            these alone. Each one changes what the engine reports.
          </div>
        </div>
      )}
    </section>
  );
}

/* Spelled out rather than built from the state, so the library test can see
   every class name this file uses. */
const HK_STATE: Record<HygieneScreenView['rounds'][number]['state'], string> = {
  DONE: 'is-done',
  AWAITING_CHECK: 'is-waiting',
  FAILED_CHECK: 'is-bad',
  NOT_DONE: 'is-open',
  NOT_DUE: 'is-dim',
};

const STATE_WORD: Record<HygieneScreenView['rounds'][number]['state'], string> = {
  DONE: 'Done',
  AWAITING_CHECK: 'Waiting on the checker',
  FAILED_CHECK: 'Check failed',
  NOT_DONE: 'Not done',
  NOT_DUE: 'Not due',
};

const TRIGGER_WORD: Record<string, string> = {
  OPENING: 'Opening',
  TURNOVER: 'Turnover',
  DAILY: 'Daily',
  SCHEDULED: 'Scheduled',
  AFTER_USE: 'After use',
};

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
