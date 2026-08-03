/**
 * The way in.
 *
 * The demo used to open straight into a dental assistant's task list at 08:52,
 * mid-morning, with no explanation. That is abrupt for the same reason walking
 * into a stranger's shift is abrupt: you arrive already behind, with no idea
 * what you are looking at or why this person's list is the one in front of you.
 *
 * So this says what KuBi is in one sentence, and then asks whose day you want
 * to see. That is not decoration — the whole product is role-specific by
 * design ("do not show everybody the entire clinic"), and choosing a person is
 * how you find that out. An owner sees eight numbers; an assistant sees the
 * next three things she has to do. Landing as one of them without being told
 * makes the app look thinner than it is.
 *
 * Everything on this screen is synthetic and says so, because a screenshot of
 * it must never be mistakeable for a real clinic.
 */

export interface Persona {
  key: string;
  name: string;
  role: string;
  /** What this person's KuBi actually opens onto, in their own words. */
  sees: string;
}

export const PERSONAS: Persona[] = [
  {
    key: 'deepak', name: 'Deepak V.', role: 'Owner',
    sees: 'Eight numbers and what needs him. No task list.',
  },
  {
    key: 'rahul', name: 'Rahul M.', role: 'Clinic manager',
    sees: 'The whole clinic — readiness, patients, exceptions, quality.',
  },
  {
    key: 'priya', name: 'Priya S.', role: 'Dental assistant',
    sees: 'Her morning, with the current job already open.',
  },
  {
    key: 'anita', name: 'Anita K.', role: 'Senior assistant',
    sees: 'Her own work, plus what she must check for somebody else.',
  },
  {
    key: 'kavita', name: 'Kavita R.', role: 'Reception',
    sees: 'Today’s list, confirmations and follow-up calls.',
  },
  // Phase 1 is the clinical workflow, so the three people who run the rest of
  // it need a way in. Without a persona their dashboards exist and cannot be
  // opened, which is the same as not existing.
  {
    key: 'mehta', name: 'Dr Mehta', role: 'Doctor',
    sees: 'Who is in the chair, who is not ready, and what is waiting on a check.',
  },
  {
    key: 'suresh', name: 'Suresh B.', role: 'Lab coordinator',
    sees: 'What is late, what arrived, and what may be booked.',
  },
  {
    key: 'lakshmi', name: 'Lakshmi N.', role: 'Sterilisation',
    sees: 'The instrument loop, and what nobody may release yet.',
  },
];

const initials = (name: string) =>
  name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2);

export function Entry({ onPick }: { onPick: (key: string) => void }) {
  return (
    <div className="entry">
      <div className="entry-inner">
        <header className="entry-head">
          <div className="entry-mark">KuBi</div>
          <h1>A clinic that runs itself, and tells you when it doesn’t.</h1>
          <p>
            KuBi turns a clinic’s standards into work that appears on its own, is assigned
            to somebody, has to be proved, gets checked by a second person, and escalates
            when it doesn’t happen. What it shows you depends entirely on who you are.
          </p>
        </header>

        <h2 className="entry-ask">Whose day would you like to see?</h2>
        <div className="entry-people">
          {PERSONAS.map((p) => (
            <button key={p.key} className="persona" type="button" onClick={() => onPick(p.key)}>
              <span className="persona-av">{initials(p.name)}</span>
              <span className="persona-main">
                <span className="persona-name">{p.name}</span>
                <span className="persona-role">{p.role}</span>
                <span className="persona-sees">{p.sees}</span>
              </span>
            </button>
          ))}
        </div>

        <p className="entry-foot">
          Every patient, employee and record here is synthetic. You can switch person at any
          time from the menu at the top right, and wind the day forward to closing.
        </p>
      </div>
    </div>
  );
}
