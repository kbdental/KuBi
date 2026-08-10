/**
 * The front door.
 *
 * Rebuilt twice. The first version was a marketing splash; the second was a
 * better-looking role picker, which was the same mistake in a nicer suit. The
 * owner's correction is the right one and it is not about styling:
 *
 *   A pilot opening a cockpit is not asked whether he is the captain or the
 *   first officer. The system knows. It shows aircraft status.
 *
 * So this screen answers exactly one question — **how is my clinic right
 * now** — and offers exactly one action. Who you are is settled afterwards,
 * from the menu at the top right, the way Teams and Slack and Notion do it.
 * Never at the front door.
 *
 * What was deliberately removed: "choose your role", the avatar circles, the
 * persona cards, the multiple entry points, and the demo-simulator feeling
 * that came with them.
 *
 * Everything here is read from the same state the command centre reads, so
 * the front door cannot say READY while the clinic says otherwise.
 */
import { clinicPulse } from '../demo-backend.js';

export interface Persona {
  key: string;
  /**
   * The role, which is the whole identity here.
   *
   * The owner: *"do not put a name to anything keep it role wise… names can
   * change but roles do not change"*. Every rule in the engine is written
   * against a role, so a name on a screen is decoration over the thing the
   * system actually reasons about.
   */
  role: string;
  /** What this person's KuBi actually opens onto, in their own words. */
  sees: string;
}

/**
 * Still needed — by the person menu at the top right, not by this screen.
 * The first entry is who KuBi opens as: the system already knows who you are.
 */
export const PERSONAS: Persona[] = [
  {
    key: 'rahul', role: 'Clinic manager',
    sees: 'The whole clinic — readiness, patients, exceptions, quality.',
  },
  {
    key: 'deepak', role: 'Owner',
    sees: 'Eight numbers and what needs him. No task list.',
  },
  {
    key: 'priya', role: 'Dental assistant',
    sees: 'Her morning, with the current job already open.',
  },
  {
    key: 'anita', role: 'Senior assistant',
    sees: 'Her own work, plus what she must check for somebody else.',
  },
  {
    key: 'kavita', role: 'Reception',
    sees: 'Today’s list, confirmations and follow-up calls.',
  },
  {
    key: 'mehta', role: 'Doctor',
    sees: 'Who is in the chair, who is not ready, and what is waiting on a check.',
  },
  {
    key: 'suresh', role: 'Lab coordinator',
    sees: 'What is late, what arrived, and what may be booked.',
  },
  {
    key: 'ramesh', role: 'Housekeeping',
    sees: 'His rounds, and the rooms waiting to be turned around.',
  },
  {
    key: 'lakshmi', role: 'Sterilisation',
    sees: 'The instrument loop, and what nobody may release yet.',
  },
];

/** Who KuBi opens as. Changed from the menu, never chosen at the door. */
export const DEFAULT_PERSONA = PERSONAS[0]!;

const greeting = (h: number) =>
  (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

export function Entry({ onEnter }: { onEnter: (key: string) => void }) {
  const p = clinicPulse();
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="gate">
      <div className="gate-inner">

        <header className="gate-head">
          <div className="gate-clinic">{p.clinicName.replace('SYNTHETIC ', '')}</div>
          <div className="gate-greet">
            {greeting(now.getHours())}
          </div>
          <div className="gate-when">{day} · {time}</div>
        </header>

        {/* The one question this screen answers. */}
        <div className={`gate-status ${p.open ? 'is-open' : 'is-not'}`}>
          <span className="gate-dot" aria-hidden="true" />
          {p.open ? 'CLINIC OPEN' : 'NOT YET READY'}
          {!p.open && p.openingTotal > 0 && (
            <span className="gate-status-why">
              opening {p.openingDone} of {p.openingTotal}
            </span>
          )}
        </div>

        <div className="gate-health">
          {/* Null is "nothing to measure", never a reassuring zero. */}
          {p.health === null
            ? <span className="gate-nil">no work scheduled</span>
            : <><b>{p.health}</b><span>%</span></>}
          <div className="gate-health-label">today’s health</div>
        </div>

        <dl className="gate-vitals">
          <div><dt>{p.patients}</dt><dd>patients</dd></div>
          <div><dt>{p.inChair}</dt><dd>in chair</dd></div>
          <div className={p.critical > 0 ? 'is-critical' : ''}>
            <dt>{p.critical}</dt><dd>critical</dd>
          </div>
          <div className={p.important > 0 ? 'is-important' : ''}>
            <dt>{p.important}</dt><dd>important</dd>
          </div>
        </dl>

        {p.firstPatientInMinutes !== null && p.firstPatientInMinutes > 0 && (
          <p className="gate-next">
            First patient in <b>{p.firstPatientInMinutes} minutes</b>
          </p>
        )}

        <button className="gate-enter" type="button" onClick={() => onEnter(DEFAULT_PERSONA.key)}>
          Enter clinic
        </button>

        <p className="gate-foot">
          Signing in as {DEFAULT_PERSONA.role}.
          Change person from the menu at the top right.
        </p>

        <p className="gate-synth">
          Demonstration build — every patient, employee and record is synthetic.
        </p>
      </div>
    </div>
  );
}
