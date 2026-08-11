import { api, type LensView, type FailingRow } from '../api.js';
import {
  Screen, Title, Answer, Group, Row, Tag, Fact, Facts, Empty, Notice,
  useLoad, Loading, Failed, type Tone,
} from '../ui.js';

/**
 * THE DASHBOARD — what is failing, and who is on it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What the owner asked for, and what was wrong before
 * ─────────────────────────────────────────────────────────────────────────
 *
 * *"This does not show anything to me as a manager, and in the whole app also
 * I cannot see. Clearly I want this as an operational app where on the
 * dashboard I see the attendance, the clinic readiness health with the failing
 * parameters and who is involved in the failing parameters."*
 *
 * The old screen counted things. It could tell you nine blocks were
 * outstanding, and it could not tell you that five of them belonged to a
 * housekeeper who was still on the bus. Counts are not operations. What a
 * manager does at 09:15 is pick up a telephone, and to do that they need three
 * things in one place: **what is broken, how badly, and whose name to say.**
 *
 * So every row here is a failing parameter carrying its people. Nothing is a
 * tile; nothing is a percentage that has to be interpreted. If a row has
 * nobody on it, that is drawn louder than the row itself — an unowned failure
 * is the one still here at six o'clock.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * And each role gets a different screen
 * ─────────────────────────────────────────────────────────────────────────
 *
 * *"All the task should not be seen by all, only related, so that confusion
 * does not happen."*
 *
 * The narrowing is done on the server — this file receives one person's share
 * and renders it. The one thing it must do honestly is say how much it is
 * *not* showing: `hidden` is drawn, always, because "3 outstanding" and "3 of
 * 11, the rest are not yours" are different sentences and only the second one
 * is true.
 */

const hhmm = (m: number | null | undefined): string =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * A due time said the way a person would say it.
 *
 * `hhmm` alone produced "Due -60:-30" on this screen, because a due time can
 * be in the past — a service overdue by weeks, or a gate whose moment passed
 * before anybody looked. A clock face cannot express that, and printing one
 * anyway is the "never imply a state you do not have" rule broken in the
 * smallest possible way.
 *
 * So: a time today, or how long ago it went by. Days rather than a date,
 * because "29 days overdue" is a decision and "12 July" is arithmetic
 * somebody has to do standing up.
 */
