/**
 * The rules — conditions, gates and exceptions, on screen.
 *
 * Three libraries the owner wrote, and one question each:
 *
 *   Conditions  which of these can KuBi actually notice?
 *   Gates       what would happen if we switched them on tomorrow?
 *   Exceptions  what stops work, and who hears about it immediately?
 *
 * Every answer here is uncomfortable and every one is true. A screen that
 * showed a hundred conditions as a hundred identical rows would be claiming
 * a system that fires; sixty of them cannot fire at all, and each says why.
 *
 * Built entirely from the UI library, so it was born converted.
 */
import { useState } from 'react';
import {
  theConditions, undetectable, conditionCoverage, missingCapabilities,
  COMPLIANCE_GATES, TREATMENT_GATES, evaluateGate, gateCoverage, missingForGates,
  theExceptions, stopsWork, immediate, ESCALATION_MATRIX, unmappedRoles,
  exceptionCoverage, isImmediate, ActionKind,
  procedures, protocolOf, runProtocol, stepsFor, protocolCoverage,
  UNIVERSAL_PROTOCOL, PHASE_LABEL, PROCEDURE_PROTOCOLS, protocolNeedsOwner,
  PATIENT_JOURNEY, theJourney, needsOwner, CONDITION_LIBRARY,
  type ConditionRule, type ExceptionRule,
} from '@kubi/contracts';
import { Screen, Title, Answer, Group, Row, Tag, Switch, type Tone } from '../ui.js';

const ACTION_TONE: Record<string, Tone> = {
  BLOCK: 'stop', ESCALATE: 'warn', NOTIFY: 'calm', RAISE: 'calm',
};
const ACTION_WORD: Record<string, string> = {
  BLOCK: 'stops work', ESCALATE: 'escalates', NOTIFY: 'tells somebody', RAISE: 'raises a task',
};

export function Rules() {
  const [view, setView] = useState<'CONDITIONS' | 'GATES' | 'EXCEPTIONS' | 'PROTOCOLS' | 'UNOWNED'>('CONDITIONS');

  return (
    <Screen wide>
      <Title question="What KuBi is supposed to notice, refuse, and chase.">
        The rules
      </Title>

      <Switch
        value={view}
        onChange={setView}
        options={[
          { value: 'CONDITIONS', label: 'Conditions' },
          { value: 'GATES', label: 'Gates' },
          { value: 'EXCEPTIONS', label: 'Exceptions' },
          { value: 'PROTOCOLS', label: 'Protocols' },
          { value: 'UNOWNED', label: 'Nobody owns', count: 322 },
        ]}
      />

      {view === 'CONDITIONS' && <Conditions />}
      {view === 'GATES' && <Gates />}
      {view === 'EXCEPTIONS' && <Exceptions />}
      {view === 'PROTOCOLS' && <Protocols />}
      {view === 'UNOWNED' && <Unowned />}
    </Screen>
  );
}

/* ---- conditions --------------------------------------------------------- */

function Conditions() {
  const cov = conditionCoverage();
  const blind = undetectable().length;

  return (
    <>
      <Answer
        verdict={`${cov.canDetect} of ${cov.rules} conditions can actually fire`}
        why={`${blind} cannot be noticed at all. Not one patient-risk condition and not one `
          + `financial condition. ${cov.rules - cov.assigned} would create a task with nobody `
          + 'assigned to it.'}
        tone="warn"
      />

      {/* The roadmap, by unlock size. One capability at the top buys the most
          rules, which is a better way to choose than by group. */}
      <Group
        title="What KuBi would have to hold"
        note="Biggest unlock first. Each of these switches on the rules beneath it."
      >
        {missingCapabilities().slice(0, 8).map((m) => (
          <Row
            key={m.needs}
            title={m.needs}
            note={m.rules.map((r) => r.condition).join(' · ')}
            tone="warn"
            tags={<Tag tone="warn">{m.rules.length} rules waiting</Tag>}
          />
        ))}
      </Group>

      {theConditions().map((g) => (
        <Group key={g.group} title={`${g.letter}. ${g.label}`} count={g.rules.length}>
          {g.rules.map((r) => <Condition key={r.id} r={r} />)}
        </Group>
      ))}
    </>
  );
}

