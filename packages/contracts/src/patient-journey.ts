/**
 * The patient-triggered task library — thirteen stages, ninety-six tasks.
 *
 * The other half of the operating standard. The daily library is what the
 * clock raises; this is what a patient raises. Between them they are the whole
 * of what happens in a clinic, which is why `day-run.ts` deliberately refuses
 * to put EVERY_PATIENT work on a timeline: a patient arriving is not an event
 * the clock can predict.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The thing this library mostly says is "not decided yet"
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Stages 1 and 2 arrived with a Responsible and a KPI against every task.
 * Stages 3 to 13 arrived with those columns empty — eighty-two of the
 * ninety-six tasks have no owner and no standard.
 *
 * They are recorded as null, not guessed. Constitution rule 4: a
 * DECISION_REQUIRED row carries no value. Filling in a plausible role would
 * be the single most damaging thing this file could do — it would look
 * complete, it would survive review, and the first time a task went unowned
 * in a real clinic the system would name the wrong person.
 *
 * So the library's most useful function today is `needsOwner()`. It is a
 * worklist for the owner, not a defect in the transcription.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Billing
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Stage 10 exists here because the owner put it here, and because they have
 * since confirmed KuBi should hold money. Nothing behind it is built: no
 * invoice, no receipt, no outstanding balance, no procedure codes. Every one
 * of those six tasks carries `covers: null`, which is honest and will stay
 * that way until the domain exists.
 */
import { RoleCode } from './enums.js';
import { ACTIVITY_LIBRARY } from './activity-library.js';

/* -------------------------------------------------------------------------
 * The thirteen stages
 *
 * One patient, start to finish. The order is the owner's and it is a genuine
 * sequence, not a grouping: consent (4) cannot precede identity (4), billing
 * (10) cannot precede the procedure (8), and a case cannot complete (13)
 * before its follow-ups (12).
 * ---------------------------------------------------------------------- */

export const Stage = {
  BOOKED: 'BOOKED',
  ARRIVES: 'ARRIVES',
  BEFORE_SEATING: 'BEFORE_SEATING',
  SEATED: 'SEATED',
  DIAGNOSIS: 'DIAGNOSIS',
  PLANNING: 'PLANNING',
  BEFORE_PROCEDURE: 'BEFORE_PROCEDURE',
  DURING_PROCEDURE: 'DURING_PROCEDURE',
  AFTER_PROCEDURE: 'AFTER_PROCEDURE',
  BILLING: 'BILLING',
  EXIT: 'EXIT',
  FOLLOW_UP: 'FOLLOW_UP',
  COMPLETION: 'COMPLETION',
} as const;
export type Stage = (typeof Stage)[keyof typeof Stage];

export const STAGE_ORDER: readonly Stage[] = [
  Stage.BOOKED, Stage.ARRIVES, Stage.BEFORE_SEATING, Stage.SEATED,
  Stage.DIAGNOSIS, Stage.PLANNING, Stage.BEFORE_PROCEDURE, Stage.DURING_PROCEDURE,
  Stage.AFTER_PROCEDURE, Stage.BILLING, Stage.EXIT, Stage.FOLLOW_UP,
  Stage.COMPLETION,
] as const;

export const STAGE_LABEL: Record<Stage, string> = {
  BOOKED: 'Appointment booked',
  ARRIVES: 'Patient arrives',
  BEFORE_SEATING: 'Before seating the patient',
  SEATED: 'Patient seated',
  DIAGNOSIS: 'Diagnosis',
  PLANNING: 'Treatment planning',
  BEFORE_PROCEDURE: 'Before the procedure',
  DURING_PROCEDURE: 'During the procedure',
  AFTER_PROCEDURE: 'Immediately after the procedure',
  BILLING: 'Billing',
  EXIT: 'Patient exit',
  FOLLOW_UP: 'Follow-up',
  COMPLETION: 'Case completion',
};

export interface PatientTask {
  id: string;
  stage: Stage;
  /** The owner's wording, unedited. */
  task: string;
  /** Null means nobody has decided. Never guessed. */
  role: RoleCode | null;
  /** Null means no standard has been set yet. Never invented. */
  kpi: string | null;
  /** The frozen matrix control that governs it, or null. */
  covers: string | null;
}

