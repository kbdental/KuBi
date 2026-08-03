/**
 * The briefing.
 *
 * One component, five dashboards. Doctor, assistant, lab, sterilisation and
 * — where it helps — reception all render this; only the sections differ.
 * That is the point of the domain contract: a dashboard names the sections it
 * wants and does not own a layout.
 *
 * The idea is prototype #1's, and it is the best thing in either prototype.
 * A task list can tell somebody they have eleven things to do. It cannot tell
 * them that Mrs Rao is on warfarin, that three sterilisation batches are
 * unfinished, or that Mr Bose's crown passed its check and nobody has rung
 * him. Those are facts, not tasks — and a screen that can only render tasks
 * drops them silently, which is how a clinic ends up with a tidy checklist and
 * an unhappy patient.
 *
 * So: sections carry both. A task opens. A fact does not pretend to be a
 * button, because a control that does nothing when pressed is worse than a
 * line of text.
 */
import { useEffect, useState } from 'react';
import { api, type Briefing as Data, type BriefingItem } from '../api.js';

/** Same lookup the Attention screen uses. Not a second set of class names. */
const TONE: Record<string, string> = { GREEN: 'ok', AMBER: 'important', RED: 'critical' };
const RAIL: Record<string, string> = {
  PATIENT_SAFETY: 'pri-safety', CRITICAL: 'pri-critical',
  IMPORTANT: 'pri-important', ROUTINE: 'pri-routine',
};

export function BriefingScreen({
  onOpenTask, onRefresh,
}: {
  onOpenTask: (taskId: string) => void;
  onRefresh?: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void api.briefing().then((d) => { setData(d); setFailed(false); })
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div className="screen">
        <p className="screen-sub">That didn’t load. Pull down to try again.</p>
      </div>
    );
  }
  if (!data) return <div className="screen"><p className="screen-sub">Loading…</p></div>;

  return (
    <div className="screen screen-wide">
      <h1 className="screen-title">{data.roleLabel}</h1>
      {/* The question this screen answers, said out loud. Constitution rule 8. */}
      <p className="screen-sub">{data.question}</p>

      {/* A real fraction of a real denominator, or nothing. Never a score. */}
      {data.work && data.work.total > 0 && (
        <p className="bf-work">
          <b>{data.work.done}</b> of {data.work.total} done
        </p>
      )}

      {data.sections.map((s) => (
        <section key={s.key} className="bf-section">
          <h2 className={`bf-head bf-${TONE[s.tone] ?? 'ok'}`}>
            {s.label}
            {s.items.length > 0 && <span className="bf-count">{s.items.length}</span>}
          </h2>
          {s.hint && <p className="bf-hint">{s.hint}</p>}

          {s.items.length === 0 ? (
            <p className="bf-empty">{s.emptyText}</p>
          ) : (
            <ul className="bf-items">
              {s.items.map((i) => <Item key={i.id} item={i} onOpenTask={onOpenTask} />)}
            </ul>
          )}
        </section>
      ))}

      {onRefresh && (
        <button className="btn btn-quiet" type="button" onClick={onRefresh}>
          Refresh
        </button>
      )}
    </div>
  );
}

function Item({
  item, onOpenTask,
}: {
  item: BriefingItem;
  onOpenTask: (taskId: string) => void;
}) {
  const rail = item.priority ? RAIL[item.priority] ?? 'pri-routine' : '';

  // Blocked work is shown as blocked, with what it is waiting for. Not hidden,
  // and not offered as a button that fails on submit.
  if (item.blockedBy) {
    return (
      <li className={`bf-item bf-blocked ${rail}`}>
        <div className="bf-text">{item.text}</div>
        <div className="row-note">Waiting for {item.blockedBy}</div>
      </li>
    );
  }

  if (item.kind === 'fact') {
    return (
      <li className={`bf-item ${item.tone ? `bf-fact-${TONE[item.tone] ?? 'ok'}` : ''}`}>
        <div className="bf-text">{item.text}</div>
        {item.detail && <div className="row-note">{item.detail}</div>}
      </li>
    );
  }

  return (
    <li className={`bf-item ${rail}`}>
      <button className="bf-task" type="button" onClick={() => item.taskId && onOpenTask(item.taskId)}>
        <span className="bf-text">{item.text}</span>
        {item.detail && <span className="row-note">{item.detail}</span>}
        {/* Every task traces to a standard. Constitution rule 5, on screen. */}
        {item.activityCode && <span className="bf-code">{item.activityCode}</span>}
      </button>
    </li>
  );
}
