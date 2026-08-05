import type { MyDay, BucketName, TaskRow, CheckRow } from '../api.js';
import { Checks } from './checks.js';
import { useState } from 'react';
import { ClinicHeader } from './clinic-header.js';
import { CurrentTask } from './current-task.js';
import { Screen, Group, Row, Tag, Empty, Switch, Columns } from '../ui.js';

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

  const workSwitch = (
    <Switch
      value={view}
      onChange={setView}
      options={[
        { value: 'MINE', label: 'My work' },
        { value: 'CHECK', label: 'To check', count: checks.length },
      ]}
    />
  );

  if (view === 'CHECK') {
    return (
      <Screen>
        {day.clinic && <ClinicHeader clinic={day.clinic} />}
        {workSwitch}
        <Checks items={checks} onDone={() => { onChecked(); setView('MINE'); }} embedded />
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Where the clinic is, before what any one person has to do. */}
      {day.clinic && <ClinicHeader clinic={day.clinic} />}

      {checks.length > 0 && workSwitch}

      {/* The handover appears when the day is actually ending, rather than as a
          seventh tab sitting empty until 8pm. The owner asked for a small number
          of primary screens, and a screen that is meaningless for ten hours a
          day does not deserve permanent furniture. */}
      {(day.clinic?.phase === 'CLOSING' || day.clinic?.phase === 'CLOSED') && (
        <Row
          title="Read the handover"
          note="What tomorrow inherits. Check it before you lock up."
          onOpen={onOpenHandover}
        />
      )}

      {/* The thing being done gets the wider side; what is still to come sits
          alongside instead of being pushed below the fold on a screen with
          room to spare.

          With nothing in the chair there is no left column, so the list runs
          full width. Two columns with one of them empty pushed "You're all
          clear" over to the right of a blank screen, which read as a layout
          that had failed rather than as good news. */}
      <Body columns={current !== null}
        main={current && (
          <CurrentTask
            key={current.id}
            taskId={current.id}
            onOpenFull={onOpenTask}
            onDone={onRefresh}
          />
        )}
        side={(
          <>
            {total === 0 && (
              <Empty big="You’re all clear">Anything new will appear here on its own.</Empty>
            )}

            {SECTIONS.map(({ key, label }) => {
              const rows = day.buckets[key].filter((t) => t.id !== current?.id);
              if (rows.length === 0) return null;
              return (
                <Group key={key} title={label} count={rows.length}>
                  {rows.map((t) => (
                    <TaskLine
                      key={t.id}
                      task={t}
                      timezone={day.clinic?.timezone}
                      onOpen={() => onOpenTask(t.id)}
                    />
                  ))}
                </Group>
              );
            })}
          </>
        )}
      />
    </Screen>
  );
}

/** Two columns when there is something in the chair, one when there is not. */
function Body({
  columns, main, side,
}: {
  columns: boolean;
  main: React.ReactNode;
  side: React.ReactNode;
}) {
  if (!columns) return <>{side}</>;
  return <Columns main={main} side={side} />;
}

function TaskLine({
  task, timezone, onOpen,
}: {
  task: TaskRow;
  timezone: string | undefined;
  onOpen: () => void;
}) {
  /**
   * The trace, in two tags.
   *
   * Only the two facts that change what a person does: which control governs
   * this, and whether anybody hears if it does not happen. Everything else
   * about the standard is on the task itself — a row with six tags is a table,
   * and a table is a different screen.
   */
  const trace = task.why && (
    <>
      {task.why.covers
        ? <Tag mono>{task.why.covers}</Tag>
        : <Tag tone="warn">no control</Tag>}
      {task.why.unsupervised && <Tag tone="stop">nobody is told</Tag>}
    </>
  );

  if (task.blockedBy) {
    return <Row title={task.title} blockedBy={task.blockedBy} tags={trace} />;
  }

  // One line of context, and only when it earns its place.
  const note = task.started ? 'You started this' : `By ${time(task.dueAt, timezone)}`;

  return (
    <Row
      title={task.title}
      note={note}
      {...(task.status === 'OVERDUE' ? { tone: 'stop' as const } : {})}
      tags={trace}
      onOpen={onOpen}
    />
  );
}