/** Shorthand: stage, task, role, kpi, covers. */
function t(
  stage: Stage, n: number, task: string,
  role: RoleCode | null = null, kpi: string | null = null, covers: string | null = null,
): PatientTask {
  return { id: `PJ-${stage}-${n}`, stage, task, role, kpi, covers };
}

const R = RoleCode.RECEPTION;
const A = RoleCode.DENTAL_ASSISTANT;

export const PATIENT_JOURNEY: readonly PatientTask[] = [
  /* ---- 1. Appointment booked — fully specified by the owner ------------ */
  t(Stage.BOOKED, 1, 'Verify patient details', R, '100%', 'APT-004'),
  t(Stage.BOOKED, 2, 'Verify doctor availability', R, 'Before confirmation'),
  t(Stage.BOOKED, 3, 'Allocate chair', R, 'Before appointment'),
  t(Stage.BOOKED, 4, 'Send appointment confirmation', R, 'Within 5 minutes', 'APT-001'),
  t(Stage.BOOKED, 5, 'Share clinic location', R, '100% new patients'),
  t(Stage.BOOKED, 6, 'Share pre-appointment instructions', R, 'Applicable cases', 'CLN-007'),
  t(Stage.BOOKED, 7, 'Update appointment status', R, 'Immediately'),

  /* ---- 2. Patient arrives — fully specified by the owner --------------- */
  t(Stage.ARRIVES, 1, 'Welcome patient', R, 'Immediately'),
  t(Stage.ARRIVES, 2, 'Mark arrival', R, '<1 minute', 'APT-004'),
  t(Stage.ARRIVES, 3, 'Verify appointment', R, '100%', 'APT-004'),
  t(Stage.ARRIVES, 4, 'Collect pending forms', R, '100%'),
  t(Stage.ARRIVES, 5, 'Check medical history changes', R, 'Every visit', 'CLN-001'),
  t(Stage.ARRIVES, 6, 'Measure vitals (if required)', A, 'Before treatment'),
  t(Stage.ARRIVES, 7, 'Inform doctor', R, 'Immediately'),

  /* ---- 3. Before seating the patient ----------------------------------- */
  t(Stage.BEFORE_SEATING, 1, 'Prepare operatory', null, null, 'OPN-002'),
  t(Stage.BEFORE_SEATING, 2, 'Prepare treatment tray', null, null, 'CLN-005'),
  t(Stage.BEFORE_SEATING, 3, 'Prepare sterilized instruments', null, null, 'STER-005'),
  t(Stage.BEFORE_SEATING, 4, 'Prepare required materials', null, null, 'CLN-005'),
  t(Stage.BEFORE_SEATING, 5, 'Check equipment', null, null, 'EQP-001'),
  t(Stage.BEFORE_SEATING, 6, 'Prepare patient record', null, null),
  t(Stage.BEFORE_SEATING, 7, 'Load digital radiographs', null, null, 'CLN-004'),
  t(Stage.BEFORE_SEATING, 8, 'Open treatment template', null, null),

  /* ---- 4. Patient seated ------------------------------------------------ */
  t(Stage.SEATED, 1, 'Verify patient identity', null, null),
  t(Stage.SEATED, 2, 'Confirm treatment', null, null),
  t(Stage.SEATED, 3, 'Confirm tooth number', null, null),
  t(Stage.SEATED, 4, 'Review allergies', null, null, 'CLN-001'),
  t(Stage.SEATED, 5, 'Review medical history', null, null, 'CLN-001'),
  t(Stage.SEATED, 6, 'Explain procedure', null, null, 'CLN-002'),
  t(Stage.SEATED, 7, 'Obtain consent', null, null, 'CLN-002'),
  t(Stage.SEATED, 8, 'Take pre-operative photographs (if applicable)', null, null, 'CLN-003'),

  /* ---- 5. Diagnosis ----------------------------------------------------- */
  t(Stage.DIAGNOSIS, 1, 'Clinical examination', null, null),
  t(Stage.DIAGNOSIS, 2, 'Radiographic examination', null, null, 'CLN-004'),
  t(Stage.DIAGNOSIS, 3, 'Periodontal examination', null, null),
  t(Stage.DIAGNOSIS, 4, 'Occlusion evaluation', null, null),
  t(Stage.DIAGNOSIS, 5, 'Soft tissue examination', null, null),
  t(Stage.DIAGNOSIS, 6, 'Existing restoration evaluation', null, null),
  t(Stage.DIAGNOSIS, 7, 'Diagnosis entry', null, null, 'CLN-011'),
  t(Stage.DIAGNOSIS, 8, 'ICD coding (optional)', null, null),

  /* ---- 6. Treatment planning -------------------------------------------- */
  t(Stage.PLANNING, 1, 'Explain diagnosis', null, null),
  t(Stage.PLANNING, 2, 'Explain options', null, null, 'CLN-002'),
  t(Stage.PLANNING, 3, 'Explain risks', null, null, 'CLN-002'),
  t(Stage.PLANNING, 4, 'Explain benefits', null, null, 'CLN-002'),
  t(Stage.PLANNING, 5, 'Estimate preparation', null, null),
  t(Stage.PLANNING, 6, 'Financial discussion', null, null),
  t(Stage.PLANNING, 7, 'Obtain treatment approval', null, null),
  t(Stage.PLANNING, 8, 'Schedule appointments', null, null, 'APT-003'),

  /* ---- 7. Before the procedure ------------------------------------------ */
  t(Stage.BEFORE_PROCEDURE, 1, 'PPE verification', null, null),
  t(Stage.BEFORE_PROCEDURE, 2, 'Sterile field preparation', null, null, 'CLN-005'),
  t(Stage.BEFORE_PROCEDURE, 3, 'Instrument verification', null, null, 'STER-005'),
  t(Stage.BEFORE_PROCEDURE, 4, 'Material verification', null, null, 'CLN-005'),
  t(Stage.BEFORE_PROCEDURE, 5, 'Shade selection (if needed)', null, null),
  t(Stage.BEFORE_PROCEDURE, 6, 'Implant components verification', null, null, 'IMP-003'),
  t(Stage.BEFORE_PROCEDURE, 7, 'Laboratory work verification', null, null, 'LAB-005'),
  t(Stage.BEFORE_PROCEDURE, 8, 'Anaesthetic preparation', null, null),
  t(Stage.BEFORE_PROCEDURE, 9, 'Emergency kit availability', null, null, 'EMR-001'),

  /* ---- 8. During the procedure — common to every procedure -------------- */
  t(Stage.DURING_PROCEDURE, 1, 'Maintain asepsis', null, null),
  t(Stage.DURING_PROCEDURE, 2, 'Document materials used', null, null),
  t(Stage.DURING_PROCEDURE, 3, 'Record implant batch numbers', null, null, 'IMP-004'),
  t(Stage.DURING_PROCEDURE, 4, 'Record anaesthetic details', null, null),
  t(Stage.DURING_PROCEDURE, 5, 'Clinical photographs', null, null),
  t(Stage.DURING_PROCEDURE, 6, 'Intra-operative notes', null, null, 'CLN-011'),
  t(Stage.DURING_PROCEDURE, 7, 'Assistant checklist', null, null),
  t(Stage.DURING_PROCEDURE, 8, 'Complication recording', null, null, 'INC-001'),

  /* ---- 9. Immediately after the procedure -------------------------------- */
  t(Stage.AFTER_PROCEDURE, 1, 'Final occlusion check', null, null),
  t(Stage.AFTER_PROCEDURE, 2, 'Final polishing', null, null),
  t(Stage.AFTER_PROCEDURE, 3, 'Clinical photographs', null, null, 'CLN-009'),
  t(Stage.AFTER_PROCEDURE, 4, 'Explain post-operative instructions', null, null, 'CLN-010'),
  t(Stage.AFTER_PROCEDURE, 5, 'Prescriptions', null, null, 'CLN-010'),
  t(Stage.AFTER_PROCEDURE, 6, 'Update treatment notes', null, null, 'CLN-011'),
  t(Stage.AFTER_PROCEDURE, 7, 'Schedule review', null, null, 'FUP-004'),
  t(Stage.AFTER_PROCEDURE, 8, 'Update treatment status', null, null),

  /* ---- 10. Billing — agreed, and entirely unbuilt ------------------------ */
  t(Stage.BILLING, 1, 'Generate invoice', null, null),
  t(Stage.BILLING, 2, 'Verify procedure codes', null, null),
  t(Stage.BILLING, 3, 'Verify materials', null, null),
  t(Stage.BILLING, 4, 'Collect payment', null, null),
  t(Stage.BILLING, 5, 'Generate receipt', null, null),
  t(Stage.BILLING, 6, 'Update outstanding balance', null, null),

  /* ---- 11. Patient exit --------------------------------------------------- */
  t(Stage.EXIT, 1, 'Schedule next appointment', null, null, 'APT-003'),
  t(Stage.EXIT, 2, 'Provide instructions', null, null, 'CLN-010'),
  t(Stage.EXIT, 3, 'Deliver medicines', null, null),
  t(Stage.EXIT, 4, 'Provide reports', null, null),
  t(Stage.EXIT, 5, 'Provide warranty card (implant/crown)', null, null),
  t(Stage.EXIT, 6, 'Thank patient', null, null),

  /* ---- 12. Follow-up ------------------------------------------------------ */
  t(Stage.FOLLOW_UP, 1, 'Same-day follow-up (major surgery)', null, null, 'FUP-001'),
  t(Stage.FOLLOW_UP, 2, '24-hour follow-up', null, null, 'FUP-002'),
  t(Stage.FOLLOW_UP, 3, '3-day follow-up', null, null, 'FUP-004'),
  t(Stage.FOLLOW_UP, 4, '7-day follow-up', null, null, 'FUP-004'),
  t(Stage.FOLLOW_UP, 5, 'Suture removal reminder', null, null, 'FUP-001'),
  t(Stage.FOLLOW_UP, 6, 'Review appointment', null, null, 'FUP-004'),
  t(Stage.FOLLOW_UP, 7, 'Complication documentation', null, null, 'INC-001'),

  /* ---- 13. Case completion ------------------------------------------------ */
  t(Stage.COMPLETION, 1, 'Final photographs', null, null, 'CLN-009'),
  t(Stage.COMPLETION, 2, 'Satisfaction feedback', null, null),
  t(Stage.COMPLETION, 3, 'Google review request', null, null, 'FUP-005'),
  t(Stage.COMPLETION, 4, 'Before-after gallery permission', null, null),
  t(Stage.COMPLETION, 5, 'Recall scheduling', null, null, 'APT-003'),
  t(Stage.COMPLETION, 6, 'Close treatment plan', null, null),
] as const;

