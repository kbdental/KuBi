import type { MyDay, BucketName, TaskRow } from '../api.js';

/**
 * TODAY — the screen a person lands on, and usually the only one they need.
 *
 * The whole point is that opening the clinic costs zero navigation: the work
 * is simply here, in the order it matters. Sections are named the way someone
 * would say them out loud, not after the buckets underneath.
 */

const SECTIONS: Array<{ key: BucketName; label: string }> = [
  { key: 'OVERDUE', label: 'Running late' },
  { key: 'NOW', label: 'Now' },
  { key: 'NEXT', label: 'Next' },
  { key: 'LATER', label: 'Later today' },
];

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function Today({
  day, onOpenTask,
}: {
  day: MyDay;
  onOpenTask: (id: string) => void;
}) {
  const total = SECTIONS.reduce((n, s) => n + day.buckets[s.key].length, 0);

  // No first-name greeting. Splitting a display name on a space to find the
  // "first" name is wrong for a great many people, and this screen is read by
  // whoever the clinic hires -- not by a naming convention we picked.
  return (
    <div className="screen">
      <h1 className="screen-title">Today</h1>
      {/* When there is nothing, the empty state below says so. Saying it twice
          in two different ways reads as a system repeating itself. */}
      {total > 0 && (
        <p className="screen-sub">
          {total} {total === 1 ? 'thing' : 'things'} for you.
        </p>
      )}

      {/* Usability review: a lightweight confirmation once opening is done.
          `opening` is null when there is no opening set today — a non-working
          day, or before the day's tasks exist. Absent is not complete, and
          must never be shown as "the clinic is open". */}
      {day.opening?.complete && (
        <div className="notice notice-good" role="status">
          <div className="notice-title">The clinic is open</div>
          Everything for this morning is done and confirmed.
        </div>
      )}

      {total === 0 && (
        <div className="empty">
          <div className="empty-big">You&rsquo;re all clear</div>
          <div>Anything new will appear here on its own.</div>
        </div>
      )}

      {SECTIONS.map(({ key, label }) => {
        const rows = day.buckets[key];
        if (rows.length === 0) return null;
        return (
          <section className="group" key={key}>
            <div className="group-label">{label}</div>
            {rows.map((t) => (
              <TaskButton key={t.id} task={t} onOpen={() => onOpenTask(t.id)} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function TaskButton({ task, onOpen }: { task: TaskRow; onOpen: () => void }) {
  const classes = ['row'];
  if (task.blockedBy) classes.push('is-blocked');
  else if (task.status === 'OVERDUE') classes.push('is-overdue');

  // One line of context, and only when it earns its place.
  const note = task.blockedBy
    ? `Waiting on: ${task.blockedBy}`
    : task.started
      ? 'You started this'
      : `By ${time(task.dueAt)}`;

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
