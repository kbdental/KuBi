/**
 * The whole Master Activity Matrix v2.0, mapped to runtime definitions.
 *
 * Until now the app ran on nine hand-written activities out of a hundred and
 * one. Nine is enough to demonstrate machinery and not nearly enough to find
 * out whether it works: every scoring, scheduling and grouping decision in
 * KuBi has only ever been exercised against one process, on one clinic, on one
 * day.
 *
 * This reads the frozen matrix directly — `docs/requirements/
 * master-activity-matrix-v2.tsv`, extracted from the workbook and committed —
 * rather than restating it in TypeScript. Restating a hundred and one rows by
 * hand would guarantee drift, and drift from a FROZEN source is the one kind
 * that can never be reconciled.
 *
 * The nine already written by hand (OPN-*, CLS-*) keep their hand-written
 * form: they carry checklists, clinic-language titles and owner decisions
 * (OD-19, OD-02, OD-21) that no automatic mapping can reproduce. This module
 * skips them rather than overwriting that work.
 *
 * ---
 *
 * WHAT THIS MAPPING CANNOT DO, and does not pretend to:
 *
 * The matrix says a due rule is "Before first patient" or "Configured lead
 * time" or "Same day". Some of those are computable and some are placeholders
 * for a decision nobody has taken. Where the phrase names no clock time, no
 * anchor and no offset, the definition is seeded with a due rule marked
 * `UNRESOLVED` and the activity is seeded DISABLED. It exists, it is
 * reviewable, and it will not silently generate work at a time somebody
 * invented.
 *
 * The alternative — picking a plausible hour — would put a hundred activities
 * into a clinic's morning at times no one agreed to, which is exactly how an
 * operations app becomes something staff ignore.
 */
import { readFileSync } from 'node:fs';
import {
  Priority, ExecutionMode, Recurrence, InstanceScope, DueRuleKind, SodPolicy,
  EvidenceType, CapaRequirement, RoleCode, Parameter,
} from '@kubi/contracts';
import type { ActivityDefinitionSeed } from './opening-activities.js';

const TSV = 'docs/requirements/master-activity-matrix-v2.tsv';

/** Written by hand with checklists and owner decisions. Never overwritten. */
const HAND_WRITTEN = /^(OPN|CLS)-/;

/**
 * The matrix groups by execution — who does the work, in which run. The 16
 * control parameters group by accountability. Neither is wrong and they are
 * not the same shape, so the mapping is stated once, here.
 */
const PARAMETER_OF: Record<string, Parameter> = {
  'Attendance & Leave': Parameter.ATTENDANCE_LEAVE,
  'Opening Readiness': Parameter.OPENING_READINESS,
  'Appointments & Reception': Parameter.APPOINTMENT_CONTROL,
  'Patient Care & Clinical': Parameter.PATIENT_JOURNEY,
  'Patient Follow-up': Parameter.FOLLOWUP_EXPERIENCE,
  'Laboratory Management': Parameter.LABORATORY,
  'Infection Control': Parameter.INFECTION_CONTROL,
  'Inventory & Procurement': Parameter.INVENTORY_IMPLANTS,
  'Implant Inventory': Parameter.INVENTORY_IMPLANTS,
  'Equipment Preventive Maintenance': Parameter.MAINTENANCE_UTILITIES,
  'Emergency Management': Parameter.SAFETY_EMERGENCY,
  'Staff Training & Competency': Parameter.STAFF_CONDUCT,
  'Professional Conduct': Parameter.STAFF_CONDUCT,
  Complaints: Parameter.FOLLOWUP_EXPERIENCE,
  'Incidents & CAPA': Parameter.QUALITY_CAPA,
  'Weekly/Monthly Audits': Parameter.QUALITY_CAPA,
  'Closing & Facility': Parameter.OPENING_READINESS,
};

/**
 * Individual overrides where an activity plainly serves a different control
 * head from its execution group. Documentation activities run in the clinical
 * pass but are accounted for under documentation; the closing run touches five
 * different heads. Listed rather than inferred, so each is arguable in review.
 */
const PARAMETER_OVERRIDE: Record<string, Parameter> = {
  'CLN-003': Parameter.CLINICAL_DOCUMENTATION,
  'CLN-009': Parameter.CLINICAL_DOCUMENTATION,
  'CLN-011': Parameter.CLINICAL_DOCUMENTATION,
  'CLN-006': Parameter.SURGICAL_HIGH_RISK,
  'CLN-007': Parameter.SURGICAL_HIGH_RISK,
  'CLN-005': Parameter.ROOM_CHAIR_READINESS,
  'INV-001': Parameter.ROOM_CHAIR_READINESS,
  'FUP-003': Parameter.SURGICAL_HIGH_RISK,
  'IMP-002': Parameter.SURGICAL_HIGH_RISK,
  'IMP-003': Parameter.SURGICAL_HIGH_RISK,
  'STER-007': Parameter.INFECTION_CONTROL,
};

