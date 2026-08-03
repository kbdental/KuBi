/**
 * The work model — five object types, six engines, four responsibilities.
 *
 * The owner's correction, and it is the central one: **not everything is a
 * checklist.** A tickable box is what all five of these degrade into once the
 * system forgets why the work exists, and once that happens the clinic is back
 * to relying on somebody remembering.
 *
 * The five object types differ in what *causes* them, which decides everything
 * downstream — when they appear, who they belong to, whether they can be
 * skipped, and what it means when they are late:
 *
 *   A RECURRING      time caused it. 09:45 attendance, closing sterilisation.
 *   B PATIENT_EVENT  something happened to a patient. Surgery completed, so
 *                    post-op instructions today and a follow-up call tomorrow.
 *   C CONDITION      a state became true. Stock fell to minimum; crown arrived.
 *   D GATE           a procedure may not start until every item passes. Not a
 *                    checklist — a checklist can be ticked while wrong.
 *   E EXCEPTION      something that should have happened did not.
 *
 * And the loop they all serve:
 *   PLAN → TRIGGER → ASSIGN → EXECUTE → PROVE → VERIFY → ESCALATE → MEASURE
 *   → IMPROVE
 */
import type { Parameter, RoleCode, EvidenceType } from './enums.js';

// ─────────────────────────────────────────────────────────────────────────
// The five object types
// ─────────────────────────────────────────────────────────────────────────

export const TaskOrigin = {
  /** A — time caused it. */
  RECURRING: 'RECURRING',
  /** B — something happened to a patient. */
  PATIENT_EVENT: 'PATIENT_EVENT',
  /** C — a condition became true. */
  CONDITION: 'CONDITION',
  /** D — a gate that cannot be bypassed. */
  GATE: 'GATE',
  /** E — something that should have happened did not. */
  EXCEPTION: 'EXCEPTION',
} as const;
export type TaskOrigin = (typeof TaskOrigin)[keyof typeof TaskOrigin];

/** Said to the person on screen, so work never appears without a reason. */
export const ORIGIN_LABEL: Record<TaskOrigin, string> = {
  RECURRING: 'Scheduled',
  PATIENT_EVENT: 'Because of a patient',
  CONDITION: 'Because of a condition',
  GATE: 'Must pass before starting',
  EXCEPTION: 'Did not happen',
};

// ─────────────────────────────────────────────────────────────────────────
// The six engines
// ─────────────────────────────────────────────────────────────────────────

export const Engine = {
  TIME: 'TIME',
  PATIENT_EVENT: 'PATIENT_EVENT',
  EQUIPMENT: 'EQUIPMENT',
  INVENTORY: 'INVENTORY',
  COMPLIANCE: 'COMPLIANCE',
  EXCEPTION: 'EXCEPTION',
} as const;
export type Engine = (typeof Engine)[keyof typeof Engine];

export const ENGINE_LABEL: Record<Engine, string> = {
  TIME: 'Time',
  PATIENT_EVENT: 'Patient event',
  EQUIPMENT: 'Equipment',
  INVENTORY: 'Inventory',
  COMPLIANCE: 'Compliance',
  EXCEPTION: 'Exception',
};

/**
 * Which engines can produce which kind of work.
 *
 * Equipment and Inventory both emit CONDITION work — a service date arriving
 * and stock crossing its reorder level are the same shape of event — which is
 * why origin and engine are two fields and not one.
 */
export const ENGINE_EMITS: Record<Engine, TaskOrigin[]> = {
  TIME: [TaskOrigin.RECURRING],
  PATIENT_EVENT: [TaskOrigin.PATIENT_EVENT],
  EQUIPMENT: [TaskOrigin.CONDITION, TaskOrigin.RECURRING],
  INVENTORY: [TaskOrigin.CONDITION],
  COMPLIANCE: [TaskOrigin.GATE],
  EXCEPTION: [TaskOrigin.EXCEPTION],
};

// ─────────────────────────────────────────────────────────────────────────
// Four levels of responsibility
// ─────────────────────────────────────────────────────────────────────────

/**
 * Doer, checker, owner, escalation — all four, always.
 *
 * This exists to kill one specific failure: *"I thought somebody else had done
 * it."* Two levels cannot express it. An assignee and a checker leave nobody
 * accountable for the result and nobody to hear about it when it does not
 * happen, and those are different people from the two who do the work.
 *
 * `checker` may be null, and that means self-verification is permitted for
 * this activity — it never means nobody checks. `owner` and `escalation` are
 * never null: work with no accountable owner should not have been created.
 */