function Condition({ r }: { r: ConditionRule }) {
  return (
    <Row
      title={r.condition}
      note={r.detects ? r.task : `${r.task} — needs ${r.needs}`}
      {...(r.action === ActionKind.BLOCK
        ? { tone: 'stop' as const }
        : r.detects ? {} : { tone: 'warn' as const })}
      tags={(
        <>
          <Tag tone={ACTION_TONE[r.action] ?? 'calm'}>{ACTION_WORD[r.action] ?? r.action}</Tag>
          {r.role
            ? <Tag>{r.role.replace(/_/g, ' ').toLowerCase()}</Tag>
            : <Tag tone="warn">nobody assigned</Tag>}
          {r.due && <Tag>{r.due}</Tag>}
          {r.detects
            ? <Tag tone="good">KuBi can see this</Tag>
            : <Tag tone="warn">cannot be noticed</Tag>}
        </>
      )}
    />
  );
}

/* ---- gates -------------------------------------------------------------- */

function Gates() {
  const cov = gateCoverage();

  return (
    <>
      <Answer
        verdict="Every gate would block everything today"
        why={`${cov.requirements} requirements across ${cov.gates} gates and `
          + `${cov.treatmentGates} treatment sets. KuBi can evaluate ${cov.evaluable}. `
          + 'The rest return UNKNOWN — and UNKNOWN is never PASS, so a hard gate refuses. '
          + 'That is the gates working correctly against data that does not exist yet.'}
        tone="stop"
      />

      <Group
        title="What KuBi would have to hold"
        note="Biggest unlock first. The order a clinic would build in."
      >
        {missingForGates().slice(0, 8).map((m) => (
          <Row
            key={m.needs}
            title={m.needs}
            note={m.requirements.map((r) => r.label).join(' · ')}
            tone="warn"
            tags={<Tag tone="warn">{m.requirements.length} requirements</Tag>}
          />
        ))}
      </Group>

      {COMPLIANCE_GATES.map((g) => {
        const v = evaluateGate(g);
        return (
          <Group
            key={g.id}
            title={`Gate ${g.number} — ${g.name}`}
            count={g.requirements.length}
            note={`Blocks if: ${g.blockIf.join(' · ')}`}
            tone="stop"
          >
            {g.requirements.map((r) => (
              <Row
                key={r.id}
                title={r.label}
                {...(r.needs ? { note: `needs ${r.needs}` } : {})}
                {...(r.evaluable ? {} : { tone: 'warn' as const })}
                tags={r.evaluable
                  ? <Tag tone="good">KuBi can check this</Tag>
                  : <Tag tone="warn">unknown — refuses</Tag>}
              />
            ))}
            {v.unknown.length > 0 && (
              <Row
                title={`${v.unknown.length} of ${g.requirements.length} cannot be evaluated`}
                note="A hard gate has no override. It refuses until the data exists."
                tone="stop"
              />
            )}
          </Group>
        );
      })}

      {TREATMENT_GATES.map((t) => (
        <Group key={t.treatment} title={`${t.treatment} — extra gates`} count={t.requirements.length}>
          {t.requirements.map((r) => (
            <Row
              key={r.id}
              title={r.label}
              {...(r.needs ? { note: `needs ${r.needs}` } : {})}
              {...(r.evaluable ? {} : { tone: 'warn' as const })}
              tags={r.evaluable
                ? <Tag tone="good">KuBi can check this</Tag>
                : <Tag tone="warn">unknown — refuses</Tag>}
            />
          ))}
        </Group>
      ))}
    </>
  );
}

/* ---- exceptions --------------------------------------------------------- */

function Exceptions() {
  const cov = exceptionCoverage();

  return (
    <>
      <Answer
        verdict={`${cov.immediate} of ${cov.exceptions} exceptions cannot wait a minute`}
        why={`${cov.blocks} of them stop work rather than creating it. Three of the four `
          + 'severity levels escalate immediately — only operational gets fifteen minutes.'}
        tone="stop"
      />

      <Group
        title="The escalation matrix"
        note="Severity decides the clock, not elapsed time. Immediate means zero."
      >
        {ESCALATION_MATRIX.map((l) => (
          <Row
            key={l.level}
            title={`Level ${l.level} — ${l.label}`}
            note={l.examples}
            tone={l.level >= 3 ? 'stop' : l.level === 2 ? 'warn' : 'calm'}
            tags={(
              <>
                <Tag tone={l.withinMinutes === 0 ? 'stop' : 'warn'}>
                  {l.withinMinutes === 0 ? 'immediate' : `within ${l.withinMinutes} min`}
                </Tag>
                <Tag>{l.escalateTo}</Tag>
              </>
            )}
          />
        ))}
      </Group>

      <Group
        title="These stop work"
        count={stopsWork().length}
        note="A clinic that turns these into reminders has a to-do list, not a control system."
        tone="stop"
      >
        {stopsWork().map((e) => <Exception key={e.id} e={e} />)}
      </Group>

      {/* The decision waiting on the owner, counted rather than argued. */}
      <Group
        title="Escalation targets KuBi has no role for"
        count={unmappedRoles().length}
        note="Kept as the owner wrote them. Mapping these onto an existing role would name
              the wrong person; adding them is a decision nobody has made."
        tone="warn"
      >
        <Row title={unmappedRoles().join(' · ')} note={`${immediate().length} immediate exceptions route through these`} />
      </Group>

      {theExceptions().map((g) => (
        <Group key={g.group} title={g.label} count={g.rules.length}>
          {g.rules.map((e) => <Exception key={e.id} e={e} />)}
        </Group>
      ))}
    </>
  );
}