function dueWord(dueAt: number | null, now: number): string | null {
  if (dueAt === null) return null;
  if (dueAt >= 0 && dueAt < 24 * 60) {
    return dueAt < now ? `Due ${hhmm(dueAt)}, passed` : `Due ${hhmm(dueAt)}`;
  }
  const days = Math.round((now - dueAt) / (24 * 60));
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} overdue`;
  const mins = now - dueAt;
  return mins > 0 ? `${mins} minutes overdue` : `Due in ${-mins} minutes`;
}

const SEVERITY_WORD: Record<FailingRow['severity'], string> = {
  STOPS: 'STOPS WORK', HOLDS: 'HOLDS', WATCH: 'WATCH',
};

/**
 * Spelled out rather than built from the severity.
 *
 * `fail-${sev.toLowerCase()}` reads better and defeats the library test, which
 * can only check class names it can see. A class name assembled at runtime is
 * a class name nobody can grep for — so the map is the honest form.
 */
const SEVERITY_CLASS: Record<FailingRow['severity'], string> = {
  STOPS: 'fail fail-stops', HOLDS: 'fail fail-holds', WATCH: 'fail fail-watch',
};

const AREA_WORD: Record<string, string> = {
  ATTENDANCE: 'Staffing',
  READINESS: 'Clinic readiness',
  PATIENT: 'Patients today',
  EQUIPMENT: 'Equipment',
  STOCK: 'Stock',
  CLOSING: 'Closing',
};

/**
 * Who is on it — the line the whole screen exists for.
 *
 * Three cases, and the middle one is the one that matters: somebody is here
 * and can be asked; somebody is here and is themselves the problem; or nobody
 * holds the role at all, which is not a blank field but the most useful
 * sentence on the page.
 */
function Involved({ row }: { row: FailingRow }) {
  if (row.involved.length === 0) {
    return (
      <span className="who who-nobody">
        Nobody is holding {row.ownerRole ? roleWord(row.ownerRole) : 'this'} today
      </span>
    );
  }
  return (
    <span className="who">
      {row.involved.map((p) => (
        <span className="who-person" key={p.employeeCode}>
          <b className="who-name">{p.label}</b>
          <span className="who-note">{p.note}</span>
        </span>
      ))}
    </span>
  );
}

function Failing({ row, now }: { row: FailingRow; now: number }) {
  const due = dueWord(row.dueAt, now);
  return (
    <div className={SEVERITY_CLASS[row.severity]}>
      <div className="fail-head">
        <span className="fail-what">{row.what}</span>
        <span className="fail-sev">{SEVERITY_WORD[row.severity]}</span>
      </div>
      <p className="fail-why">{row.because}</p>
      <div className="fail-foot">
        <Involved row={row} />
        <span className="fail-where">
          {due === null ? row.goes : `${due} · ${row.goes}`}
        </span>
      </div>
    </div>
  );
}

/**
 * The roster, for whoever runs the clinic.
 *
 * A count of heads would be cheaper and would answer nothing. What a manager
 * needs is which *positions* are held, because the morning is a set of jobs
 * and not a headcount — five people in the building with nobody on the
 * autoclave is a clinic that cannot open.
 */
function Staffing({ s }: { s: NonNullable<LensView['staffing']> }) {
  return (
    <Group title="Attendance" note={s.headline} tone={s.staffed ? 'good' : 'stop'}>
      <Facts>
        <Fact value={`${s.here}/${s.expected}`} label="In the building"
          tone={s.here === s.expected ? 'good' : 'warn'} />
        <Fact value={s.unaccounted} label="Unaccounted for"
          tone={s.unaccounted > 0 ? 'stop' : 'good'} />
        <Fact value={s.lateUnexplained} label="Late, no reason"
          tone={s.lateUnexplained > 0 ? 'warn' : 'good'} />
        <Fact value={s.onLeave} label="On leave" />
      </Facts>

      <div className="staff-roles">
        {s.coverage.map((c) => (
          <div className={`staff-role${c.covered ? ' is-done' : ' is-bad'}`} key={c.role}>
            <span className="staff-mark">{c.covered ? '✓' : '—'}</span>
            <span className="staff-name">{roleWord(c.role)}</span>
            <span className="staff-count">{c.here}/{c.needed}</span>
            <span className="staff-owns">
              {c.owns}{c.neededBy === null ? '' : ` · from ${hhmm(c.neededBy)}`}
            </span>
          </div>
        ))}
      </div>
    </Group>
  );
}

/**
 * The one row for somebody who is not running the clinic.
 *
 * They do not get the roster — a housekeeper does not need to know who else is
 * late. They get their own line, because "am I on time" is a real question and
 * the app should not make them guess.
 */
function Me({ me }: { me: NonNullable<LensView['me']> }) {
  const late = me.inAt !== null && me.inAt > me.dueIn;
  return (
    <Group title="You today" tone={late ? 'warn' : 'good'}>
      <Row
        title={me.label}
        note={me.headline}
        tone={late ? 'warn' : 'good'}
        tags={<Tag tone={late ? 'warn' : 'good'} mono>Due {hhmm(me.dueIn)}</Tag>}
      />
    </Group>
  );
}

export function Dashboard({ go }: { go: (id: string) => void }) {
  const { data, failed, reload } = useLoad<LensView>(() => api.lens(), []);

  if (failed) return <Failed what="Could not read the clinic." back={reload} />;
  if (!data) return <Loading />;

  const worst = data.failing[0]?.severity;
  const tone: Tone = worst === 'STOPS' ? 'stop'
    : worst === 'HOLDS' ? 'warn'
      : worst === 'WATCH' ? 'calm' : 'good';

  // Grouped by area, in the order the day happens: staffing, then the
  // morning, then the patients it was made ready for.
  const ORDER = ['ATTENDANCE', 'READINESS', 'PATIENT', 'EQUIPMENT', 'STOCK', 'CLOSING'];
  const byArea = ORDER
    .map((area) => ({ area, rows: data.failing.filter((f) => f.area === area) }))
    .filter((g) => g.rows.length > 0);

  const stops = data.failing.filter((f) => f.severity === 'STOPS').length;

  return (
    <Screen wide>
      <Title question={data.question}>Dashboard</Title>

      <Answer
        verdict={stops > 0 ? 'WORK IS STOPPED' : data.failing.length > 0 ? 'RUNNING, WITH PROBLEMS' : 'CLEAR'}
        why={data.headline}
        tone={tone}
      />

      {/* The book against the roster. Not a failing parameter — nothing is
          broken today — but a standing promise the building cannot keep, and
          the manager is the only person who can settle it. */}
      {!data.booking.honest && data.wholeClinic && (
        <Notice tone="warn" title="The appointment book promises more than the roster can deliver">
          {data.booking.because}
          {' '}KuBi will not choose between them: either somebody comes in earlier,
          the instruments are cycled the evening before, or the book opens later.
        </Notice>
      )}

      {data.staffing ? <Staffing s={data.staffing} /> : data.me ? <Me me={data.me} /> : null}

      {byArea.map(({ area, rows }) => (
        <Group
          key={area}
          title={AREA_WORD[area] ?? area}
          count={rows.length}
          tone={rows.some((r) => r.severity === 'STOPS') ? 'stop' : 'warn'}
        >
          <div className="fail-list">
            {rows.map((r) => <Failing row={r} now={data.now} key={r.id} />)}
          </div>
          <button className="btn btn-quiet" type="button" onClick={() => go(placeOf(area))}>
            Open {AREA_WORD[area] ?? area}
          </button>
        </Group>
      ))}

      {data.failing.length === 0 && (
        <Empty big={data.wholeClinic ? 'Nothing is failing.' : 'Nothing outstanding for you.'}>
          {data.wholeClinic
            ? 'Every position is covered, the morning is reported, and no booking is held.'
            : 'The clinic may still have work on it — none of it is yours.'}
        </Empty>
      )}

      {/* Said out loud, always. A short list that does not admit it is short
          teaches people they are seeing everything, which is worse than
          showing them nothing. */}
      {data.hidden > 0 && (
        <p className="screen-sub">
          Showing {data.failing.length} of {data.total}. The other {data.hidden} belong to
          other roles and are not yours to act on.
        </p>
      )}
    </Screen>
  );
}

/** Which place on the rail deals with this kind of failure. */
function placeOf(area: string): string {
  switch (area) {
    case 'ATTENDANCE':
    case 'READINESS': return 'READINESS';
    case 'PATIENT': return 'PATIENT_EVENTS';
    case 'EQUIPMENT':
    case 'STOCK': return 'EQUIPMENT';
    case 'CLOSING': return 'CLOSING';
    default: return 'MORE';
  }
}

/** A role code as a person would say it. */
function roleWord(code: string): string {
  return code.toLowerCase().replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
