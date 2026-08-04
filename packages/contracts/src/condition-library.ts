/**
 * The condition library — one hundred rules across eighteen groups.
 *
 * The third and last of the trigger types. The other two are predictable:
 * the clock raises the daily standard, a patient raises the journey. This one
 * is the interesting half of a clinic — the exceptions, the risks and the
 * missed steps, which by definition nobody planned for.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * This is a catalogue, not a second automation engine
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `automation.ts` already holds the engine: TriggerEvent, ActionKind, Rule,
 * and a pure `fire()`. Building a parallel one here would be the exact mistake
 * that made this product feel haphazard in the first place. So every entry
 * below is expressed in the engine's own vocabulary, and the useful question
 * this file answers is the honest one:
 *
 *   **Which of these hundred conditions can KuBi actually detect today?**
 *
 * `detects` names the existing engine event that would fire the rule. Where it
 * is null, `needs` says what KuBi would have to know first — a no-show event,
 * a blood-pressure reading, an allergy flag, a sharps container that can
 * report how full it is. A rule KuBi cannot detect is not a rule; it is a
 * wish, and it is recorded as one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What the owner specified, and what they did not
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Groups A and B arrived with an Assigned To against every row, and group A
 * with a Due as well. Groups C to R arrived with neither. Those are recorded
 * null, like the patient journey's eighty-two: an auto-created task with no
 * assignee lands on nobody's list and escalates to nobody, which is a worse
 * failure than not creating it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The action kind comes from the owner's own verb
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "Stop instrument usage" is a BLOCK, not a task — a task can be ticked while
 * the instruments are still in use. "Surgical consent mandatory" is a BLOCK
 * for the same reason. "Inform the technician" is a NOTIFY: it tells somebody
 * without creating work for them. "Owner escalation" is an ESCALATE. Everything
 * else RAISEs an activity.
 *
 * That distinction is the whole difference between a reminder system and a
 * control system, and it is read out of the wording rather than assigned by
 * me: where the owner wrote a verb that stops work, the rule stops work.
 */
import { RoleCode } from './enums.js';
import { ActionKind, TriggerEvent } from './automation.js';

/* -------------------------------------------------------------------------
 * The eighteen groups
 * ---------------------------------------------------------------------- */

export const ConditionGroup = {
  APPOINTMENT: 'APPOINTMENT',
  PATIENT: 'PATIENT',
  DIAGNOSIS: 'DIAGNOSIS',
  CONSENT: 'CONSENT',
  PROCEDURE: 'PROCEDURE',
  LABORATORY: 'LABORATORY',
  FINANCIAL: 'FINANCIAL',
  STERILIZATION: 'STERILIZATION',
  EQUIPMENT: 'EQUIPMENT',
  INVENTORY: 'INVENTORY',
  INFECTION_CONTROL: 'INFECTION_CONTROL',
  TREATMENT_COMPLETION: 'TREATMENT_COMPLETION',
  FOLLOW_UP: 'FOLLOW_UP',
  SATISFACTION: 'SATISFACTION',
  STAFF: 'STAFF',
  COMPLIANCE: 'COMPLIANCE',
  RECALL: 'RECALL',
  EMERGENCY: 'EMERGENCY',
} as const;
export type ConditionGroup = (typeof ConditionGroup)[keyof typeof ConditionGroup];

/** A–R, in the owner's order. The letter is theirs and is kept. */
export const GROUP_ORDER: ReadonlyArray<{ letter: string; group: ConditionGroup; label: string }> = [
  { letter: 'A', group: ConditionGroup.APPOINTMENT, label: 'Appointment conditions' },
  { letter: 'B', group: ConditionGroup.PATIENT, label: 'Patient conditions' },
  { letter: 'C', group: ConditionGroup.DIAGNOSIS, label: 'Diagnosis conditions' },
  { letter: 'D', group: ConditionGroup.CONSENT, label: 'Consent conditions' },
  { letter: 'E', group: ConditionGroup.PROCEDURE, label: 'Clinical procedure conditions' },
  { letter: 'F', group: ConditionGroup.LABORATORY, label: 'Laboratory conditions' },
  { letter: 'G', group: ConditionGroup.FINANCIAL, label: 'Financial conditions' },
  { letter: 'H', group: ConditionGroup.STERILIZATION, label: 'Sterilization conditions' },
  { letter: 'I', group: ConditionGroup.EQUIPMENT, label: 'Equipment conditions' },
  { letter: 'J', group: ConditionGroup.INVENTORY, label: 'Inventory conditions' },
  { letter: 'K', group: ConditionGroup.INFECTION_CONTROL, label: 'Infection control conditions' },
  { letter: 'L', group: ConditionGroup.TREATMENT_COMPLETION, label: 'Treatment completion conditions' },
  { letter: 'M', group: ConditionGroup.FOLLOW_UP, label: 'Follow-up conditions' },
  { letter: 'N', group: ConditionGroup.SATISFACTION, label: 'Patient satisfaction conditions' },
  { letter: 'O', group: ConditionGroup.STAFF, label: 'Staff conditions' },
  { letter: 'P', group: ConditionGroup.COMPLIANCE, label: 'Compliance conditions' },
  { letter: 'Q', group: ConditionGroup.RECALL, label: 'Recall conditions' },
  { letter: 'R', group: ConditionGroup.EMERGENCY, label: 'Emergency conditions' },
] as const;

