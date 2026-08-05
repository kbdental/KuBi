/**
 * The Clinic Manager's command centre.
 *
 * Answers six questions and nothing else:
 *
 *   1. Is my clinic ready?          — about 40% of the screen, one card
 *   2. What needs me NOW?           — at most five cards, never a list
 *   3. Today's work                 — a ring, not a percentage
 *   4. Today's patients             — counts, not graphs
 *   5. Team status                  — one light each
 *   6. Clinic health                — traffic lights, not RAG percentages
 *
 * What it deliberately does NOT contain, because the owner asked for them to
 * go and was right: bar charts, trend charts, sparklines, tiny KPI cards,
 * percentages everywhere, a long parameter list, and "92%". Nobody acts on
 * those. A number that only tells you how you are doing is a reporting
 * feature; this screen exists to tell somebody what to do about today.
 *
 * The one percentage kept is the work ring, and only because it is a genuine
 * fraction of a real denominator — 112 of 147 things done — rather than a
 * score somebody computed.
 *
 * ---
 *
 * Where KuBi does not know something, it says so instead of showing green.
 * Attendance has no check-in module, so every team light is AMBER with the
 * reason attached rather than a reassuring row of green dots. A dashboard that
 * guesses is worse than one that admits a gap, because the guess is invisible.
 */
import { useLoad, Unavailable, Loading } from '../ui.js';

import { api, type CommandCentre } from '../api';

const LIGHT: Record<string, string> = { GREEN: 'lt-green', AMBER: 'lt-amber', RED: 'lt-red' };

