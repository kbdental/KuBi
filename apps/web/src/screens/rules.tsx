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
  const [view, setView] = useState<'CONDITIONS' | 'GATES' | 'EXCEPTIONS'>('CONDITIONS');

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
        ]}
      />

      {view === 'CONDITIONS' && <Conditions />}
      {view === 'GATES' && <Gates />}
      {view === 'EXCEPTIONS' && <Exceptions />}
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
