import type { Handover as HandoverData, HandoverLine } from '../api.js';
import { IconTick, IconAlert } from '../icons.js';

/**
 * What tomorrow inherits.
 *
 * The screen the last person out reads, and the first person in reads again.
 * Deliberately a read: nothing here can be ticked, because a handover is not
 * work — it is the honest statement of what is being left behind. Making any of
 * it tickable would let somebody clear the list without clearing the clinic.
 *
 * Four questions, in the order a person actually asks them:
 *   - what never got done?
 *   - what is finished but unconfirmed?
 *   - what problems are still open?
 *   - which patients did not get seen?
 *
 * No names anywhere (usability review Q6). A handover is about what is
 * outstanding, not about who to blame for it — and the audit trail already
 * knows who did what, for the people whose job that is.
 */

const SEVERITY_LABEL: Record<HandoverLine['severity'], string> = {
  PATIENT_SAFETY: 'Patient safety',
  CRITICAL: 'Needs immediate action',
  IMPORTANT: 'Needs attention',
  ROUTINE: 'Routine',
};

/**
 * The pill class per severity, written out rather than derived from the enum.
 * Deriving it silently produced `pill-patient-safety`, which matches no rule,
 * so the most serious severity in the system rendered as unstyled text — the
 * one that had to stand out was the one that disappeared.
 */
const SEVERITY_PILL: Record<HandoverLine['severity'], string> = {
  PATIENT_SAFETY: 'pill-safety',
  CRITICAL: 'pill-critical',
  IMPORTANT: 'pill-important',
  ROUTINE: 'pill-routine',
};

function Section({
  title, note, lines,
}: {
  title: string;
  note: string;
  lines: HandoverLine[];
}) {
  // An empty section is not drawn. A handover padded out with four "nothing
  // here" headings buries the one section that does have something in it.
  if (lines.length === 0) return null;

  return (
    <section className="hand-section">
      <h2 className="hand-title">
        {title} <span className="hand-count">{lines.length}</span>
      </h2>
      <p className="hand-note">{note}</p>
      <ul className="hand-list">
        {lines.map((l, i) => (
          <li className="hand-line" key={`${l.headline}-${i}`}>
            <div className="hand-line-head">
              <span className="hand-line-title">{l.headline}</span>
              <span className={`pill ${SEVERITY_PILL[l.severity]}`}>
                {SEVERITY_LABEL[l.severity]}
              </span>
            </div>
            {l.detail && <p className="hand-line-detail">{l.detail}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Handover({ data }: { data: HandoverData }) {
  const carried = data.unfinished.length + data.waitingOnSomeone.length
    + data.stillOpen.length + data.patientsNotSeen.length;

  return (
    <div className="screen">
      <h1 className="screen-title">Handover</h1>
      <p className="screen-sub">
        {data.periodKey === null
          ? 'There is nothing recorded for today yet.'
          : data.clear
            ? 'Nothing is being carried into tomorrow.'
            : `${carried} ${carried === 1 ? 'thing' : 'things'} tomorrow needs to know about.`}
      </p>

      {data.clear ? (
        <div className="hand-clear">
          <span className="hand-clear-mark" aria-hidden="true"><IconTick size={22} /></span>
          <div>
            <div className="hand-clear-title">The day is clear</div>
            <p className="hand-clear-note">
              Everything was finished and confirmed, every problem is closed, and every
              patient on today’s list was seen. Safe to lock up.
            </p>
          </div>
        </div>
      ) : (
        <div className="hand-warn">
          <span aria-hidden="true"><IconAlert size={18} /></span>
          <span>Read this before you lock up. Whoever opens tomorrow will see the same list.</span>
        </div>
      )}

      <Section
        title="Not done"
        note="These never got finished today."
        lines={data.unfinished}
      />
      <Section
        title="Waiting to be confirmed"
        note="The work happened. What is missing is a second pair of eyes."
        lines={data.waitingOnSomeone}
      />
      <Section
        title="Problems still open"
        note="Reported and not yet sorted out."
        lines={data.stillOpen}
      />
      <Section
        title="Patients not seen"
        note="Someone outside the clinic is waiting on each of these."
        lines={data.patientsNotSeen}
      />
    </div>
  );
}
