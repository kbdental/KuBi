import { useState } from 'react';
import { api, type AttentionRow } from '../api.js';
import { IconGo } from '../icons.js';
import { Notifications } from './notifications.js';
import { Exceptions } from './exceptions.js';

/**
 * ATTENTION — the things that need a person, worst first.
 *
 * Every row answers the five questions somebody actually has: what happened,
 * how serious is it, is it mine, what do I do, and by when. If a row can't
 * answer them it shouldn't be a row.
 *
 * "Mine" is a hint for reading the list, not a permission. Whether this person
 * may resolve an item is the server's decision, and it makes it when they try.
 */

/**
 * Usability review Q4. "Urgent" and "Important" were too close to argue about
 * at 9am — both sound like "soon". These say what is being asked of you
 * instead: act now, or look at it today.
 */
const SEVERITY: Record<string, { label: string; className: string }> = {
  PATIENT_SAFETY: { label: 'Patient Safety', className: 'pill pill-safety' },
  CRITICAL: { label: 'Needs Immediate Action', className: 'pill pill-critical' },
  IMPORTANT: { label: 'Needs Attention', className: 'pill pill-important' },
  ROUTINE: { label: 'Routine', className: 'pill pill-routine' },
};

function due(iso: string | null): string {
  if (!iso) return '';
  const at = new Date(iso);
  const mins = Math.round((at.getTime() - Date.now()) / 60000);
  if (mins < -60) return `Overdue by ${Math.round(-mins / 60)}h`;
  if (mins < 0) return `Overdue by ${-mins} min`;
  if (mins < 60) return `Needed within ${mins} min`;
  return `By ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function Attention({
  items, onResolved, onOpenTask,
}: {
  items: AttentionRow[];
  onResolved: () => void;
  onOpenTask?: ((instanceId: string) => void) | undefined;
}) {
  const [open, setOpen] = useState<AttentionRow | null>(null);
  // Attention is "what must be resolved"; notifications are "what somebody
  // must be told". One question, two views — not two destinations.
  const [view, setView] = useState<'ATTENTION' | 'OVERDUE' | 'NOTIFICATIONS'>('ATTENTION');

  if (open) {
    return <Resolve item={open} onCancel={() => setOpen(null)} onResolved={onResolved} />;
  }

  return (
    <div className="screen">
      <h1 className="screen-title">Attention</h1>

      <div className="std-switch">
        <button
          className={`std-tab ${view === 'ATTENTION' ? 'is-on' : ''}`}
          type="button"
          onClick={() => setView('ATTENTION')}
        >
          To resolve
        </button>
        <button
          className={`std-tab ${view === 'OVERDUE' ? 'is-on' : ''}`}
          type="button"
          onClick={() => setView('OVERDUE')}
        >
          Not happening
        </button>
        <button
          className={`std-tab ${view === 'NOTIFICATIONS' ? 'is-on' : ''}`}
          type="button"
          onClick={() => setView('NOTIFICATIONS')}
        >
          Notifications
        </button>
      </div>

      {view === 'NOTIFICATIONS' && <Notifications />}
      {view === 'OVERDUE' && <Exceptions embedded />}

      {view === 'ATTENTION' && <>
      <p className="screen-sub">
        {items.length === 0 ? 'Nothing needs you right now.' : 'Most serious first.'}
      </p>

      {items.length === 0 && (
        <div className="empty">
          <div className="empty-big">All clear</div>
          <div>Anything that needs a person will show up here.</div>
        </div>
      )}

      {items.map((item) => {
        const sev = SEVERITY[item.severity] ?? SEVERITY.ROUTINE!;
          // Some items are a decision to make on a task, not a note to close.
          // Sending those to a "what did you do?" box would be a dead end.
          const goesToTask = item.needsAuthorisation && item.instanceId && onOpenTask;
          return (
          <button
            key={item.id}
            className="row"
            type="button"
            onClick={() => (goesToTask ? onOpenTask(item.instanceId!) : setOpen(item))}
          >
            <div className="row-main">
              <div style={{ marginBottom: 6 }}>
                <span className={sev.className}>{sev.label}</span>
                {item.mine && (
                  <span className="pill pill-routine" style={{ marginLeft: 6 }}>Yours</span>
                )}
                {item.escalated && (
                  <span className="pill pill-important" style={{ marginLeft: 6 }}>Passed up</span>
                )}
              </div>
              <div className="row-title">{item.headline}</div>
              <div className="row-note">
                {goesToTask ? 'Open it to decide' : due(item.dueAt)}
              </div>
            </div>
            <span className="row-go"><IconGo /></span>
          </button>
          );
      })}
      </>}
    </div>
  );
}

/** Closing something requires saying what was done. That note is the record. */
function Resolve({
  item, onCancel, onResolved,
}: {
  item: AttentionRow;
  onCancel: () => void;
  onResolved: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sev = SEVERITY[item.severity] ?? SEVERITY.ROUTINE!;

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      await api.resolveAttention(item.id, note.trim());
      onResolved();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not go through. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <button className="back" onClick={onCancel} type="button">‹ Attention</button>
      <span className={sev.className}>{sev.label}</span>
      <h1 className="screen-title" style={{ marginTop: 10 }}>{item.headline}</h1>
      {item.detail && <p className="screen-sub">{item.detail}</p>}
      {item.dueAt && <div className="notice notice-calm">{due(item.dueAt)}</div>}

      {problem && <div className="notice notice-stop" role="alert">{problem}</div>}

      <label className="field-label" htmlFor="what-was-done">What did you do?</label>
      <textarea
        id="what-was-done"
        className="field"
        placeholder="A sentence is enough."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <button
        className="btn"
        type="button"
        disabled={busy || note.trim().length === 0}
        onClick={() => void submit()}
      >
        {busy ? 'Saving…' : 'Mark as sorted'}
      </button>
      <button className="btn btn-quiet" type="button" onClick={onCancel}>Not yet</button>
    </div>
  );
}
