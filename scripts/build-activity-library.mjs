/**
 * Generate the activity library from the frozen matrix.
 *
 * Constitution rule 4 — one source of truth, everything generated — was being
 * broken by this repository's own code: `parameter-model.ts` was hand-written
 * and the client had no activity dictionary at all. This closes that.
 *
 * The frozen matrix already IS the PSS record. Its 23 columns are exactly the
 * hierarchy that was asked for:
 *
 *   Parameter        → function
 *   Process          → sub-function
 *   Sub-Process      → sub-function detail
 *   Activity         → the activity itself
 *   Doer / Checker / Accountable Owner   → three of the four responsibilities
 *   Escalation L1 / L2 / L3              → the fourth, as a ladder
 *   Evidence Type / Evidence Required    → evidence
 *   KPI                                  → what it moves
 *   Automation Rule                      → the IF/THEN rule
 *   Trigger / Frequency / Due Rule       → when it fires
 *   Dependency / Gate                    → what blocks it
 *   Failure Definition                   → what the exception engine watches
 *   CAPA Requirement                     → what failure obliges
 *
 * So nothing here is authored. It is read, typed and emitted.
 *
 *   node scripts/build-activity-library.mjs
 *
 * Run from the repository root. Writes packages/contracts/src/activity-library.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'docs/requirements/master-activity-matrix-v2.tsv';
const OUT = 'packages/contracts/src/activity-library.ts';

// The matrix is CRLF. Left in, the trailing \r rides on the last column of
// every row — so the header lookup for "CAPA Requirement" misses and every
// CAPA value silently carries an invisible character.
const rows = readFileSync(SRC, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim());
const header = rows[0].split('\t');
const col = (name) => {
  const i = header.indexOf(name);
  if (i < 0) throw new Error(`Column "${name}" is not in the frozen matrix`);
  return i;
};

const C = {
  id: col('Activity ID'), parameter: col('Parameter'), process: col('Process'),
  subProcess: col('Sub-Process'), activity: col('Activity'),
  standard: col('Standard / Expected Result'), trigger: col('Trigger'),
  frequency: col('Frequency'), dueRule: col('Due Rule'),
  doer: col('Doer'), checker: col('Checker'), owner: col('Accountable Owner'),
  priority: col('Priority'), evidenceType: col('Evidence Type'),
  evidenceRequired: col('Evidence Required'), dependency: col('Dependency / Gate'),
  automation: col('Automation Rule'), failure: col('Failure Definition'),
  esc1: col('Escalation L1'), esc2: col('Escalation L2'), esc3: col('Escalation L3'),
  kpi: col('KPI'), capa: col('CAPA Requirement'),
};

/** Blank means "not decided", which is not the same as an empty string. */
const val = (cells, i) => {
  const v = (cells[i] ?? '').trim();
  return v === '' ? null : v;
};

/**
 * Which of the five object types raises this activity.
 *
 * Read from the matrix's own Trigger column rather than guessed. DEPENDENCY
 * becomes a GATE because that is what a dependency is operationally: the work
 * cannot proceed until the thing it depends on is satisfied.
 */
/** Functions where an EVENT genuinely means something happened to a patient. */
const CLINICAL_FUNCTIONS = /patient|clinical|laboratory|implant|infection|emergency|complaint|follow-up/i;

function originOf(trigger, parameter) {
  switch ((trigger ?? '').toUpperCase()) {
    case 'TIME': return 'RECURRING';
    case 'DEPENDENCY': return 'GATE';
    case 'MANUAL': return 'CONDITION';
    case 'EVENT':
      // Type B is specifically "generated because something happened to a
      // PATIENT". A leave request being approved is an event and is not that,
      // and calling it a patient event made "Approve/reject leave" appear
      // under a clinical heading. Non-clinical events are conditions.
      return CLINICAL_FUNCTIONS.test(parameter ?? '') ? 'PATIENT_EVENT' : 'CONDITION';
    default: return 'CONDITION';
  }
}

/** Which engine owns it. Derived from origin plus the parameter it belongs to. */
function engineOf(origin, parameter) {
  if (origin === 'GATE') return 'COMPLIANCE';
  if (origin === 'PATIENT_EVENT') return 'PATIENT_EVENT';
  if (/equipment|maintenance/i.test(parameter ?? '')) return 'EQUIPMENT';
  if (/inventory|implant/i.test(parameter ?? '')) return 'INVENTORY';
  return origin === 'RECURRING' ? 'TIME' : 'EXCEPTION';
}