const RECURRENCE_OF: Record<string, string> = {
  DAILY: Recurrence.DAILY,
  WEEKLY: Recurrence.WEEKLY,
  MONTHLY: Recurrence.MONTHLY,
  QUARTERLY: Recurrence.QUARTERLY,
  CONTINUOUS: Recurrence.CONTINUOUS,
};

/**
 * Frequency phrases that describe WHAT the activity attaches to rather than
 * how often it repeats. These are scopes, not recurrences.
 */
const SCOPE_OF: Record<string, string> = {
  PER_PATIENT: InstanceScope.PATIENT,
  PER_VISIT: InstanceScope.VISIT,
  PER_APPOINTMENT: InstanceScope.APPOINTMENT,
  PER_PROCEDURE: InstanceScope.PROCEDURE,
  PER_SURGERY: InstanceScope.SURGERY,
  PER_CASE: InstanceScope.LAB_CASE,
  PER_BATCH: InstanceScope.STERILIZATION_BATCH,
};

const EVIDENCE_OF: Record<string, string> = {
  SYSTEM: EvidenceType.SYSTEM,
  CONFIRMATION: EvidenceType.CONFIRMATION,
  VALUE: EvidenceType.VALUE,
  ATTACHMENT: EvidenceType.ATTACHMENT,
  VERIFICATION: EvidenceType.VERIFICATION,
  SIGNATURE: EvidenceType.SIGNATURE,
};

/** Matrix actor words → the role catalogue. Unmatched actors stay as text. */
const ROLE_OF: Record<string, string> = {
  'All Staff': RoleCode.DENTAL_ASSISTANT,
  Employee: RoleCode.DENTAL_ASSISTANT,
  Assistant: RoleCode.DENTAL_ASSISTANT,
  'Dental Assistant': RoleCode.DENTAL_ASSISTANT,
  'Senior Assistant': RoleCode.SENIOR_ASSISTANT,
  Reception: RoleCode.RECEPTION,
  'Reception Executive': RoleCode.RECEPTION,
  Doctor: RoleCode.TREATING_DOCTOR,
  'Treating Doctor': RoleCode.TREATING_DOCTOR,
  'Clinic Manager': RoleCode.CLINIC_MANAGER,
  Manager: RoleCode.CLINIC_MANAGER,
  'Reporting Manager': RoleCode.CLINIC_MANAGER,
  'Clinic Head': RoleCode.CLINIC_HEAD,
  'Clinical Director': RoleCode.CLINICAL_DIRECTOR,
  'Inventory Coordinator': RoleCode.INVENTORY_COORDINATOR,
  'Implant Coordinator': RoleCode.INVENTORY_COORDINATOR,
  'Lab Coordinator': RoleCode.LAB_COORDINATOR,
  'Quality/Compliance': RoleCode.QUALITY_COMPLIANCE,
  Housekeeping: RoleCode.HOUSEKEEPING,
  System: RoleCode.SYSTEM_ADMINISTRATOR,
};

const actor = (raw: string, fallback: string) => {
  const t = raw.trim();
  if (!t || t === '—') return { kind: 'ROLE', value: fallback };
  return { kind: 'ROLE', value: ROLE_OF[t] ?? fallback };
};

/**
 * Turn the matrix's due-rule phrase into something the scheduler can use, or
 * refuse to.
 *
 * `resolved: false` means the phrase names no time anybody agreed. The
 * activity still seeds — it is a real requirement and belongs in the register
 * — but disabled, so it cannot generate work at an invented hour.
 */