export interface ConditionRule {
  id: string;
  group: ConditionGroup;
  /** The owner's wording, unedited. */
  condition: string;
  /** The task the condition creates, in the owner's wording. */
  task: string;
  /** Null where the clinic has not decided. Never guessed. */
  role: RoleCode | null;
  /** Null where no due time was set. Never invented. */
  due: string | null;
  /** Read out of the owner's verb. See the header. */
  action: ActionKind;
  /**
   * The engine event that would fire this today, or null when KuBi has no way
   * to notice the condition at all.
   */
  detects: TriggerEvent | null;
  /** Required whenever `detects` is null. What KuBi would need to know first. */
  needs: string | null;
}

let n = 0;
function c(
  group: ConditionGroup, condition: string, task: string,
  opts: {
    role?: RoleCode; due?: string;
    action?: ActionKind;
    detects?: TriggerEvent; needs?: string;
  } = {},
): ConditionRule {
  n += 1;
  return {
    id: `CND-${String(n).padStart(3, '0')}`,
    group,
    condition,
    task,
    role: opts.role ?? null,
    due: opts.due ?? null,
    action: opts.action ?? ActionKind.RAISE,
    detects: opts.detects ?? null,
    needs: opts.detects ? null : (opts.needs ?? 'a way to notice this condition'),
  };
}

const G = ConditionGroup;
const R = RoleCode.RECEPTION;
const A = RoleCode.DENTAL_ASSISTANT;
const D = RoleCode.TREATING_DOCTOR;
const T = TriggerEvent;

/** Reused several times: the clinical record KuBi does not hold. */
const NO_MEDICAL_RECORD = 'a structured medical history — KuBi holds no allergies, '
  + 'conditions, medications or vitals as data';
const NO_MONEY = 'the billing domain — KuBi holds no estimates, invoices or payments';
const NO_DIAGNOSIS = 'a coded diagnosis on the record, not free-text clinical notes';

