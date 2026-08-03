/**
 * The automation engine — IF / THEN / ELSE.
 *
 * Module 3. The point is that rules are **data, not code**: a clinic that
 * wants surgery to also raise a theatre-turnaround task should add a row, not
 * commission a release. Everything below is evaluable, inspectable and
 * testable without a browser.
 *
 * The worked example from the specification:
 *
 *   Appointment booked
 *     → confirmation task
 *     → room preparation
 *     → consent verification
 *     → sterilisation check
 *     → follow-up
 *
 * Two design decisions worth stating, because both are easy to get wrong and
 * expensive to reverse:
 *
 * 1. **A rule raises work; it never completes work.** Automation that can tick
 *    things off is automation that can hide a failure. Every action here
 *    creates, blocks or notifies — none of them satisfies a requirement.
 *
 * 2. **ELSE is not "the rule failed".** It is the other branch of a decision
 *    the clinic made deliberately — a same-day booking still needs
 *    confirmation, it just needs it now rather than tomorrow morning.
 */
import type { TaskOrigin } from './work-model.js';

/** What can start a rule. Mirrors the six engines' outputs. */
export const TriggerEvent = {
  APPOINTMENT_BOOKED: 'APPOINTMENT_BOOKED',
  APPOINTMENT_CANCELLED: 'APPOINTMENT_CANCELLED',
  PATIENT_ARRIVED: 'PATIENT_ARRIVED',
  PROCEDURE_STARTED: 'PROCEDURE_STARTED',
  PROCEDURE_COMPLETED: 'PROCEDURE_COMPLETED',
  LAB_CASE_RECEIVED: 'LAB_CASE_RECEIVED',
  LAB_QC_PASSED: 'LAB_QC_PASSED',
  LAB_QC_FAILED: 'LAB_QC_FAILED',
  STOCK_AT_OR_BELOW_MINIMUM: 'STOCK_AT_OR_BELOW_MINIMUM',
  ASSET_SERVICE_DUE: 'ASSET_SERVICE_DUE',
  ASSET_CHECK_FAILED: 'ASSET_CHECK_FAILED',
  AUTOCLAVE_CYCLE_FINISHED: 'AUTOCLAVE_CYCLE_FINISHED',
  TASK_OVERDUE: 'TASK_OVERDUE',
  SHIFT_OPENING: 'SHIFT_OPENING',
  SHIFT_CLOSING: 'SHIFT_CLOSING',
} as const;
export type TriggerEvent = (typeof TriggerEvent)[keyof typeof TriggerEvent];

/** What a rule may do. Deliberately small, and deliberately never "complete". */
export const ActionKind = {
  /** Raise an activity for somebody. */
  RAISE: 'RAISE',
  /** Refuse to let something proceed until a condition is met. */
  BLOCK: 'BLOCK',
  /** Tell somebody. Does not create work. */
  NOTIFY: 'NOTIFY',
  /** Start the escalation clock early, before the due time. */
  ESCALATE: 'ESCALATE',
} as const;
export type ActionKind = (typeof ActionKind)[keyof typeof ActionKind];

export interface Action {
  kind: ActionKind;
  /** The activity to raise, by library id, where the action raises one. */
  activityId?: string;
  /** Plain words for the person who receives it. */
  say: string;
  /** Who it lands on. A role name as the matrix spells it. */
  to: string;
  /** When it is due, in the clinic's own words. */
  due?: string;
  /** For RAISE: which of the five object types this produces. */
  origin?: TaskOrigin;
}

/**
 * The facts a rule may test. Kept as a flat bag rather than a nested object so
 * that a condition is always a one-line expression a non-programmer can read
 * in the rule table.
 */
export interface Facts {
  [key: string]: string | number | boolean | null | undefined;
}

export interface Rule {
  id: string;
  /** Human-readable, and shown on screen — the rule explains itself. */
  name: string;
  when: TriggerEvent;
  /**
   * The IF. Absent means the rule always fires on its trigger.
   * Returns true to take `then`, false to take `otherwise`.
   */
  condition?: (f: Facts) => boolean;
  /** Said in words, so the screen can show the condition without running it. */
  conditionText?: string;
  then: Action[];
  /** The other branch of a deliberate decision, not a failure path. */
  otherwise?: Action[];
  enabled: boolean;
}

