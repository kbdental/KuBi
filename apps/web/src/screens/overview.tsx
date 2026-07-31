import type {
  Overview as OverviewData, AttentionRow, Schedule, ParameterScore, RagStatus,
} from '../api.js';
import { IconGo } from '../icons.js';

/**
 * What each of the 16 control parameters is called on screen.
 *
 * Held here rather than imported from contracts so the web bundle does not
 * pull in the enum register; the server sends the key, the screen names it.
 * A key with no entry falls back to the key itself, visibly wrong rather than
 * silently blank — a nameless tile is one nobody can act on.
 */
const PARAMETER_LABEL: Record<string, string> = {
  ATTENDANCE_LEAVE: 'Attendance & leave',
  OPENING_READINESS: 'Opening readiness',
  CLEANLINESS: 'Cleanliness',
  MAINTENANCE_UTILITIES: 'Maintenance & utilities',
  INFECTION_CONTROL: 'Infection control',
  ROOM_CHAIR_READINESS: 'Room & chair readiness',
  APPOINTMENT_CONTROL: 'Appointments',
  PATIENT_JOURNEY: 'Patient journey',
  CLINICAL_DOCUMENTATION: 'Clinical records',
  SURGICAL_HIGH_RISK: 'Surgery & high-risk care',
  FOLLOWUP_EXPERIENCE: 'Follow-up & experience',
  LABORATORY: 'Laboratory',
  INVENTORY_IMPLANTS: 'Inventory & implants',
  STAFF_CONDUCT: 'Team & coordination',
  SAFETY_EMERGENCY: 'Safety & emergency',
  QUALITY_CAPA: 'Quality & CAPA',
};

const RAG_WORD: Record<RagStatus, string> = {
  GREEN: 'On track',
  AMBER: 'Needs attention',
  RED: 'Needs action',
  GREY: 'Nothing to measure',
};

/**
 * Operational health, and the 16 parameters underneath it.
 *
 * The requirement is explicit about what this screen is for: "management needs
 * to see the exceptions, not 18 green ticks". So the parameters arrive
 * worst-first from the server, every tile that is not green says why in one
 * line, and the ones with nothing to measure are drawn as absent and sink to
 * the bottom rather than padding the screen with reassuring zeros.
 */
