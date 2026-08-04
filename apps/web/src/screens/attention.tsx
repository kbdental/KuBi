import { useState } from 'react';
import { api, type AttentionRow } from '../api.js';
import { Notifications } from './notifications.js';
import { Exceptions } from './exceptions.js';
import {
  Screen, Title, Answer, Row, Tag, Empty, Notice, Switch, Action, toneOf,
} from '../ui.js';

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
const SEVERITY: Record<string, string> = {
  PATIENT_SAFETY: 'Patient Safety',
  CRITICAL: 'Needs Immediate Action',
  IMPORTANT: 'Needs Attention',
  ROUTINE: 'Routine',
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

  // The worst thing on the list decides the colour of the answer. Averaging
  // severity would let four routine items outvote one patient-safety item.
  const worst = items.some((i) => i.severity === 'PATIENT_SAFETY' || i.severity === 'CRITICAL')
    ? 'stop' as const
    : items.length > 0 ? 'warn' as const : 'good' as const;

  return (
    <Screen>
      <Title>Attention</Title>

      <Switch
        value={view}
        onChange={setView}
        options={[
          { value: 'ATTENTION', label: 'To resolve', count: items.length },
          { value: 'OVERDUE', label: 'Not happening' },
          { value: 'NOTIFICATIONS', label: 'Notifications' },
        ]}
      />

      {view === 'NOTIFICATIONS' && <Notifications />}
      {view === 'OVERDUE' && <Exceptions embedded />}

      {view === 'ATTENTION' && (
        <>
          <Answer
            verdict={items.length === 0
              ? 'Nothing needs you'
              : `${items.length} ${items.length === 1 ? 'thing needs' : 'things need'} a person`}
            why={items.length === 0
              ? 'Anything that needs a person will show up here on its own.'
              : 'Most serious first.'}
            tone={worst}
          />

          {items.length === 0 && (
            <Empty big="All clear">Nothing is waiting on anybody.</Empty>
          )}

          {items.map((item) => {
            // Some items are a decision to make on a task, not a note to close.
            // Sending those to a "what did you do?" box would be a dead end.
            const goesToTask = item.needsAuthorisation && item.instanceId && onOpenTask;
            return (
              <Row
                key={item.id}
                title={item.headline}
                note={goesToTask ? 'Open it to decide' : due(item.dueAt)}
                tone={toneOf(item.severity)}
                tags={(
                  <>
                    <Tag tone={toneOf(item.severity)}>
                      {SEVERITY[item.severity] ?? 'Routine'}
                    </Tag>
                    {item.mine && <Tag>Yours</Tag>}
                    {item.escalated && <Tag tone="warn">Passed up</Tag>}
                  </>
                )}
                onOpen={() => (goesToTask ? onOpenTask(item.instanceId!) : setOpen(item))}
              />
            );
          })}
        </>
      )}
    </Screen>
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
    <Screen back={onCancel}>
      <Title {...(item.detail ? { question: item.detail } : {})}>{item.headline}</Title>

      <Answer
        verdict={SEVERITY[item.severity] ?? 'Routine'}
        {...(item.dueAt ? { why: due(item.dueAt) } : {})}
        tone={toneOf(item.severity)}
      />

      {problem && <Notice tone="stop">{problem}</Notice>}

      <label className="field-label" htmlFor="what-was-done">What did you do?</label>
      <textarea
        id="what-was-done"
        className="field"
        placeholder="A sentence is enough."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <Action busy={busy} disabled={note.trim().length === 0} onClick={() => void submit()}>
        Mark as sorted
      </Action>
      <Action quiet onClick={onCancel}>Not yet</Action>
    </Screen>
  );
}
