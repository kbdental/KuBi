import type { MyDay, BucketName, TaskRow } from '../api.js';
import { ClinicHeader } from './clinic-header.js';
import { CurrentTask } from './current-task.js';

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
  day, onOpenTask, onRefresh,
}: {
  day: MyDay;
  onOpenTask: (id: string) => void;
  onRefresh: () => void;
}) {
  const total = SECTIONS.reduce((n, s) => n + day.buckets[s.key].length, 0);

  // The one thing happening right now: the most urgent unfinished task. It is
  // opened here rather than being one tap away, because a morning has one
  // thing in front of you, not a menu.
  const current = [...day.buckets.OVERDUE, ...day.buckets.NOW]
    .find((t) => !t.blockedBy) ?? null;

  return (
    <div className="screen">
      {/* Where the clinic is, before what any one person has to do. */}
      {day.clinic && <ClinicHeader clinic={day.clinic} />}

      {current && (
        <CurrentTask key={current.id} taskId={current.id} onOpenFull={onOpenTask} onDone={onRefresh} />
      )}

      {/* When there is nothing, the empty state below says so. Saying it twice
          in two different ways reads as a system repeating itself. */}
      {total > 0 && (
        <p className="screen-sub">
          {total} {total === 1 ? 'thing' : 'things'} for you.
        </p>
      )}

      {/* The completion confirmation lives in the header now, where it reads
          as the clinic's state rather than as one more notice in a list. This
          line is the human half of it. `opening` is null when there is no
          opening set today — absent is never "open". */}
      {day.opening?.complete && (
        <div className="notice notice-good" role="status">
          <div className="notice-title">Opening is done</div>
          Everything for this morning is finished and confirmed.
        </div>
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
      <span className="row-go" aria-hidden="true">›</span>
    </button>
  );
}