function Health({ health }: { health: OverviewData['health'] }) {
  const h = health;
  const needsAction = h.parameters.filter((p) => p.status === 'RED' || p.status === 'AMBER');
  const fine = h.parameters.filter((p) => p.status === 'GREEN');
  const unmeasured = h.parameters.filter((p) => p.status === 'GREY');

  return (
    <>
      <div className={`health is-${h.status.toLowerCase()}`}>
        <div className="health-main">
          <div className="health-label">Operational health</div>
          <div className="health-value">{h.percent === null ? '—' : `${h.percent}%`}</div>
          <div className="health-word">{RAG_WORD[h.status]}</div>
        </div>
        <div className="health-counts">
          <div className="health-count">
            <span className="health-count-n is-critical">{h.needsAttention.critical}</span>
            <span className="health-count-l">Need you today</span>
          </div>
          <div className="health-count">
            <span className="health-count-n">{h.needsAttention.attention}</span>
            <span className="health-count-l">Can wait</span>
          </div>
        </div>
      </div>

      {needsAction.length > 0 && (
        <ParameterGroup
          title="Look at these"
          note="Worst first. Everything else is running."
          rows={needsAction}
        />
      )}

      {needsAction.length === 0 && fine.length > 0 && (
        <p className="param-allclear">
          Every parameter with something to measure today is on track.
        </p>
      )}

      {fine.length > 0 && (
        <ParameterGroup title="On track" note={null} rows={fine} />
      )}

      {unmeasured.length > 0 && (
        <details className="param-rest">
          <summary>
            {unmeasured.length} {unmeasured.length === 1 ? 'parameter' : 'parameters'} with
            nothing to measure today
          </summary>
          {/* Listed, not scored. These are shown so nobody wonders whether the
              clinic forgot them — an absence stated is not the same as an
              absence hidden, and neither is a zero. */}
          <ul className="param-none">
            {unmeasured.map((p) => (
              <li key={p.parameter}>{PARAMETER_LABEL[p.parameter] ?? p.parameter}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function ParameterGroup({
  title, note, rows,
}: {
  title: string;
  note: string | null;
  rows: ParameterScore[];
}) {
  return (
    <section className="param-group">
      <div className="param-group-head">
        <h2 className="param-group-title">{title}</h2>
        {note && <span className="param-group-note">{note}</span>}
      </div>
      <div className="params">
        {rows.map((p) => (
          <div className={`param is-${p.status.toLowerCase()}`} key={p.parameter}>
            <div className="param-head">
              <span className="param-name">{PARAMETER_LABEL[p.parameter] ?? p.parameter}</span>
              <span className="param-pct">{p.percent === null ? '—' : `${p.percent}%`}</span>
            </div>
            <div className="param-bar">
              <div className="param-fill" style={{ width: `${p.percent ?? 0}%` }} />
            </div>
            {/* Only when there is something to say. "All good" under a green
                tile is noise, and noise is what makes a dashboard wallpaper. */}
            {p.because && <div className="param-because">{p.because}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The clinic at a glance — what an owner opens the app for.
 *
 * Four numbers and one trend. Not a wall of charts: a dashboard that shows
 * everything gets read as wallpaper, and the point of this screen is that
 * somebody acts on it.
 *
 * Two rules it keeps:
 *  - A day with no activities is drawn as absent, never as zero. A shut
 *    Sunday rendered as 0% readiness would be a lie about the clinic.
 *  - "Independent checks" is the number that says whether verification is
 *    real or a formality, so it sits next to readiness rather than buried.
 */

function Stat({
  label, value, sub, tone,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  tone?: 'good' | 'warn' | 'bad' | undefined;
}) {
  return (
    <div className={`stat${tone ? ` is-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/**
 * A week of readiness. Drawn with plain bars rather than a chart library:
 * seven values do not need 40 kB of dependency, and hand-drawing means a day
 * with no data can be shown as a hollow slot instead of a zero-height bar
 * that reads as failure.
 */
function WeekBars({ week }: { week: OverviewData['week'] }) {
  const dayName = (periodKey: string) =>
    new Date(`${periodKey}T12:00:00Z`).toLocaleDateString([], { weekday: 'narrow' });

  return (
    <div className="chart">
      <div className="chart-head">
        <span className="chart-title">Readiness this week</span>
        <span className="chart-note">Opening confirmed, per day</span>
      </div>
      <div className="bars">
        {week.map((d) => {
          const has = d.readiness !== null;
          const height = has ? Math.max(4, d.readiness!) : 0;
          const tone = !has ? 'none' : d.readiness! >= 90 ? 'good' : d.readiness! >= 60 ? 'warn' : 'bad';
          return (
            <div className="bar-slot" key={d.periodKey}>
              <div className="bar-track" title={has ? `${d.readiness}%` : 'Nothing scheduled'}>
                {has
                  ? <div className={`bar is-${tone}`} style={{ height: `${height}%` }} />
                  : <div className="bar-none" />}
              </div>
              <div className="bar-value">{has ? `${d.readiness}%` : '—'}</div>
              <div className="bar-day">{dayName(d.periodKey)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SEVERITY_LABEL: Record<string, string> = {
  PATIENT_SAFETY: 'Patient safety',
  CRITICAL: 'Needs immediate action',
  IMPORTANT: 'Needs attention',
  ROUTINE: 'Routine',
};

/** Written out, not derived: see the note in handover.tsx. */
const SEVERITY_PILL: Record<string, string> = {
  PATIENT_SAFETY: 'pill-safety',
  CRITICAL: 'pill-critical',
  IMPORTANT: 'pill-important',
  ROUTINE: 'pill-routine',
};

/**
 * The open problems, worst first, with a way through to the rest.
 *
 * An overview that only counts problems makes the reader go and find them.
 * Three of them by name is the difference between a report and a screen you
 * work from. No reporter or completer names (Q6): the item, not the person.
 */
function NeedsYou({ items, onSeeAll }: { items: AttentionRow[]; onSeeAll: () => void }) {
  const order = ['PATIENT_SAFETY', 'CRITICAL', 'IMPORTANT', 'ROUTINE'];
  const worst = items
    .slice()
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
    .slice(0, 3);

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Needs you</span>
        {items.length > worst.length && (
          <button type="button" className="panel-link" onClick={onSeeAll}>
            All {items.length}
          </button>
        )}
      </div>

      {worst.length === 0 ? (
        <p className="panel-empty">Nothing open. The clinic is clear.</p>
      ) : (
        <ul className="panel-list">
          {worst.map((a) => (
            <li key={a.id}>
              <button type="button" className="panel-row" onClick={onSeeAll}>
                <span className="panel-row-main">
                  <span className="panel-row-title">{a.headline}</span>
                  <span className={`pill ${SEVERITY_PILL[a.severity] ?? 'pill-routine'}`}>
                    {SEVERITY_LABEL[a.severity] ?? a.severity}
                  </span>
                </span>
                <span className="row-go"><IconGo /></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Where today's list has got to, as one bar.
 *
 * Deliberately the clinic's own words — finished, in the chair, waiting, still
 * to come — rather than status tokens. Cancellations are left out of the bar
 * and stated underneath: a cancelled visit is not part of the flow, and
 * folding it in would overstate how much of the day is left.
 */
function DayFlow({ schedule, onSeeAll }: { schedule: Schedule; onSeeAll: () => void }) {
  const rows = schedule.rows;
  const n = (s: string) => rows.filter((r) => r.status === s).length;

  const segments = [
    { key: 'COMPLETED', label: 'Finished', count: n('COMPLETED') },
    { key: 'IN_CHAIR', label: 'In the chair', count: n('IN_CHAIR') },
    { key: 'ARRIVED', label: 'Waiting', count: n('ARRIVED') },
    { key: 'BOOKED', label: 'Still to come', count: n('BOOKED') },
  ];
  const inFlow = segments.reduce((t, s) => t + s.count, 0);
  const aside = [
    n('CANCELLED') > 0 ? `${n('CANCELLED')} cancelled` : null,
    n('NO_SHOW') > 0 ? `${n('NO_SHOW')} didn't come` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Today's list</span>
        <button type="button" className="panel-link" onClick={onSeeAll}>Open</button>
      </div>

      {inFlow === 0 ? (
        <p className="panel-empty">
          {rows.length === 0 ? 'No visits booked today.' : 'Every visit on today’s list is closed off.'}
        </p>
      ) : (
        <>
          <div className="flow" role="img" aria-label={segments.filter((s) => s.count > 0).map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ')}>
            {segments.filter((s) => s.count > 0).map((s) => (
              <div
                key={s.key}
                className={`flow-seg flow-${s.key.toLowerCase()}`}
                style={{ flexGrow: s.count }}
              />
            ))}
          </div>
          <ul className="flow-key">
            {segments.map((s) => (
              <li key={s.key} className={s.count === 0 ? 'is-zero' : undefined}>
                <span className={`flow-dot flow-${s.key.toLowerCase()}`} aria-hidden="true" />
                {s.count} {s.label.toLowerCase()}
              </li>
            ))}
          </ul>
        </>
      )}
      {aside && <p className="panel-aside">{aside}</p>}
    </div>
  );
}

export function Overview({
  data, attention, schedule, onGoToAttention, onGoToClinic,
}: {
  data: OverviewData;
  attention: AttentionRow[];
  schedule: Schedule;
  onGoToAttention: () => void;
  onGoToClinic: () => void;
}) {
  const p = data.patients;
  const ind = data.independentChecks;

  return (
    <div className="screen">
      <h1 className="screen-title">Overview</h1>
      <p className="screen-sub">How the clinic is running today.</p>

      <Health health={data.health} />

      {/* Two numbers, not four. "Ready today" and "Open problems" both moved
          into the health block above — the same figure stated twice in two
          shapes on one screen makes a reader check which one is right instead
          of acting on either. What survives is what the block does not say. */}
      <div className="stats">
        <Stat
          label="Patients"
          value={`${p.seen}/${p.expected}`}
          sub={p.waiting > 0 ? `${p.waiting} waiting now` : 'Nobody waiting'}
          tone={p.waiting > 1 ? 'warn' : undefined}
        />
        <Stat
          label="Independent checks"
          value={ind.percent === null ? '—' : `${ind.percent}%`}
          sub={ind.total === 0 ? 'Nothing confirmed yet' : `${ind.independent} of ${ind.total} by someone else`}
          tone={ind.percent === null ? undefined : ind.percent >= 80 ? 'good' : 'warn'}
        />
      </div>

      <div className="panels">
        <NeedsYou items={attention} onSeeAll={onGoToAttention} />
        <DayFlow schedule={schedule} onSeeAll={onGoToClinic} />
      </div>

      <WeekBars week={data.week} />
    </div>
  );
}