export interface RuleOutcome {
  ruleId: string;
  ruleName: string;
  /** Which branch ran. Null when the rule did not apply at all. */
  branch: 'THEN' | 'ELSE' | null;
  actions: Action[];
}

/**
 * Run every rule that listens for this event.
 *
 * Pure: it returns what *would* happen and performs nothing. The caller
 * decides whether to apply it, which is what makes the engine testable and
 * what lets a screen show a clinic the consequences of a rule before it is
 * switched on.
 */
export function fire(rules: readonly Rule[], event: TriggerEvent, facts: Facts = {}): RuleOutcome[] {
  return rules
    .filter((r) => r.enabled && r.when === event)
    .map((r) => {
      // No condition means the rule always applies — the common case, and it
      // must not be confused with a condition that evaluated false.
      const passed = r.condition ? r.condition(facts) : true;
      const actions = passed ? r.then : (r.otherwise ?? []);
      return {
        ruleId: r.id,
        ruleName: r.name,
        branch: actions.length === 0 && !passed ? null : (passed ? 'THEN' : 'ELSE'),
        actions,
      } satisfies RuleOutcome;
    })
    .filter((o) => o.actions.length > 0);
}

/**
 * The clinic's rules.
 *
 * The first is the owner's worked example, verbatim. The rest are the ones the
 * frozen matrix's Automation Rule column already implies — so they are not new
 * policy, they are the policy that was written down and never executed.
 */