function Exception({ e }: { e: ExceptionRule }) {
  return (
    <Row
      title={e.exception}
      note={e.task}
      tone={e.action === ActionKind.BLOCK ? 'stop' : isImmediate(e.severity) ? 'warn' : 'calm'}
      tags={(
        <>
          <Tag tone={ACTION_TONE[e.action] ?? 'calm'}>{ACTION_WORD[e.action] ?? e.action}</Tag>
          <Tag tone={isImmediate(e.severity) ? 'stop' : 'calm'}>
            {isImmediate(e.severity) ? 'immediate' : 'within 15 min'}
          </Tag>
          <Tag>{e.escalateTo}</Tag>
          {!e.severityStated && <Tag tone="warn">severity inferred</Tag>}
        </>
      )}
    />
  );
}

/* ---- protocols ----------------------------------------------------------
 *
 * The one library that is a sequence rather than a set, so this is the one
 * view with a position on it. Pick a procedure, and the screen answers "what
 * is next" instead of listing twenty-five things that are all equally true.
 * ---------------------------------------------------------------------- */

function Protocols() {
  const [procedure, setProcedure] = useState(procedures()[0]!);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const cov = protocolCoverage();
  const run = runProtocol(procedure, done);

  const pick = (p: string) => { setProcedure(p); setDone(new Set()); };

  return (
    <>
      <Answer
        verdict={run.next ? run.next.task : `${procedure} complete`}
        why={run.next
          ? `${PHASE_LABEL[run.next.phase]} the procedure · raised by "${run.next.when}" · `
            + `step ${run.doneCount + 1} of ${run.totalCount}`
          : `All ${run.totalCount} steps recorded.`}
        tone={run.next ? 'warn' : 'good'}
        {...(run.next
          ? { action: { label: 'Record it and move on', onClick: () => setDone(new Set([...done, run.next!.id])) } }
          : {})}
      />

      {run.outOfOrder.length > 0 && (
        <Group
          title="Recorded out of sequence"
          count={run.outOfOrder.length}
          note="Not rejected — refusing is a gate's job. But a clinic working around the
                protocol is telling you something about the protocol."
          tone="warn"
        >
          {run.outOfOrder.map((s) => <Row key={s.id} title={s.task} note={`should follow "${s.when}"`} tone="warn" />)}
        </Group>
      )}

      <Group title="Pick a procedure" count={cov.procedures}>
        {procedures().map((p) => (
          <Row
            key={p}
            title={p}
            note={`${stepsFor(p).length} steps`}
            {...(p === procedure ? { tone: 'good' as const } : {})}
            onOpen={() => pick(p)}
          />
        ))}
      </Group>

      {protocolOf(procedure).map((phase) => (
        <Group key={phase.phase} title={`${phase.label} — ${procedure}`} count={phase.steps.length}>
          {phase.steps.map((s) => (
            <Row
              key={s.id}
              title={s.task}
              note={`raised by "${s.when}"`}
              {...(done.has(s.id)
                ? { tone: 'good' as const }
                : s.id === run.next?.id ? { tone: 'warn' as const } : {})}
              tags={(
                <>
                  <Tag>step {s.order}</Tag>
                  {s.role
                    ? <Tag>{s.role.replace(/_/g, ' ').toLowerCase()}</Tag>
                    : <Tag tone="warn">nobody assigned</Tag>}
                  {s.mandatory && <Tag tone="stop">mandatory</Tag>}
                  {!s.phaseStated && <Tag tone="warn">phase inferred</Tag>}
                  {done.has(s.id) && <Tag tone="good">recorded</Tag>}
                </>
              )}
              onOpen={() => setDone(new Set([...done, s.id]))}
            />
          ))}
        </Group>
      ))}

      <Group
        title="Applies to every treatment"
        count={cov.universal}
        note="Held once rather than copied into all seventeen protocols."
      >
        {UNIVERSAL_PROTOCOL.map((u) => (
          <Row key={u.id} title={u.task} note={`raised by "${u.when}"`} />
        ))}
      </Group>
    </>
  );
}

