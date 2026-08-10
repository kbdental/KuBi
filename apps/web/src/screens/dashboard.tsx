import { useCallback, useEffect, useState } from 'react';
import { api, type ClinicView } from '../api.js';

/**
 * DASHBOARD — where the clinic is, before what any one person owes.
 *
 * The design principle, in one screen: *"Every screen should reinforce where
 * the clinic is in its day, not just what an individual needs to click next."*
 * So the headline is the clinic's state and the list underneath is the work,
 * worst first — never a grid of tiles whose numbers a person has to interpret.
 *
 * Everything here is calculated by the engine. This file decides only which
 * sentence to show, never what is true.
 */

const hhmm = (m: number | null | undefined): string =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function Dashboard({ go }: { go: (id: string) => void }) {
  const [view, setView] = useState<ClinicView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.clinic());
      setProblem(null);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not read the clinic.');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (!view) {
    return <div className="screen">{problem
      ? <div className="notice notice-stop" role="alert">{problem}</div>
      : <p className="screen-sub">Reading the clinic…</p>}</div>;
  }

  const { readiness: r, closing: c, decisions } = view;
  const late = decisions.filter((d) => d.lateBy > 0);
  const blocked = decisions.filter((d) => d.verdict === 'BLOCKED');

  // What the clinic is, said once. Deliberately a single sentence rather than
  // four tiles: a person walking in should not have to assemble the state of
  // their own clinic out of numbers.
  const headline =
    r.unconfigured.length > 0 ? 'The clinic is not set up yet'
      : !view.unlocked ? 'The clinic has not been unlocked'
        : !r.ready ? `${r.outstanding.length} thing${r.outstanding.length === 1 ? '' : 's'} before the clinic can open`
        : c.clear ? 'The day is closed down'
          : c.closingNow ? `${c.outstanding.length} thing${c.outstanding.length === 1 ? '' : 's'} before the team can leave`
            : blocked.length > 0 ? `${blocked.length} blocked, and ${late.length} late`
              : late.length > 0 ? `${late.length} thing${late.length === 1 ? '' : 's'} running late`
                : 'The clinic is running to plan';

  const tone = r.unconfigured.length > 0 || blocked.length > 0 || r.overdue || c.runningLate
    ? 'is-bad'
    : (!view.unlocked || !r.ready || late.length > 0) ? 'is-warn' : 'is-good';

  return (
    <div className="screen screen-wide">
      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      <div className="dash-kicker">THE CLINIC, NOW</div>
      <h2 className={`dash-headline ${tone}`}>{headline}</h2>
      <p className="dash-sub">
        {hhmm(view.now)}
        {r.targetAt !== null && ` · first patient ${hhmm(r.targetAt)}`}
        {c.shutAt !== null && ` · shuts ${hhmm(c.shutAt)}`}
      </p>

      <div className="dash-cards">
        <StateCard
          title="Opening"
          state={r.unconfigured.length > 0 ? 'Not set up'
            : r.ready ? 'Ready' : `${r.outstanding.length} left`}
          detail={r.ready && r.readyAt !== null
            ? `Ready at ${hhmm(r.readyAt)}`
            : r.startBy !== null ? `Start by ${hhmm(r.startBy)}` : 'No first patient booked'}
          percent={Math.round(r.compliance * 100)}
          tone={r.ready ? 'good' : r.overdue ? 'bad' : 'warn'}
          onOpen={() => go('READINESS')}
        />
        <StateCard
          title="Closing"
          state={c.clear ? 'Closed down' : `${c.outstanding.length} left`}
          detail={c.clear && c.closedAt !== null
            ? `Out at ${hhmm(c.closedAt)}`
            : c.expectedCloseAt !== null ? `Out by ${hhmm(c.expectedCloseAt)}` : 'No shut time set'}
          percent={Math.round(c.compliance * 100)}
          tone={c.clear ? 'good' : c.runningLate ? 'bad' : 'warn'}
          onOpen={() => go('CLOSING')}
        />
      </div>

      <h3 className="dash-section">What needs doing — most serious first</h3>
      {decisions.length === 0 ? (
        <div className="empty">
          {/* An empty list means two opposite things, and saying the wrong one
              is a small daily lie about the state of the clinic. */}
          <div className="empty-big">
            {view.unlocked ? 'Nothing outstanding' : 'The day has not started'}
          </div>
          <div>
            {view.unlocked
              ? 'Every open piece of work has been done.'
              : 'Reception unlocks the clinic, and the morning appears here.'}
          </div>
        </div>
      ) : (
        <div className="dash-list">
          {decisions.slice(0, 12).map((d) => (
            <div key={d.id} className="dash-row">
              <span className={`tag ${
                d.verdict === 'BLOCKED' ? 'tag-stop'
                  : d.verdict === 'ESCALATE' ? 'tag-warn'
                    : 'tag-calm'
              }`}>
                {d.verdict === 'BLOCKED' ? 'Blocked'
                  : d.verdict === 'ESCALATE' ? 'Late' : 'To do'}
              </span>
              <div className="dash-row-body">
                <div className="dash-row-title">{d.question}</div>
                <div className="dash-row-meta">
                  {who(d.owner)}
                  {d.lateBy > 0 ? ` · ${d.lateBy} min over` : ''}
                  {d.because ? ` · ${d.because}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StateCard({
  title, state, detail, percent, tone, onOpen,
}: {
  title: string;
  state: string;
  detail: string;
  percent: number;
  tone: 'good' | 'warn' | 'bad';
  onOpen: () => void;
}) {
  const toneClass = tone === 'good' ? 'is-good' : tone === 'warn' ? 'is-warn' : 'is-bad';
  return (
    <button className={`state-card ${toneClass}`} type="button" onClick={onOpen}>
      <div className="state-card-title">{title}</div>
      <div className="state-card-state">{state}</div>
      <div className="state-card-detail">{detail}</div>
      <div className="state-card-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </button>
  );
}

const who = (role: string) =>
  role.replace(/_/g, ' ').toLowerCase().replace(/^./, (ch) => ch.toUpperCase());
