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
 *
 * Every shape on this screen now comes from ui.tsx. It used to own eleven
 * class names of its own, four of which were second copies of something the
 * patient record had already built differently.
 */
import { useEffect, useState } from 'react';
import { api, type Briefing as Data, type BriefingItem } from '../api.js';
import {
  Screen, Title, Answer, Group, Row, Tag, Fact, Facts, Empty, Action,
  Loading, Failed, toneOf,
} from '../ui.js';

/**
 * Why each item exists, in one word.
 *
 * Until now every real item was RECURRING, and the other four object types
 * lived only on demonstration screens — so "not everything is a checklist" was
 * true of the architecture and invisible in anybody's actual day. A person
 * looking at their list should be able to see that this line came from a
 * clinical event and that one is a gate refusing to let a procedure start.
 *
 * They all carry the same quiet tone on purpose. Origin is not severity, and
 * colouring GATE red would say a gate is worse than a missed patient event.
 * Severity is the row's stripe; this is only which engine spoke.
 */
const ORIGIN: Record<string, string> = {
  RECURRING: 'Scheduled',
  PATIENT_EVENT: 'Patient event',
  CONDITION: 'Condition',
  GATE: 'Gate',
  EXCEPTION: 'Overdue',
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

  if (failed) return <Failed what="That didn’t load. Pull down to try again." />;
  if (!data) return <Loading />;

  return (
    <Screen wide>
      {/* The question this screen answers, said out loud. Constitution rule 8. */}
      <Title question={data.question}>{data.roleLabel}</Title>

      {/* The answer, before any of the detail that explains it. Every screen
          used to open at level 2 — six sections of equal weight and nothing
          telling the eye where to go first. */}
      <Answer
        verdict={data.headline.verdict}
        why={data.headline.why}
        tone={toneOf(data.headline.tone, 'good')}
        {...(data.headline.action
          ? {
            action: {
              label: 'Take me to it',
              onClick: () => document.getElementById(`bf-${data.headline.action}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
            },
          }
          : {})}
      />

      {/* A real fraction of a real denominator, or nothing. Never a score. */}
      {data.work && data.work.total > 0 && (
        <Facts>
          <Fact value={`${data.work.done} of ${data.work.total}`} label="done so far" />
        </Facts>
      )}

      {data.sections.map((s) => (
        <Group
          key={s.key}
          id={`bf-${s.key}`}
          title={s.label}
          count={s.items.length}
          tone={toneOf(s.tone, 'good')}
          {...(s.hint ? { note: s.hint } : {})}
        >
          {s.items.length === 0
            ? <Empty>{s.emptyText}</Empty>
            : s.items.map((i) => <Line key={i.id} item={i} onOpenTask={onOpenTask} />)}
        </Group>
      ))}

      {onRefresh && <Action quiet onClick={onRefresh}>Refresh</Action>}
    </Screen>
  );
}

function Line({
  item, onOpenTask,
}: {
  item: BriefingItem;
  onOpenTask: (taskId: string) => void;
}) {
  const origin = ORIGIN[item.origin];
  const tags = (
    <>
      {/* Every task traces to a standard. Constitution rule 5, on screen. */}
      {item.activityCode && <Tag mono>{item.activityCode}</Tag>}
      {origin && <Tag>{origin}</Tag>}
    </>
  );

  // Blocked work is shown as blocked, with what it is waiting for. Not hidden,
  // and not offered as a button that fails on submit.
  if (item.blockedBy) {
    return <Row title={item.text} blockedBy={item.blockedBy} tags={tags} />;
  }

  // A fact is not a button. It carries the tone it was given, because "three
  // batches unfinished" is a different colour of true from "all sterile".
  if (item.kind === 'fact') {
    return (
      <Row
        title={item.text}
        {...(item.detail ? { note: item.detail } : {})}
        {...(item.tone ? { tone: toneOf(item.tone) } : {})}
        tags={tags}
      />
    );
  }

  return (
    <Row
      title={item.text}
      {...(item.detail ? { note: item.detail } : {})}
      {...(item.priority ? { tone: toneOf(item.priority) } : {})}
      tags={tags}
      onOpen={() => item.taskId && onOpenTask(item.taskId)}
    />
  );
}