/* ---- what nobody owns ----------------------------------------------------
 *
 * The largest single thing standing between KuBi and working, in one place.
 *
 * Across the libraries, 322 rows have no owner. That is not a cosmetic gap:
 * an escalation ladder needs a doer to start from, so an unowned task raises
 * nothing when it does not happen. Every unowned row is a rule that looks
 * live and is inert.
 *
 * Deliberately read-only, with no Save button. Assignment has to persist, and
 * KuBi has no database yet — a button that appeared to save and did not would
 * be worse than no button. This screen exists to make the size and shape of
 * the decision visible so it can be made on paper today and typed in once.
 * ---------------------------------------------------------------------- */

function Unowned() {
  const journey = needsOwner();
  const conditions = CONDITION_LIBRARY.filter((r) => r.role === null);
  const steps = protocolNeedsOwner();
  const total = journey.length + conditions.length + steps.length;

  // Which roles already do this kind of work, from the rows that DO have an
  // owner. A starting point for the decision, never the decision itself.
  const knownRoles = [...new Set([
    ...PATIENT_JOURNEY.filter((p) => p.role).map((p) => p.role!),
    ...CONDITION_LIBRARY.filter((r) => r.role).map((r) => r.role!),
    ...PROCEDURE_PROTOCOLS.filter((s) => s.role).map((s) => s.role!),
  ])].map((r) => r.replace(/_/g, ' ').toLowerCase());

  return (
    <>
      <Answer
        verdict={`${total} rules have nobody assigned`}
        why="An escalation ladder needs a doer to start from. Until a rule has an owner,
             nothing happens when it does not happen — so every one of these looks live
             and is inert."
        tone="stop"
      />

      <Group
        title="Why there is no Save button here"
        note="Assignment has to persist, and KuBi has no database yet. A button that looked
              like it saved and did not would be worse than no button. Decide these on paper;
              they get typed in once, when there is somewhere to put them."
      >
        <Row
          title="Roles already used in your libraries"
          note={knownRoles.join(' · ')}
          tags={<Tag>{knownRoles.length} roles</Tag>}
        />
        <Row
          title="Escalation targets with no role in KuBi"
          note={unmappedRoles().join(' · ')}
          tone="warn"
          tags={<Tag tone="warn">{unmappedRoles().length} job titles</Tag>}
        />
      </Group>

      <Group
        title="Procedure steps"
        count={steps.length}
        note="The largest group. A step nobody owns cannot be chased, and a protocol is
              a sequence — one unowned step stalls everything after it."
        tone="stop"
      >
        {procedures().map((p) => {
          const mine = steps.filter((s) => s.procedure === p);
          if (mine.length === 0) return null;
          return (
            <Row
              key={p}
              title={p}
              note={mine.map((s) => s.task).join(' · ')}
              tone="warn"
              tags={<Tag tone="warn">{mine.length} steps</Tag>}
            />
          );
        })}
      </Group>

      <Group
        title="Patient journey tasks"
        count={journey.length}
        note="Stages 3 to 13. Stages 1 and 2 arrived with a Responsible column; these did not."
        tone="stop"
      >
        {theJourney().map((st) => {
          const mine = st.tasks.filter((t) => t.role === null);
          if (mine.length === 0) return null;
          return (
            <Row
              key={st.stage}
              title={st.label}
              note={mine.map((t) => t.task).join(' · ')}
              tone="warn"
              tags={<Tag tone="warn">{mine.length} tasks</Tag>}
            />
          );
        })}
      </Group>

      <Group
        title="Condition rules"
        count={conditions.length}
        note="Groups C to R. These fire automatically and land on nobody."
        tone="stop"
      >
        {theConditions().map((g) => {
          const mine = g.rules.filter((r) => r.role === null);
          if (mine.length === 0) return null;
          return (
            <Row
              key={g.group}
              title={`${g.letter}. ${g.label}`}
              note={mine.map((r) => `${r.condition} → ${r.task}`).join(' · ')}
              tone="warn"
              tags={<Tag tone="warn">{mine.length} rules</Tag>}
            />
          );
        })}
      </Group>
    </>
  );
}
