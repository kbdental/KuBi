import type { MyDay, BucketName, TaskRow, CheckRow } from '../api.js';
import { Checks } from './checks.js';
import { useState } from 'react';
import { ClinicHeader } from './clinic-header.js';
import { CurrentTask } from './current-task.js';
import { IconGo } from '../icons.js';

/**
 * TODAY — where the clinic is, and the thing in front of you.
 *
 * The order on this screen is the order a person actually thinks in. First
 * where am I and how is the morning going; then the one thing happening right
 * now, already open; then everything still to come. A task list on its own
 * answers the last question and none of the first.
 *
 * Sections are named the way someone would say them out loud, not after the
 * buckets underneath.
 */

const SECTIONS: Array<{ key: BucketName; label: string }> = [
  { key: 'OVERDUE', label: 'Running late' },
  { key: 'NOW', label: 'Now' },
  { key: 'NEXT', label: 'Next' },
  { key: 'LATER', label: 'Later today' },
];

/** Clinic time, not the viewer's. "By 09:00" has to mean nine at the clinic. */
function time(iso: string, timezone: string | undefined): string {
  return new Date(iso).toLocaleTimeString([], {
    ...(timezone ? { timeZone: timezone } : {}),
    hour: 'numeric', minute: '2-digit',
  });
}

export function Today({
  day, checks, onOpenTask, onRefresh, onOpenHandover, onChecked,
}: {
  day: MyDay;
  /** What this person must check for somebody else. Empty for most people. */
  checks: CheckRow[];
  onOpenTask: (id: string) => void;
  onRefresh: () => void;
  onOpenHandover: () => void;
  onChecked: () => void;
}) {
  // Doing and checking are both "my work today", so they share a destination.
  // A separate Checks tab made a person look in two places for one question,
  // and sat empty for everybody who is nobody's checker.
  const [view, setView] = useState<'MINE' | 'CHECK'>('MINE');
  const total = SECTIONS.reduce((n, s) => n + day.buckets[s.key].length, 0);

  // The one thing happening right now: the most urgent unfinished task. It is
  // opened here rather than being one tap away, because a morning has one
  // thing in front of you, not a menu.
  const current = [...day.buckets.OVERDUE, ...day.buckets.NOW]
    .find((t) => !t.blockedBy) ?? null;

  if (view === 'CHECK') {
    return (
      <div className="screen">
        {day.clinic && <ClinicHeader clinic={day.clinic} />}
        <WorkSwitch view={view} setView={setView} checks={checks.length} />
        <Checks items={checks} onDone={() => { onChecked(); setView('MINE'); }} embedded />
      </div>
    );
  }

  return (
    <div className="screen">
      {/* Where the clinic is, before what any one person has to do. */}
      {day.clinic && <ClinicHeader clinic={day.clinic} />}

      {checks.length > 0 && <WorkSwitch view={view} setView={setView} checks={checks.length} />}

      {/* The handover appears when the day is actually ending, rather than as a
          seventh tab sitting empty until 8pm. The owner asked for a small number
          of primary screens, and a screen that is meaningless for ten hours a
          day does not deserve permanent furniture. */}
      {(day.clinic?.phase === 'CLOSING' || day.clinic?.phase === 'CLOSED') && (
        <button type="button" className="handover-cue" onClick={onOpenHandover}>
          <span className="handover-cue-main">
            <span className="handover-cue-title">Read the handover</span>
            <span className="handover-cue-note">
              What tomorrow inherits. Check it before you lock up.
            </span>
          </span>
          <span className="row-go"><IconGo /></span>
        </button>
      )}

      {/* Two columns on a laptop, stacked on a phone. The thing being done
          gets the wider side; what is still to come sits alongside instead of
          being pushed below the fold on a screen with room to spare. */}
      <div className="today-columns">
        <div className="today-main">
          {current && (
            <CurrentTask
              key={current.id}
              taskId={current.id}
              onOpenFull={onOpenTask}
              onDone={onRefresh}
            />
          )}
        </div>
        <div className="today-side">

      {/* When there is nothing, the empty state below says so. Saying it twice
          in two different ways reads as a system repeating itself. */}
      {total > 0 && (
        <p className="screen-sub">
          {total} {total === 1 ? 'thing' : 'things'} for you.
        </p>
      )}

      {total === 0 && (
        <div className="empty">
          <div className="empty-big">You&rsquo;re all clear</div>
          <div>Anything new will appear here on its own.</div>
        </div>
      )}

      {SECTIONS.map(({ key, label }) => {
        const rows = day.buckets[key].filter((t) => t.id !== current?.id);
        if (rows.length === 0) return null;
        return (
          <section className="group" key={key}>
            <div className="group-label">{label}</div>
            {rows.map((t) => (
              <TaskButton
                key={t.id}
                task={t}
                timezone={day.clinic?.timezone}
                onOpen={() => onOpenTask(t.id)}
              />
            ))}
          </section>
        );
      })}
        </div>
      </div>
    </div>
  );
}

function TaskButton({
  task, timezone, onOpen,
}: {
  task: TaskRow;
  timezone: string | undefined;
  onOpen: () => void;
}) {
  const classes = ['row'];
  if (task.blockedBy) classes.push('is-blocked');
  else if (task.status === 'OVERDUE') classes.push('is-overdue');

  // One line of context, and only when it earns its place.
  const note = task.blockedBy
    ? `Waiting on: ${task.blockedBy}`
    : task.started
      ? 'You started this'
      : `By ${time(task.dueAt, timezone)}`;

  return (
    <button className={classes.join(' ')} onClick={onOpen} type="button">
      <div className="row-main">
        <div className="row-title">{task.title}</div>
        <div className="row-note">{note}</div>
      </div>
      <span className="row-go"><IconGo /></span>
    </button>
  );
}

/**
 * Mine to do, versus mine to check.
 *
 * Only appears for people who are actually somebody's checker — most staff
 * never see it, which is the point of merging rather than adding a tab.
 */
function WorkSwitch({
  view, setView, checks,
}: {
  view: 'MINE' | 'CHECK';
  setView: (v: 'MINE' | 'CHECK') => void;
  checks: number;
}) {
  return (
    <div className="std-switch">
      <button
        className={`std-tab ${view === 'MINE' ? 'is-on' : ''}`}
        type="button"
        onClick={() => setView('MINE')}
      >
        My work
      </button>
      <button
        className={`std-tab ${view === 'CHECK' ? 'is-on' : ''}`}
        type="button"
        onClick={() => setView('CHECK')}
      >
        To check {checks > 0 && <span className="bf-count">{checks}</span>}
      </button>
    </div>
  );
}
