/**
 * Now — the clinic, on one screen, whatever your role.
 *
 * The owner: *"Do not create a separate screen for every flow. The user should
 * experience one clinic, not seven software modules."*
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this file is allowed to do
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Render `decisions()` and post events. That is the entire contract, and it is
 * why this file is short. It contains:
 *
 *   · no workflow — it never computes what comes next
 *   · no ownership — it never decides who does something
 *   · no governance — it never checks a requirement
 *   · no ordering — the list arrives in the order the engine chose
 *
 * Every one of those would be a second implementation of a rule that already
 * exists on the server, and the second one is the one that goes wrong. If you
 * find yourself needing an `if` here about clinical process, the engine is
 * missing something — fix it there.
 *
 * The drift test, from §2.3: a control here must name a **past-tense event**.
 * The moment a button says "next", "advance" or "assign", this screen has
 * become a workflow navigator and the whole architecture has been wasted.
 */
import { useEffect, useState } from 'react';
import { api, type EngineDecision } from '../api.js';
import {
  Screen, Title, Answer, Group, Row, Tag, Empty, Notice, Action, Facts, Fact,
  useLoad, Loading, Unavailable, toneOf,
} from '../ui.js';

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const person = (r: string) => r.replace(/_/g, ' ').toLowerCase();

/** Verdict → the vocabulary's tone. The engine decides; this only paints. */
const TONE: Record<string, 'calm' | 'good' | 'warn' | 'stop'> = {
  PROCEED: 'good', WAIT: 'calm', ESCALATE: 'warn', BLOCKED: 'stop',
};

/**
 * What the button says.
 *
 * Derived from the event the decision closes, so the label is always the name
 * of something that happened in the clinic. There is no table of nice words
 * here on purpose: a lookup would let somebody write "Continue" for an event
 * called PATIENT_SEATED, and then the screen and the log would disagree about
 * what the person did.
 */
function actionWord(completedBy: string): string {
  const t = completedBy.replace(/_/g, ' ').toLowerCase();
  return `Record: ${t}`;
}