export const CONDITION_LIBRARY: readonly ConditionRule[] = [
  /* ---- A. Appointment — fully specified by the owner -------------------- */
  c(G.APPOINTMENT, 'New patient booked', 'Create patient file',
    { role: R, due: 'Immediately', detects: T.APPOINTMENT_BOOKED }),
  c(G.APPOINTMENT, 'New patient booked', 'Send welcome message',
    { role: R, due: 'Within 5 min', detects: T.APPOINTMENT_BOOKED }),
  c(G.APPOINTMENT, 'Patient cancels', 'Contact for rescheduling',
    { role: R, due: 'Same day', detects: T.APPOINTMENT_CANCELLED }),
  c(G.APPOINTMENT, 'Patient doesn’t answer confirmation', 'Retry confirmation',
    { role: R, due: '2 hours', needs: 'a confirmation-attempt record with an outcome' }),
  c(G.APPOINTMENT, 'Patient no-show', 'Call patient',
    { role: R, due: 'Within 30 min', needs: 'a no-show event — the visit state has no such transition' }),
  c(G.APPOINTMENT, 'Patient no-show twice', 'Inform Clinic Manager',
    { role: R, due: 'Same day', action: ActionKind.NOTIFY,
      needs: 'a no-show event, and a count of them per patient' }),
  c(G.APPOINTMENT, 'Appointment delayed >15 min', 'Inform patient',
    { role: R, due: 'Immediately', action: ActionKind.NOTIFY,
      needs: 'a running comparison of scheduled start against actual start' }),
  c(G.APPOINTMENT, 'Doctor unavailable', 'Reallocate appointment',
    { role: R, due: 'Immediately', needs: 'a doctor availability calendar' }),

  /* ---- B. Patient — role specified, no due ------------------------------ */
  c(G.PATIENT, 'Medical history changed', 'Doctor review required',
    { role: D, needs: NO_MEDICAL_RECORD }),
  c(G.PATIENT, 'BP above clinic limit', 'Recheck BP',
    { role: A, needs: 'vitals recorded as numbers, and a configured clinic limit' }),
  c(G.PATIENT, 'Diabetes declared', 'Record latest HbA1c', { role: D, needs: NO_MEDICAL_RECORD }),
  c(G.PATIENT, 'Cardiac history', 'Verify physician clearance', { role: D, needs: NO_MEDICAL_RECORD }),
  c(G.PATIENT, 'Pregnancy declared', 'Treatment protocol review', { role: D, needs: NO_MEDICAL_RECORD }),
  c(G.PATIENT, 'Latex allergy', 'Prepare latex-free setup', { role: A, needs: NO_MEDICAL_RECORD }),
  c(G.PATIENT, 'Drug allergy', 'Verify medications', { role: D, needs: NO_MEDICAL_RECORD }),
  c(G.PATIENT, 'Infectious disease declared', 'Isolation precautions',
    { role: A, needs: NO_MEDICAL_RECORD }),

  /* ---- C. Diagnosis ------------------------------------------------------ */
  c(G.DIAGNOSIS, 'Caries diagnosed', 'Prepare treatment estimate', { needs: NO_DIAGNOSIS }),
  c(G.DIAGNOSIS, 'Root canal advised', 'Schedule RCT', { needs: NO_DIAGNOSIS }),
  c(G.DIAGNOSIS, 'Extraction advised', 'Explain extraction instructions', { needs: NO_DIAGNOSIS }),
  c(G.DIAGNOSIS, 'Implant advised', 'CBCT consultation', { needs: NO_DIAGNOSIS }),
  c(G.DIAGNOSIS, 'Crown advised', 'Shade planning', { needs: NO_DIAGNOSIS }),
  c(G.DIAGNOSIS, 'Denture advised', 'Impression appointment', { needs: NO_DIAGNOSIS }),
  c(G.DIAGNOSIS, 'Periodontal disease', 'Scaling appointment', { needs: NO_DIAGNOSIS }),
  c(G.DIAGNOSIS, 'Oral lesion detected', 'Biopsy/Referral reminder', { needs: NO_DIAGNOSIS }),

  /* ---- D. Consent — every one of these stops work ------------------------ */
  c(G.CONSENT, 'Surgical procedure', 'Surgical consent mandatory',
    { action: ActionKind.BLOCK, detects: T.PROCEDURE_STARTED }),
  c(G.CONSENT, 'Implant treatment', 'Implant consent mandatory',
    { action: ActionKind.BLOCK, detects: T.PROCEDURE_STARTED }),
  c(G.CONSENT, 'Sedation', 'Sedation consent',
    { action: ActionKind.BLOCK, needs: 'sedation recorded as a property of the procedure' }),
  c(G.CONSENT, 'Extraction', 'Extraction consent',
    { action: ActionKind.BLOCK, detects: T.PROCEDURE_STARTED }),
  c(G.CONSENT, 'Minor patient', 'Parent consent',
    { action: ActionKind.BLOCK, needs: 'date of birth on the patient record' }),
  c(G.CONSENT, 'Photography required', 'Media consent',
    { action: ActionKind.BLOCK, needs: 'a photography flag on the procedure' }),

  /* ---- E. Clinical procedure --------------------------------------------- */
  c(G.PROCEDURE, 'Implant placed', 'Record implant batch number',
    { detects: T.PROCEDURE_COMPLETED }),
  c(G.PROCEDURE, 'Bone graft used', 'Record graft batch number',
    { needs: 'graft recorded as a consumable used in the procedure' }),
  c(G.PROCEDURE, 'Membrane used', 'Record membrane batch',
    { needs: 'membrane recorded as a consumable used in the procedure' }),
  c(G.PROCEDURE, 'PRF prepared', 'Record centrifuge cycle',
    { needs: 'the centrifuge as a tracked asset with cycle records' }),
  c(G.PROCEDURE, 'Crown preparation', 'Send lab prescription',
    { detects: T.PROCEDURE_COMPLETED }),
  c(G.PROCEDURE, 'Digital scan taken', 'Upload STL',
    { needs: 'file storage — KuBi has no object store, so nothing can be uploaded' }),
  c(G.PROCEDURE, 'Impression taken', 'Dispatch to lab', { detects: T.PROCEDURE_COMPLETED }),
  c(G.PROCEDURE, 'Temporary crown placed', 'Review in 7 days',
    { detects: T.PROCEDURE_COMPLETED }),

  /* ---- F. Laboratory ------------------------------------------------------ */
  c(G.LABORATORY, 'Impression received', 'Lab work order', { detects: T.LAB_CASE_RECEIVED }),
  c(G.LABORATORY, 'Case delayed', 'Inform clinic',
    { action: ActionKind.NOTIFY, needs: 'expected-return monitoring against the due date' }),
  c(G.LABORATORY, 'Prosthesis ready', 'Schedule trial', { detects: T.LAB_QC_PASSED }),
  c(G.LABORATORY, 'Prosthesis dispatched', 'Track delivery',
    { needs: 'a dispatch event with a carrier reference' }),
  c(G.LABORATORY, 'Case returned', 'Rework request', { detects: T.LAB_QC_FAILED }),

  /* ---- G. Financial — the whole group waits on one domain ------------------ */
  c(G.FINANCIAL, 'Estimate approved', 'Schedule treatment', { needs: NO_MONEY }),
  c(G.FINANCIAL, 'Estimate rejected', 'Follow-up after 3 days', { needs: NO_MONEY }),
  c(G.FINANCIAL, 'Advance pending', 'Reminder', { needs: NO_MONEY }),
  c(G.FINANCIAL, 'Payment overdue', 'Collection call', { needs: NO_MONEY }),
  c(G.FINANCIAL, 'EMI selected', 'Finance verification', { needs: NO_MONEY }),
  c(G.FINANCIAL, 'Insurance patient', 'Submit documents', { needs: NO_MONEY }),

  /* ---- H. Sterilization ---------------------------------------------------- */
  c(G.STERILIZATION, 'Sterilization failed', 'Re-sterilize instruments',
    { detects: T.AUTOCLAVE_CYCLE_FINISHED }),
  c(G.STERILIZATION, 'Biological test failed', 'Stop instrument usage',
    // The owner wrote "Stop". A task can be ticked while the instruments are
    // still in somebody's hand; a block cannot.
    { action: ActionKind.BLOCK, detects: T.AUTOCLAVE_CYCLE_FINISHED }),
  c(G.STERILIZATION, 'Autoclave maintenance due', 'Maintenance reminder',
    { detects: T.ASSET_SERVICE_DUE }),
  c(G.STERILIZATION, 'Sterile pack expired', 'Repack and sterilize',
    { needs: 'a shelf-life clock on each released pack' }),

  /* ---- I. Equipment --------------------------------------------------------- */
  c(G.EQUIPMENT, 'Compressor pressure low', 'Maintenance check',
    { detects: T.ASSET_CHECK_FAILED }),
  c(G.EQUIPMENT, 'Suction failure', 'Inform technician',
    { action: ActionKind.NOTIFY, detects: T.ASSET_CHECK_FAILED }),
  c(G.EQUIPMENT, 'RVG malfunction', 'Service request', { detects: T.ASSET_CHECK_FAILED }),
  c(G.EQUIPMENT, 'Scanner calibration due', 'Calibration', { detects: T.ASSET_SERVICE_DUE }),
  c(G.EQUIPMENT, 'Implant motor service due', 'Maintenance', { detects: T.ASSET_SERVICE_DUE }),
  c(G.EQUIPMENT, 'Curing light intensity low', 'Replace battery/check output',
    { detects: T.ASSET_CHECK_FAILED }),

  /* ---- J. Inventory ---------------------------------------------------------- */
  c(G.INVENTORY, 'Stock below minimum', 'Purchase request',
    { detects: T.STOCK_AT_OR_BELOW_MINIMUM }),
  c(G.INVENTORY, 'Material expired', 'Remove stock',
    { needs: 'expiry dates held per batch, and a clock watching them' }),
  c(G.INVENTORY, 'Implant inventory low', 'Reorder', { detects: T.STOCK_AT_OR_BELOW_MINIMUM }),
  c(G.INVENTORY, 'Anaesthetic low', 'Purchase', { detects: T.STOCK_AT_OR_BELOW_MINIMUM }),
  c(G.INVENTORY, 'Gloves below par level', 'Reorder', { detects: T.STOCK_AT_OR_BELOW_MINIMUM }),
  c(G.INVENTORY, 'Cement finished', 'Emergency purchase',
    { detects: T.STOCK_AT_OR_BELOW_MINIMUM }),

  /* ---- K. Infection control ---------------------------------------------------- */
  c(G.INFECTION_CONTROL, 'Biomedical waste bag full', 'Dispose immediately',
    { needs: 'somebody to report it — no bag can tell KuBi it is full' }),
  c(G.INFECTION_CONTROL, 'Sharps container 75% full', 'Replace container',
    { needs: 'somebody to report it — no container can tell KuBi it is three-quarters full' }),
  c(G.INFECTION_CONTROL, 'PPE stock low', 'Purchase', { detects: T.STOCK_AT_OR_BELOW_MINIMUM }),
  c(G.INFECTION_CONTROL, 'Surface disinfectant low', 'Refill',
    { detects: T.STOCK_AT_OR_BELOW_MINIMUM }),

  /* ---- L. Treatment completion --------------------------------------------------- */
  c(G.TREATMENT_COMPLETION, 'Implant surgery completed', 'Schedule 7-day review',
    { detects: T.PROCEDURE_COMPLETED }),
  c(G.TREATMENT_COMPLETION, 'Extraction completed', '24-hour follow-up',
    { detects: T.PROCEDURE_COMPLETED }),
  c(G.TREATMENT_COMPLETION, 'RCT completed', 'Crown reminder',
    { detects: T.PROCEDURE_COMPLETED }),
  c(G.TREATMENT_COMPLETION, 'Crown delivered', 'Warranty documentation',
    { needs: 'a delivery event distinct from procedure completion' }),
  c(G.TREATMENT_COMPLETION, 'Denture delivered', '48-hour adjustment visit',
    { needs: 'a delivery event distinct from procedure completion' }),

  /* ---- M. Follow-up ----------------------------------------------------------------- */
  c(G.FOLLOW_UP, 'Patient reports pain', 'Urgent appointment',
    { needs: 'a channel for a patient to report a symptom — KuBi has no patient-facing input' }),
  c(G.FOLLOW_UP, 'Swelling reported', 'Doctor callback',
    { needs: 'a channel for a patient to report a symptom' }),
  c(G.FOLLOW_UP, 'Bleeding reported', 'Emergency review',
    { needs: 'a channel for a patient to report a symptom' }),
  c(G.FOLLOW_UP, 'Missed review', 'Follow-up call', { detects: T.TASK_OVERDUE }),
  c(G.FOLLOW_UP, 'Missed recall', 'Recall reminder', { detects: T.TASK_OVERDUE }),

  /* ---- N. Patient satisfaction ------------------------------------------------------ */
  c(G.SATISFACTION, 'Treatment completed', 'Feedback request',
    { detects: T.PROCEDURE_COMPLETED }),
  c(G.SATISFACTION, 'Rating below 4/5', 'Manager callback',
    { needs: 'feedback captured as a score, not as a message' }),
  c(G.SATISFACTION, 'Complaint registered', 'Incident report',
    { needs: 'a complaint intake — CMP-001 exists as a control with no event behind it' }),
  c(G.SATISFACTION, 'Complaint unresolved', 'Owner escalation',
    { action: ActionKind.ESCALATE,
      needs: 'a complaint intake, and a resolution clock running against it' }),

  /* ---- O. Staff ----------------------------------------------------------------------- */
  c(G.STAFF, 'Late arrival', 'Attendance review',
    { needs: 'check-in times compared against a roster' }),
  c(G.STAFF, 'Checklist incomplete', 'Supervisor verification', { detects: T.TASK_OVERDUE }),
  c(G.STAFF, 'Repeated checklist failure', 'Training session',
    { needs: 'a failure count per person over a window' }),
  c(G.STAFF, 'Missed sterilization', 'Incident report', { detects: T.TASK_OVERDUE }),

  /* ---- P. Compliance -------------------------------------------------------------------- */
  c(G.COMPLIANCE, 'Clinical note incomplete', 'Complete documentation',
    { detects: T.TASK_OVERDUE }),
  c(G.COMPLIANCE, 'Consent missing', 'Obtain before next procedure',
    // "Before next procedure" is a gate on the next procedure, not a reminder.
    { action: ActionKind.BLOCK, detects: T.PROCEDURE_STARTED }),
  c(G.COMPLIANCE, 'Prescription unsigned', 'Doctor signature',
    { needs: 'prescriptions held as records with a signature state' }),
  c(G.COMPLIANCE, 'Lab form missing', 'Complete documentation',
    { detects: T.LAB_CASE_RECEIVED }),

  /* ---- Q. Recall ----------------------------------------------------------------------- */
  c(G.RECALL, '6 months after scaling', 'Recall appointment',
    { needs: 'a recall clock started by a completed procedure of a given type' }),
  c(G.RECALL, '1 year after crown', 'Recall examination',
    { needs: 'a recall clock started by a completed procedure of a given type' }),
  c(G.RECALL, 'Implant review due', 'Implant maintenance visit',
    { needs: 'a recall clock started by a completed procedure of a given type' }),
  c(G.RECALL, 'Child recall due', 'Preventive visit',
    { needs: 'date of birth on the patient record, and a paediatric recall interval' }),

  /* ---- R. Emergency ---------------------------------------------------------------------- */
  c(G.EMERGENCY, 'Medical emergency declared', 'Activate emergency protocol',
    { needs: 'a one-press emergency declaration, reachable from every screen' }),
  c(G.EMERGENCY, 'Syncope', 'Record vitals and event',
    { needs: 'an emergency declaration, and vitals held as numbers' }),
  c(G.EMERGENCY, 'Anaphylaxis', 'Drug administration log',
    { needs: 'an emergency declaration, and a drug administration record' }),
  c(G.EMERGENCY, 'Needle-stick injury', 'Exposure protocol',
    { needs: 'a staff incident intake — INC-001 exists as a control with no event behind it' }),
  c(G.EMERGENCY, 'Fire alarm', 'Evacuation checklist',
    { needs: 'a one-press emergency declaration' }),
] as const;