function dueRuleFor(phrase: string, frequency: string):
{ rule: Record<string, unknown>; resolved: boolean } {
  const p = phrase.trim();

  // An explicit clock time. The only phrases that need no interpretation.
  const clock = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(p);
  if (clock) {
    return { rule: { kind: DueRuleKind.CLOCK, time: p }, resolved: true };
  }

  const l = p.toLowerCase();
  if (l === 'opening') {
    return { rule: { kind: DueRuleKind.CLINIC_EVENT, anchor: 'OPENING', offsetMinutes: 0 }, resolved: true };
  }
  if (l === 'closing' || l === 'final closing') {
    return { rule: { kind: DueRuleKind.CLINIC_EVENT, anchor: 'CLOSING', offsetMinutes: 0 }, resolved: true };
  }
  if (l === 'immediate' || l.startsWith('immediate')) {
    return { rule: { kind: DueRuleKind.IMMEDIATE }, resolved: true };
  }
  if (l === '+1 day') {
    return { rule: { kind: DueRuleKind.EVENT_RELATIVE, offsetMinutes: 1440 }, resolved: true };
  }
  if (l === 'same day') {
    return { rule: { kind: DueRuleKind.CLINIC_EVENT, anchor: 'CLOSING', offsetMinutes: 0 }, resolved: true };
  }
  if (l === 'week end' && frequency === 'WEEKLY') {
    return { rule: { kind: DueRuleKind.PERIOD_END, period: 'WEEK' }, resolved: true };
  }
  if (l === 'month end' && frequency === 'MONTHLY') {
    return { rule: { kind: DueRuleKind.PERIOD_END, period: 'MONTH' }, resolved: true };
  }

  // Everything else — "Configured lead time", "Protocol-defined", "Within SLA",
  // "Before first patient" — names a decision, not a time. Left unresolved
  // rather than guessed. Each needs an owner decision or a module that does
  // not exist yet (an SLA table, a procedure protocol, appointment anchors).
  return {
    rule: {
      kind: DueRuleKind.CONFIG_REF,
      provenance: 'UNRESOLVED',
      matrixPhrase: p,
      note: 'Matrix names a policy, not a time. Seeded disabled until the anchor or config key exists.',
    },
    resolved: false,
  };
}

export interface MatrixSeed extends ActivityDefinitionSeed {
  enabled: boolean;
  /** Why this one is disabled, when it is. */
  unresolvedReason: string | null;
}

/** Reads the frozen matrix and maps every row the hand-written set does not cover. */
export function matrixActivities(repoRoot = process.cwd()): MatrixSeed[] {
  const raw = readFileSync(`${repoRoot}/${TSV}`, 'utf8').trim().split(/\r?\n/);
  const head = raw[0]!.split('\t').map((h) => h.trim());
  const rows = raw.slice(1).map((line) => {
    const cells = line.split('\t').map((c) => c.trim());
    while (cells.length < head.length) cells.push('');
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])) as Record<string, string>;
  });

  const out: MatrixSeed[] = [];
  for (const r of rows) {
    const code = r['Activity ID']!;
    if (!code || HAND_WRITTEN.test(code)) continue;

    const group = r.Parameter!;
    const parameter = PARAMETER_OVERRIDE[code] ?? PARAMETER_OF[group];
    if (!parameter) {
      throw new Error(
        `[matrix-activities] ${code} is in group "${group}", which maps to no control parameter. `
        + 'Add it to PARAMETER_OF rather than letting the activity seed without a home — '
        + 'an activity with no parameter never appears in any score.',
      );
    }

    const frequency = r.Frequency ?? '';
    const { rule, resolved } = dueRuleFor(r['Due Rule'] ?? '', frequency);
    const priority = (r.Priority || Priority.ROUTINE) as string;

    out.push({
      code,
      parameter,
      title: r.Activity!,
      standardText: r['Standard / Expected Result'] || r.Activity!,
      process: r.Process || group,
      priority,
      executionMode: r.Doer === 'System' ? ExecutionMode.SYSTEM : ExecutionMode.HUMAN,
      recurrence: RECURRENCE_OF[frequency] ?? Recurrence.NONE,
      instanceScope: SCOPE_OF[frequency] ?? InstanceScope.CLINIC_DAY,
      dueRule: rule,
      assignmentRule: {
        doer: actor(r.Doer ?? '', RoleCode.DENTAL_ASSISTANT),
        checker: actor(r.Checker ?? '', RoleCode.CLINIC_MANAGER),
        owner: actor(r['Accountable Owner'] ?? '', RoleCode.CLINIC_HEAD) as { kind: string; value: string },
      },
      // A checker distinct from the doer is required wherever the matrix names
      // one; where it does not, self-verification is still not assumed.
      sodPolicy: r.Checker && r.Checker !== '—' ? SodPolicy.STRICT : SodPolicy.NOT_REQUIRED,
      selfVerifyAllowed: !r.Checker || r.Checker === '—',
      evidenceType: EVIDENCE_OF[r['Evidence Type'] ?? ''] ?? EvidenceType.CONFIRMATION,
      gateRequirement: r['Dependency / Gate'] || null,
      gateEnforcementConfigKey: null,
      failureDefinition: r['Failure Definition'] || 'Not completed by the due time',
      escalationPolicy: `${priority}_DEFAULT`,
      capaPolicy: (r['CAPA Requirement'] || CapaRequirement.NONE) as string,
      checklist: [],
      matrixRef: `Matrix v2.0 ${code}`,
      enabled: resolved,
      unresolvedReason: resolved ? null : `Due rule "${r['Due Rule']}" names a policy, not a time`,
    } as MatrixSeed);
  }
  return out;
}