export function Now() {
  const { data: mine, failed: f1, reload: r1 } = useLoad(() => api.now(), []);
  const { data: all, failed: f2, reload: r2 } = useLoad(() => api.clinic(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ because: string; fix: string } | null>(null);

  // The clock runs whether or not anybody is looking. Work goes late and
  // escalates on its own, so the screen re-reads rather than waiting to be
  // told — that is §8.2, and it is half the system.
  useEffect(() => {
    const t = setInterval(() => { r1(); r2(); }, 30_000);
    return () => clearInterval(t);
  }, [r1, r2]);

  if (f1 || f2) return <Unavailable what="the clinic" />;
  if (!mine || !all) return <Loading />;

  async function did(d: EngineDecision) {
    setBusy(d.id);
    setRefusal(null);
    try {
      // One key per decision per attempt: a double tap on a slow connection
      // records one arrival, not two.
      const key = `${d.flowId}:${d.node}:${d.completedBy}`;
      const res = await api.recordEvent(d.completedBy, d.subjectId, key, d.subjectLabel);
      if (!res.ok) setRefusal(res.refusal);
      r1(); r2();
    } finally {
      setBusy(null);
    }
  }

  const first = mine.mine[0] ?? null;

  return (
    <Screen wide>
      <Title question="What does the clinic need from me now?">
        {person(mine.role)} · {hhmm(mine.now)}
      </Title>

      {/* The one answer. Chosen by the engine's ordering, never by this file. */}
      {first ? (
        <Answer
          verdict={first.question}
          why={first.verdict === 'BLOCKED' ? (first.because ?? first.why) : first.why}
          tone={TONE[first.verdict] ?? 'calm'}
          {...(first.verdict !== 'BLOCKED'
            ? {
              action: {
                label: actionWord(first.completedBy),
                onClick: () => void did(first),
                busy: busy === first.id,
              },
            }
            : {})}
        />
      ) : (
        <Answer
          verdict="Nothing is waiting on you"
          why="Every decision you hold has been made."
          tone="calm"
        />
      )}

      {refusal && (
        <Notice tone="stop" title="Cannot do this yet">
          {refusal.because}. <b>{refusal.fix}</b>
        </Notice>
      )}

      <Facts>
        <Fact value={mine.mine.length} label="on you" />
        <Fact value={all.late.length} label="late in the clinic" {...(all.late.length ? { tone: 'warn' as const } : {})} />
        <Fact value={all.flows.length} label="running" />
        <Fact value={all.eventCount} label="recorded today" />
      </Facts>

      {/* Everything else this person holds, in the engine's order. */}
      <Group title="Also on you" count={Math.max(0, mine.mine.length - 1)}>
        {mine.mine.length <= 1
          ? <Empty>Nothing else.</Empty>
          : mine.mine.slice(1).map((d) => (
            <Decision key={d.id} d={d} busy={busy === d.id} onDid={() => void did(d)} />
          ))}
      </Group>

      {mine.escalated.length > 0 && (
        <Group
          title="Escalated to you"
          count={mine.escalated.length}
          note="Still owned by the person holding it. You have been told, not given it."
          tone="warn"
        >
          {mine.escalated.map((a) => (
            <Row
              key={a.flowId + a.node}
              title={a.message}
              note={`with the ${person(a.owner)} · ${a.minutesLate} min over`}
              tone="warn"
            />
          ))}
        </Group>
      )}

      {/* The live board. Lanes are the patient flow's own nodes, so the board
          and the workflow cannot drift apart. */}
      <Group title="Patients, right now" count={all.board.reduce((n, l) => n + l.patients.length, 0)}>
        {all.board.every((l) => l.patients.length === 0)
          ? <Empty>Nobody is in the building.</Empty>
          : all.board.filter((l) => l.patients.length > 0).map((lane) => (
            <Row
              key={lane.node}
              title={lane.label}
              note={lane.patients.map((p) => `${p.subjectLabel} (${p.minutesHeld}m)`).join(' · ')}
              {...(lane.patients.some((p) => p.minutesLate > 0) ? { tone: 'warn' as const } : {})}
              tags={<Tag>{person(lane.owner)}</Tag>}
            />
          ))}
      </Group>
    </Screen>
  );
}

function Decision({ d, busy, onDid }: { d: EngineDecision; busy: boolean; onDid: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Row
        title={d.question}
        note={d.verdict === 'BLOCKED' ? (d.because ?? '') : d.ifIgnored}
        {...(TONE[d.verdict] && TONE[d.verdict] !== 'good'
          ? { tone: TONE[d.verdict]! }
          : {})}
        tags={(
          <>
            <Tag tone={toneOf(TONE[d.verdict] ?? 'calm')}>{d.verdict.toLowerCase()}</Tag>
            {d.lateBy > 0 && <Tag tone="warn">{d.lateBy} min over</Tag>}
          </>
        )}
        onOpen={() => setOpen(!open)}
      />
      {open && (
        <div style={{ padding: '0 0 14px 18px' }}>
          {/* Decision quality, §13.4. Four answers, always — the difference
              between a system that instructs and one you can argue with. */}
          <p className="screen-sub" style={{ margin: '0 0 8px' }}>
            {d.why} {d.ifIgnored}
          </p>
          <p className="screen-sub" style={{ margin: '0 0 12px', fontSize: 13 }}>
            {d.protocol} · from {d.evidence.length} recorded event{d.evidence.length === 1 ? '' : 's'}
          </p>
          {d.verdict === 'BLOCKED'
            ? <Notice tone="stop" title="Cannot do this yet">{d.because}. <b>{d.fix}</b></Notice>
            : <Action onClick={onDid} busy={busy}>{actionWord(d.completedBy)}</Action>}
        </div>
      )}
    </>
  );
}