export interface Responsibility {
  /** Performs it. */
  doer: RoleCode;
  /** Verifies it. Null where the activity permits self-verification. */
  checker: RoleCode | null;
  /** Accountable for the result, whoever happened to do it. */
  owner: RoleCode;
  /** Receives it when it goes unresolved. */
  escalation: RoleCode;
}

// ─────────────────────────────────────────────────────────────────────────
// Escalation ladder
// ─────────────────────────────────────────────────────────────────────────

/**
 * One rung. Time is measured from the due moment, not from the shift start —
 * an autoclave cycle due at 19:00 escalates at 19:15 whether or not anyone is
 * still in the building.
 */
export interface EscalationRung {
  level: 1 | 2 | 3;
  /** Minutes past due. */
  afterMinutes: number;
  to: RoleCode;
}

/**
 * The ladder the owner specified, as minutes past due: 15 to the doer's own
 * level, 30 to their senior, 60 to the clinic head.
 *
 * Deliberately data rather than code. A clinic that wants a tighter ladder for
 * patient-safety work should change a row, not a service.
 */
export function ladder(
  r: Responsibility, minutes: [number, number, number] = [15, 30, 60],
): EscalationRung[] {
  return [
    { level: 1, afterMinutes: minutes[0], to: r.doer },
    { level: 2, afterMinutes: minutes[1], to: r.checker ?? r.owner },
    { level: 3, afterMinutes: minutes[2], to: r.escalation },
  ];
}

/** Which rung applies now. Null before the first. */
export function rungAt(rungs: EscalationRung[], minutesLate: number): EscalationRung | null {
  return [...rungs].reverse().find((r) => minutesLate >= r.afterMinutes) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// The full chain, per activity
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parameter → Process → SOP → Trigger → Responsibility → Evidence →
 * Verification → Exception → Escalation → KPI.
 *
 * The owner's hierarchy, as one record. The point of holding it together is
 * that a task can then always answer "why do I exist, who owns me, what proves
 * me, and what do I move" — which is the difference between an operating
 * system and a to-do list.
 */
export interface WorkSpec {
  activityId: string;
  parameter: Parameter;
  process: string;
  origin: TaskOrigin;
  engine: Engine;
  /** What causes it, in the words a person would use. */
  trigger: string;
  /** The written procedure, in order. Empty where no SOP is written yet. */
  sop: string[];
  responsibility: Responsibility;
  dueRule: string;
  evidence: EvidenceType;
  /** How it is verified, in words. Null where self-verification applies. */
  verification: string | null;
  /** What counts as failure. Drives the Exception engine. */
  failure: string;
  escalation: EscalationRung[];
  /** The KPI this activity moves, and how it is computed. */
  kpi: { name: string; formula: string; target: string };
}

/**
 * The worked example from the owner's specification, verbatim.
 *
 * Kept in contracts rather than in a test because it is the reference shape:
 * every other activity is checked against it, and a reviewer should be able to
 * read one complete instance without reconstructing it from six files.
 *
 *   "Don't store this simply as ☐ Instruments autoclaved."
 */
export const STERILIZATION_SAME_DAY: WorkSpec = {
  activityId: 'STER-004',
  parameter: 'INFECTION_CONTROL' as Parameter,
  process: 'Instrument sterilisation',
  origin: TaskOrigin.RECURRING,
  engine: Engine.TIME,
  trigger: 'Instrument used',
  sop: [
    'Used', 'Segregation', 'Cleaning', 'Ultrasonic', 'Drying',
    'Packing', 'Sealing', 'Autoclave', 'Storage',
  ],
  responsibility: {
    doer: 'DENTAL_ASSISTANT' as RoleCode,
    checker: 'SENIOR_ASSISTANT' as RoleCode,
    owner: 'CLINICAL_DIRECTOR' as RoleCode,
    escalation: 'CLINIC_HEAD' as RoleCode,
  },
  dueRule: 'Same working day',
  evidence: 'VALUE' as EvidenceType,
  verification: 'Closing sterilisation check',
  failure: 'Any instrument used today not autoclaved by close',
  escalation: [
    { level: 1, afterMinutes: 15, to: 'DENTAL_ASSISTANT' as RoleCode },
    { level: 2, afterMinutes: 30, to: 'SENIOR_ASSISTANT' as RoleCode },
    { level: 3, afterMinutes: 60, to: 'CLINIC_HEAD' as RoleCode },
  ],
  kpi: {
    name: 'Same-day sterilisation compliance',
    formula: 'instruments sterilised same day ÷ instruments requiring sterilisation × 100',
    target: '100%',
  },
};