/* -------------------------------------------------------------------------
 * Reading the journey
 * ---------------------------------------------------------------------- */

export function tasksAt(stage: Stage): PatientTask[] {
  return PATIENT_JOURNEY.filter((p) => p.stage === stage);
}

/** The journey as stages, in order, each with its tasks. */
export function theJourney(): Array<{ stage: Stage; label: string; tasks: PatientTask[] }> {
  return STAGE_ORDER.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    tasks: tasksAt(stage),
  }));
}

/**
 * The worklist for the owner: tasks with nobody assigned.
 *
 * This is the function this library exists for today. Eighty-two of
 * ninety-six. Until it shrinks, most of a patient visit is described but not
 * owned, and an unowned task cannot escalate to anybody.
 */
export function needsOwner(): PatientTask[] {
  return PATIENT_JOURNEY.filter((p) => p.role === null);
}

/** Tasks with an owner but no standard to hold them to. */
export function needsStandard(): PatientTask[] {
  return PATIENT_JOURNEY.filter((p) => p.kpi === null);
}

/** Tasks with no control behind them — the v3.0 proposal list for the journey. */
export function ungovernedTasks(): PatientTask[] {
  return PATIENT_JOURNEY.filter((p) => p.covers === null);
}

/** Every activity id the journey leans on, deduplicated. */
export function journeyActivities(): string[] {
  return [...new Set(
    PATIENT_JOURNEY.map((p) => p.covers).filter((c): c is string => c !== null),
  )].sort();
}

/** True when the id names a real activity in the frozen library. */
export function journeyRefersToRealActivities(): boolean {
  return journeyActivities().every((id) => ACTIVITY_LIBRARY.some((a) => a.id === id));
}

/** How complete the journey specification is, as counts rather than a score. */
export function journeyCompleteness(): {
  tasks: number; owned: number; measured: number; governed: number;
} {
  return {
    tasks: PATIENT_JOURNEY.length,
    owned: PATIENT_JOURNEY.filter((p) => p.role !== null).length,
    measured: PATIENT_JOURNEY.filter((p) => p.kpi !== null).length,
    governed: PATIENT_JOURNEY.filter((p) => p.covers !== null).length,
  };
}
