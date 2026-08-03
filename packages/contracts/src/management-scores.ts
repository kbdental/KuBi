/**
 * The eight management scores.
 *
 * The owner's §7, and the layer that was missing: sixteen control parameters
 * roll upward into eight scores, and those eight are what an owner reads.
 * Without them the owner dashboard is a different set of numbers invented at
 * the screen, which is exactly what it had become.
 *
 * The rule that makes this honest, and the one most roll-ups get wrong:
 *
 *   **GREY is not zero.** A parameter with nothing to measure today is
 *   excluded from its score, not averaged in as an absence. A clinic that ran
 *   no surgery today has not failed surgical compliance. Averaging a GREY into
 *   a score fabricates a number out of a silence, and every dashboard that
 *   does it is quietly lying on quiet days.
 *
 * And its consequence: a score whose parameters are all GREY is `null`, and
 * renders as "nothing to measure". Never 0%, never 100%.
 */
import { Parameter } from './enums.js';

export const ManagementScore = {
  CLINIC_READINESS: 'CLINIC_READINESS',
  PATIENT_CARE_COMPLIANCE: 'PATIENT_CARE_COMPLIANCE',
  CLINICAL_DOCUMENTATION: 'CLINICAL_DOCUMENTATION',
  INFECTION_CONTROL: 'INFECTION_CONTROL',
  APPOINTMENT_EFFICIENCY: 'APPOINTMENT_EFFICIENCY',
  LAB_EFFICIENCY: 'LAB_EFFICIENCY',
  INVENTORY_READINESS: 'INVENTORY_READINESS',
  TEAM_COMPLIANCE: 'TEAM_COMPLIANCE',
} as const;
export type ManagementScore = (typeof ManagementScore)[keyof typeof ManagementScore];

export interface ScoreSpec {
  id: ManagementScore;
  label: string;
  /** How it is measured, in the owner's own words from the §7 table. */
  measure: string;
  /** The control parameters that roll into it. */
  parameters: Parameter[];
}

/**
 * The eight, with the measure taken verbatim from the specification table so
 * that what the screen claims and what the owner asked for cannot drift apart.
 */
export const SCORE_SPEC: Record<ManagementScore, ScoreSpec> = {
  CLINIC_READINESS: {
    id: ManagementScore.CLINIC_READINESS,
    label: 'Clinic readiness',
    measure: '% opening requirements completed before first patient',
    parameters: [
      Parameter.OPENING_READINESS,
      Parameter.ROOM_CHAIR_READINESS,
      Parameter.CLEANLINESS,
      Parameter.MAINTENANCE_UTILITIES,
    ],
  },
  PATIENT_CARE_COMPLIANCE: {
    id: ManagementScore.PATIENT_CARE_COMPLIANCE,
    label: 'Patient care compliance',
    measure: '% required patient protocols completed',
    parameters: [
      Parameter.PATIENT_JOURNEY,
      Parameter.SURGICAL_HIGH_RISK,
      Parameter.FOLLOWUP_EXPERIENCE,
    ],
  },
  CLINICAL_DOCUMENTATION: {
    id: ManagementScore.CLINICAL_DOCUMENTATION,
    label: 'Clinical documentation',
    measure: '% cases with complete required records',
    parameters: [Parameter.CLINICAL_DOCUMENTATION],
  },
  INFECTION_CONTROL: {
    id: ManagementScore.INFECTION_CONTROL,
    label: 'Infection control',
    measure: 'Sterilisation + PPE + biomedical waste compliance',
    parameters: [Parameter.INFECTION_CONTROL, Parameter.SAFETY_EMERGENCY],
  },
  APPOINTMENT_EFFICIENCY: {
    id: ManagementScore.APPOINTMENT_EFFICIENCY,
    label: 'Appointment efficiency',
    measure: 'Confirmation, cancellation, no-show, utilisation',
    parameters: [Parameter.APPOINTMENT_CONTROL],
  },
  LAB_EFFICIENCY: {
    id: ManagementScore.LAB_EFFICIENCY,
    label: 'Lab efficiency',
    measure: 'On-time cases, pending cases, remakes, QC',
    parameters: [Parameter.LABORATORY],
  },
  INVENTORY_READINESS: {
    id: ManagementScore.INVENTORY_READINESS,
    label: 'Inventory readiness',
    measure: 'Stock-outs, reorder compliance, implant availability',
    parameters: [Parameter.INVENTORY_IMPLANTS],
  },
  TEAM_COMPLIANCE: {
    id: ManagementScore.TEAM_COMPLIANCE,
    label: 'Team compliance',
    measure: 'Attendance + task completion + SOP adherence + training',
    parameters: [
      Parameter.ATTENDANCE_LEAVE,
      Parameter.STAFF_CONDUCT,
      Parameter.QUALITY_CAPA,
    ],
  },
};

/** Display order: readiness first, because it gates the day. */
export const SCORE_ORDER: ManagementScore[] = [
  ManagementScore.CLINIC_READINESS,
  ManagementScore.PATIENT_CARE_COMPLIANCE,
  ManagementScore.CLINICAL_DOCUMENTATION,
  ManagementScore.INFECTION_CONTROL,
  ManagementScore.APPOINTMENT_EFFICIENCY,
  ManagementScore.LAB_EFFICIENCY,
  ManagementScore.INVENTORY_READINESS,
  ManagementScore.TEAM_COMPLIANCE,
];

/** The four management outcomes. GREY is the one that matters — see above. */
export const Outcome = {
  GREEN: 'GREEN',
  AMBER: 'AMBER',
  RED: 'RED',
  GREY: 'GREY',
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

/**
 * Score to outcome.
 *
 * RED is forced by any patient-safety failure regardless of the percentage: a
 * clinic at 97% with an unverified autoclave cycle is not green, and a
 * threshold that says otherwise is the reason people stop trusting dashboards.
 */
export function outcomeOf(pct: number | null, hasSafetyFailure = false): Outcome {
  if (hasSafetyFailure) return Outcome.RED;
  if (pct === null) return Outcome.GREY;
  return pct >= 95 ? Outcome.GREEN : pct >= 85 ? Outcome.AMBER : Outcome.RED;
}

/**
 * Roll parameter results up into one score.
 *
 * Null-in means "nothing to measure" and is dropped, not counted as zero. All
 * null in means null out.
 */
export function rollUp(values: Array<number | null>): number | null {
  const real = values.filter((v): v is number => v !== null);
  if (real.length === 0) return null;
  return Math.round(real.reduce((a, b) => a + b, 0) / real.length);
}

/**
 * The single Clinic Operational Score.
 *
 * The average of the eight that have something to say — again excluding GREY,
 * for the same reason.
 */
export function operationalScore(scores: Array<number | null>): number | null {
  return rollUp(scores);
}

/** Every parameter must roll into exactly one score, or it is unmanaged. */
export function scoreFor(p: Parameter): ManagementScore | null {
  return SCORE_ORDER.find((s) => SCORE_SPEC[s].parameters.includes(p)) ?? null;
}