export function CommandCentre({
  onOpenAttention, onOpenClinic, onOpenOperations,
}: {
  onOpenAttention?: () => void;
  onOpenClinic?: () => void;
  onOpenOperations?: () => void;
}) {
  const { data: cc, failed } = useLoad<CommandCentre>(() => api.commandCentre());

  if (failed) return <Unavailable what="Command centre needs the owner and scoreboard reads, which this server does not serve yet." />;
  if (!cc) return <Loading />;

  const r = cc.readiness;

  return (
    <div className="screen screen-wide cc">

      {/* 1 — Is my clinic ready? The largest thing on the page by a wide
          margin, because it is the only question that has to be answered
          before anything else matters. */}
      <section className={`cc-ready ${cc.ready ? 'cc-ready-yes' : 'cc-ready-no'}`}>
        <div className="cc-ready-main">
          <div className="cc-verdict">
            <span className="cc-dot" aria-hidden="true" />
            {cc.ready ? 'CLINIC READY' : 'CLINIC NOT READY'}
          </div>

          {!cc.ready && (
            <>
              <p className="cc-blockers">
                {cc.blockers.length} {cc.blockers.length === 1 ? 'item' : 'items'} stopping work
              </p>
              <ul className="cc-blocker-list">
                {cc.blockers.map((b) => <li key={b.id}>{b.label}</li>)}
              </ul>
              {/* One click, as asked. */}
              <button className="btn cc-open" type="button" onClick={onOpenOperations}>
                Open now
              </button>
            </>
          )}
        </div>

        <dl className="cc-facts">
          <Fact k="Opening" v={r.opening} />
          <Fact k="Rooms" v={r.rooms} />
          <Fact k="Sterilization" v={r.sterilization} />
          <Fact k="Doctors" v={r.doctors} />
          <Fact k="Reception" v={r.reception} />
          <Fact k="Today’s patients" v={String(r.patientsToday)} />
          <Fact
            k="First patient"
            v={r.firstPatientInMinutes === null
              ? null
              : r.firstPatientInMinutes <= 0 ? 'now' : `in ${r.firstPatientInMinutes} min`}
          />
        </dl>
      </section>

      {/* 2 — What needs me now. Cards, capped at five. */}
      <h2 className="cc-head">Needs you now</h2>
      {cc.cards.length === 0 ? (
        <div className="empty"><div className="empty-big">Nothing right now</div></div>
      ) : (
        <div className="cc-cards">
          {cc.cards.map((c) => (
            <button key={c.id} className={`cc-card cc-${c.severity.toLowerCase()}`} type="button"
              onClick={onOpenAttention}>
              {c.headline}
            </button>
          ))}
        </div>
      )}

      <div className="cc-split">
        {/* 3 — Today's work. A ring, because a fraction of real work done is
            something you can look at once and understand. */}
        <section className="cc-panel">
          <h2 className="cc-head">Today’s work</h2>
          <div className="cc-ring-row">
            <Ring done={cc.work.done} total={cc.work.total} />
            <dl className="cc-counts">
              <div><dt>Tasks</dt><dd>{cc.work.total}</dd></div>
              <div><dt>Done</dt><dd>{cc.work.done}</dd></div>
              <div><dt>Running</dt><dd>{cc.work.running}</dd></div>
              <div><dt>Pending</dt><dd>{cc.work.pending}</dd></div>
            </dl>
          </div>
        </section>

        {/* 4 — Today's patients. */}
        <section className="cc-panel">
          <h2 className="cc-head">Today’s patients</h2>
          <dl className="cc-counts cc-counts-wide">
            <div><dd>{cc.patients.appointments}</dd><dt>Appointments</dt></div>
            <div><dd>{cc.patients.waiting}</dd><dt>Waiting</dt></div>
            <div><dd>{cc.patients.inChair}</dd><dt>In chair</dt></div>
            <div><dd>{cc.patients.surgery}</dd><dt>Surgery</dt></div>
            <div><dd>{cc.patients.followupsDue}</dd><dt>Follow-ups due</dt></div>
          </dl>
          <button className="btn btn-quiet" type="button" onClick={onOpenClinic}>
            Open patient board
          </button>
        </section>
      </div>

      <div className="cc-split">
        {/* 5 — Team. One light each. */}
        <section className="cc-panel">
          <h2 className="cc-head">Team</h2>
          <ul className="cc-lights">
            {cc.team.map((t) => (
              <li key={t.name} title={t.note ?? undefined}>
                <span className={`lt ${LIGHT[t.light] ?? 'lt-amber'}`} aria-hidden="true" />
                <span className="lt-name">{t.name}</span>
                <span className="lt-role">{t.role}</span>
              </li>
            ))}
          </ul>
          {/* Said once, plainly, rather than implied by a row of amber dots. */}
          {cc.team.some((t) => t.note) && (
            <p className="cc-note">Attendance is not recorded yet — no check-in module.</p>
          )}
        </section>

        {/* 6 — Clinic health. Traffic lights, no percentages. */}
        <section className="cc-panel">
          <h2 className="cc-head">Clinic health</h2>
          <ul className="cc-lights">
            {cc.health.map((h) => (
              <li key={h.name}>
                <span className={`lt ${LIGHT[h.light] ?? 'lt-amber'}`} aria-hidden="true" />
                <span className="lt-name">{h.name}</span>
              </li>
            ))}
          </ul>
          <button className="btn btn-quiet" type="button" onClick={onOpenOperations}>
            Open details
          </button>
        </section>
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="cc-fact">
      <dt>{k}</dt>
      {/* Not known is said, never drawn as a tick. */}
      <dd className={v === null ? 'cc-unknown' : ''}>{v ?? 'not recorded'}</dd>
    </div>
  );
}

/**
 * The work ring.
 *
 * Drawn rather than charted: one arc, no axis, no legend, no library. It reads
 * at a glance from across a room, which is the only thing a manager walking
 * past a screen needs from it.
 */
function Ring({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : done / total;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg className="cc-ring" viewBox="0 0 128 128" role="img"
      aria-label={`${done} of ${total} done`}>
      <circle cx="64" cy="64" r={r} className="cc-ring-track" />
      <circle
        cx="64" cy="64" r={r}
        className="cc-ring-value"
        strokeDasharray={`${(c * pct).toFixed(1)} ${c.toFixed(1)}`}
        transform="rotate(-90 64 64)"
      />
      <text x="64" y="60" className="cc-ring-n">{done}</text>
      <text x="64" y="82" className="cc-ring-of">of {total}</text>
    </svg>
  );
}