const activities = rows.slice(1).map((line) => {
  const c = line.split('\t');
  const trigger = val(c, C.trigger);
  const parameter = val(c, C.parameter);
  const origin = originOf(trigger, parameter);
  const dueRule = val(c, C.dueRule);

  return {
    id: val(c, C.id),
    // PSS hierarchy, straight off the matrix.
    fn: parameter,
    subFn: val(c, C.process),
    subProcess: val(c, C.subProcess),
    activity: val(c, C.activity),
    standard: val(c, C.standard),

    trigger, frequency: val(c, C.frequency), dueRule,
    origin, engine: engineOf(origin, parameter),

    // Four levels of responsibility. Checker null means self-verification is
    // permitted for this activity; it never means nobody checks.
    doer: val(c, C.doer),
    checker: val(c, C.checker),
    owner: val(c, C.owner),
    escalation: [val(c, C.esc1), val(c, C.esc2), val(c, C.esc3)].filter(Boolean),

    priority: val(c, C.priority),
    evidenceType: val(c, C.evidenceType),
    evidenceRequired: val(c, C.evidenceRequired),
    dependency: val(c, C.dependency),
    automationRule: val(c, C.automation),
    failure: val(c, C.failure),
    kpi: val(c, C.kpi),
    capa: val(c, C.capa),

    /**
     * An activity whose due rule nobody has decided ships DISABLED rather than
     * guessed — non-negotiable 4 and constitution rule 5.
     */
    enabled: dueRule !== null,
  };
});

const missing = activities.filter((a) => !a.id || !a.activity);
if (missing.length > 0) {
  console.error(`${missing.length} rows have no id or no activity — refusing to emit`);
  process.exit(1);
}

const disabled = activities.filter((a) => !a.enabled).length;

const out = `/**
 * The activity library — GENERATED. Do not edit.
 *
 * Source: ${SRC}
 * Regenerate: node scripts/build-activity-library.mjs
 *
 * ${activities.length} activities, ${disabled} shipping DISABLED because the
 * frozen matrix has no due rule for them. A guessed schedule would be worse
 * than an absent one: it would look like a decision somebody made.
 *
 * This file is the PSS engine's data. The matrix's own columns are the
 * hierarchy — function, sub-function, activity, the four responsibilities, the
 * escalation ladder, evidence, KPI, automation rule, failure definition and
 * CAPA obligation — so none of it is authored here.
 */

export interface LibraryActivity {
  id: string;
  /** Function — the control parameter this belongs to. */
  fn: string;
  /** Sub-function — the process it sits in. */
  subFn: string | null;
  subProcess: string | null;
  activity: string;
  standard: string | null;
  trigger: string | null;
  frequency: string | null;
  /** Null means nobody has decided. The activity ships disabled. */
  dueRule: string | null;
  /** One of the five object types. */
  origin: string;
  /** Which of the six engines raises it. */
  engine: string;
  doer: string | null;
  /** Null permits self-verification. Never means nobody checks. */
  checker: string | null;
  owner: string | null;
  /** L1 → L2 → L3, in order. */
  escalation: string[];
  priority: string | null;
  evidenceType: string | null;
  evidenceRequired: string | null;
  dependency: string | null;
  automationRule: string | null;
  failure: string | null;
  kpi: string | null;
  capa: string | null;
  enabled: boolean;
}

export const ACTIVITY_LIBRARY: readonly LibraryActivity[] = ${
  JSON.stringify(activities, null, 2)
} as const;

/** Activities in one function (control parameter). */
export const activitiesInFunction = (fn: string): LibraryActivity[] =>
  ACTIVITY_LIBRARY.filter((a) => a.fn === fn);

/** Activities raised by one engine. */
export const activitiesByEngine = (engine: string): LibraryActivity[] =>
  ACTIVITY_LIBRARY.filter((a) => a.engine === engine);

/** Activities of one object type. */
export const activitiesByOrigin = (origin: string): LibraryActivity[] =>
  ACTIVITY_LIBRARY.filter((a) => a.origin === origin);

/** Everything a role touches, in any of its four capacities. */
export const activitiesForRoleName = (name: string): LibraryActivity[] =>
  ACTIVITY_LIBRARY.filter((a) => a.doer === name || a.checker === name
    || a.owner === name || a.escalation.includes(name));

/** Distinct KPIs the library feeds. */
export const LIBRARY_KPIS: readonly string[] =
  [...new Set(ACTIVITY_LIBRARY.map((a) => a.kpi).filter((k): k is string => !!k))].sort();

/** Distinct functions, in matrix order. */
export const LIBRARY_FUNCTIONS: readonly string[] =
  [...new Set(ACTIVITY_LIBRARY.map((a) => a.fn))];
`;

writeFileSync(OUT, out);
console.log(
  `${OUT} — ${activities.length} activities, ${disabled} disabled, `
  + `${new Set(activities.map((a) => a.fn)).size} functions, `
  + `${new Set(activities.map((a) => a.kpi).filter(Boolean)).size} KPIs`,
);