/* -------------------------------------------------------------------------
 * Reading the library
 * ---------------------------------------------------------------------- */

export function conditionsIn(group: ConditionGroup): ConditionRule[] {
  return CONDITION_LIBRARY.filter((r) => r.group === group);
}

/** The eighteen groups, in the owner's order, each with its rules. */
export function theConditions(): Array<{
  letter: string; group: ConditionGroup; label: string; rules: ConditionRule[];
}> {
  return GROUP_ORDER.map((g) => ({ ...g, rules: conditionsIn(g.group) }));
}

/**
 * Rules KuBi could fire today — the condition maps onto an event the engine
 * already knows how to raise.
 */
export function detectable(): ConditionRule[] {
  return CONDITION_LIBRARY.filter((r) => r.detects !== null);
}

/**
 * Rules KuBi cannot notice at all, with what each would need.
 *
 * This is the list that matters. A condition-based system is worth exactly as
 * much as the conditions it can detect; the rest is a document.
 */
export function undetectable(): ConditionRule[] {
  return CONDITION_LIBRARY.filter((r) => r.detects === null);
}

/** Rules that stop work rather than create it. */
export function blocking(): ConditionRule[] {
  return CONDITION_LIBRARY.filter((r) => r.action === ActionKind.BLOCK);
}

/** Auto-created tasks that would land on nobody's list. */
export function unassigned(): ConditionRule[] {
  return CONDITION_LIBRARY.filter((r) => r.role === null);
}

/** What KuBi would have to learn to hold, grouped so the work is countable. */
export function missingCapabilities(): Array<{ needs: string; rules: ConditionRule[] }> {
  const by = new Map<string, ConditionRule[]>();
  for (const r of undetectable()) {
    if (!r.needs) continue;
    by.set(r.needs, [...(by.get(r.needs) ?? []), r]);
  }
  return [...by.entries()]
    .map(([needs, rules]) => ({ needs, rules }))
    .sort((a, b) => b.rules.length - a.rules.length);
}

/** The honest state, as counts rather than a score. */
export function conditionCoverage(): {
  rules: number; canDetect: number; assigned: number; blocks: number;
} {
  return {
    rules: CONDITION_LIBRARY.length,
    canDetect: detectable().length,
    assigned: CONDITION_LIBRARY.filter((r) => r.role !== null).length,
    blocks: blocking().length,
  };
}