export const RULES: readonly Rule[] = [
  {
    id: 'R-APPT-01',
    name: 'Appointment booked raises its preparation',
    when: TriggerEvent.APPOINTMENT_BOOKED,
    conditionText: 'the appointment is more than a day away',
    condition: (f) => Number(f.hoursUntil ?? 0) > 24,
    then: [
      { kind: ActionKind.RAISE, activityId: 'APT-001', say: 'Confirm the appointment', to: 'Reception', due: 'Morning cutoff', origin: 'PATIENT_EVENT' as TaskOrigin },
      { kind: ActionKind.RAISE, activityId: 'CLN-005', say: 'Prepare the chair', to: 'Dental Assistant', due: 'Before the patient is seated', origin: 'PATIENT_EVENT' as TaskOrigin },
      { kind: ActionKind.RAISE, activityId: 'CLN-002', say: 'Verify consent', to: 'Treating Doctor', due: 'Before the procedure', origin: 'GATE' as TaskOrigin },
      { kind: ActionKind.RAISE, activityId: 'STER-005', say: 'Confirm a sterile kit is released', to: 'Sterilization Technician', due: 'Before the procedure', origin: 'GATE' as TaskOrigin },
      { kind: ActionKind.RAISE, activityId: 'FUP-001', say: 'Schedule the follow-up', to: 'Reception', due: 'After the procedure', origin: 'PATIENT_EVENT' as TaskOrigin },
    ],
    // Not a failure branch: a same-day booking still needs confirming, it just
    // cannot wait for tomorrow morning's round.
    otherwise: [
      { kind: ActionKind.RAISE, activityId: 'APT-002', say: 'Confirm now — booked for today', to: 'Reception', due: 'Immediately', origin: 'CONDITION' as TaskOrigin },
      { kind: ActionKind.RAISE, activityId: 'CLN-005', say: 'Prepare the chair', to: 'Dental Assistant', due: 'Before the patient is seated', origin: 'PATIENT_EVENT' as TaskOrigin },
      { kind: ActionKind.RAISE, activityId: 'CLN-002', say: 'Verify consent', to: 'Treating Doctor', due: 'Before the procedure', origin: 'GATE' as TaskOrigin },
    ],
    enabled: true,
  },
  {
    id: 'R-PROC-01',
    name: 'Procedure completed raises its aftercare',
    when: TriggerEvent.PROCEDURE_COMPLETED,
    then: [
      { kind: ActionKind.RAISE, activityId: 'CLN-010', say: 'Issue post-op instructions', to: 'Treating Doctor', due: 'Before discharge', origin: 'PATIENT_EVENT' as TaskOrigin },
      { kind: ActionKind.RAISE, activityId: 'CLN-011', say: 'Complete the clinical note', to: 'Treating Doctor', due: 'Within 24h', origin: 'PATIENT_EVENT' as TaskOrigin },
      { kind: ActionKind.RAISE, activityId: 'APT-004', say: 'Book the next appointment', to: 'Reception', due: 'Before discharge', origin: 'PATIENT_EVENT' as TaskOrigin },
      { kind: ActionKind.RAISE, activityId: 'FUP-002', say: 'Day-after surgery call', to: 'Treating Doctor', due: 'Tomorrow', origin: 'PATIENT_EVENT' as TaskOrigin },
    ],
    enabled: true,
  },
  {
    id: 'R-STOCK-01',
    name: 'Stock at or below minimum raises a purchase requirement',
    when: TriggerEvent.STOCK_AT_OR_BELOW_MINIMUM,
    conditionText: 'the item is out of stock entirely',
    condition: (f) => Number(f.quantity ?? 0) === 0,
    then: [
      { kind: ActionKind.RAISE, activityId: 'INV-004', say: 'Reorder now — out of stock', to: 'Inventory Coordinator', due: 'Immediately', origin: 'CONDITION' as TaskOrigin },
      { kind: ActionKind.NOTIFY, say: 'An item is out of stock', to: 'Clinic Manager' },
    ],
    otherwise: [
      { kind: ActionKind.RAISE, activityId: 'INV-004', say: 'Raise a purchase requirement', to: 'Inventory Coordinator', due: 'Today', origin: 'CONDITION' as TaskOrigin },
    ],
    enabled: true,
  },
  {
    id: 'R-LAB-01',
    name: 'Lab case passes its check and becomes bookable',
    when: TriggerEvent.LAB_QC_PASSED,
    then: [
      { kind: ActionKind.RAISE, activityId: 'LAB-005', say: 'Give the patient a delivery appointment', to: 'Reception', due: 'Today', origin: 'CONDITION' as TaskOrigin },
    ],
    enabled: true,
  },
  {
    id: 'R-LAB-02',
    name: 'Lab case fails its check and is remade',
    when: TriggerEvent.LAB_QC_FAILED,
    then: [
      { kind: ActionKind.BLOCK, say: 'No delivery appointment may be booked for this case', to: 'Reception' },
      { kind: ActionKind.RAISE, activityId: 'LAB-007', say: 'Re-dispatch for remake', to: 'Lab Coordinator', due: 'Today', origin: 'CONDITION' as TaskOrigin },
      { kind: ActionKind.NOTIFY, say: 'A case failed its check and the patient was promised a date', to: 'Clinic Manager' },
    ],
    enabled: true,
  },
  {
    id: 'R-ASSET-01',
    name: 'Asset check fails and the asset leaves service',
    when: TriggerEvent.ASSET_CHECK_FAILED,
    then: [
      { kind: ActionKind.BLOCK, say: 'This asset may not be used until it is verified back into service', to: 'Dental Assistant' },
      { kind: ActionKind.RAISE, activityId: 'EQP-005', say: 'Raise a breakdown ticket', to: 'Clinic Manager', due: 'Immediately', origin: 'CONDITION' as TaskOrigin },
      { kind: ActionKind.ESCALATE, say: 'An asset is out of service', to: 'Clinic Head' },
    ],
    enabled: true,
  },
  {
    id: 'R-ASSET-02',
    name: 'Service date reached raises the service task',
    when: TriggerEvent.ASSET_SERVICE_DUE,
    then: [
      { kind: ActionKind.RAISE, activityId: 'EQP-002', say: 'Preventive maintenance is due', to: 'Clinic Manager', due: 'Today', origin: 'CONDITION' as TaskOrigin },
    ],
    enabled: true,
  },
  {
    id: 'R-STER-01',
    name: 'Autoclave cycle finishes and needs an independent release',
    when: TriggerEvent.AUTOCLAVE_CYCLE_FINISHED,
    conditionText: 'the cycle passed',
    condition: (f) => f.result === 'PASS',
    then: [
      { kind: ActionKind.RAISE, activityId: 'STER-005', say: 'Release the batch — the operator may not release their own', to: 'Senior Assistant', due: 'Before the packs are used', origin: 'GATE' as TaskOrigin },
    ],
    otherwise: [
      { kind: ActionKind.BLOCK, say: 'Quarantined — nothing in this batch may be used', to: 'Sterilization Technician' },
      { kind: ActionKind.ESCALATE, say: 'An autoclave cycle did not pass', to: 'Clinical Director' },
    ],
    enabled: true,
  },
];
