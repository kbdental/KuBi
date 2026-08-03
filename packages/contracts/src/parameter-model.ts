/**
 * The parameter model — five layers the owner identified as missing.
 *
 *   1. Dependency graph   which parameters cannot succeed until others do
 *   2. Weighting          attendance does not equal sterilisation
 *   3. Evidence confidence  a photo is not a system record
 *   4. Ownership          one accountable owner each, or nobody is accountable
 *   5. Health and trend   direction matters more than the number
 *
 * Together these are what turn a grade into something meaningful. Bronze and
 * Gold are arithmetic on a flat list of parameters; Bronze and Gold weighted by
 * patient safety, blocked by an unmet dependency, and discounted for weak
 * evidence are a statement about a clinic.
 *
 * Nothing here is invented where the frozen matrix already answers it. Where
 * the matrix is genuinely split, the value is DECISION_REQUIRED and stays that
 * way — non-negotiable 4.
 */
import { Parameter, RoleCode } from './enums.js';
import type { EvidenceType } from './enums.js';

// ─────────────────────────────────────────────────────────────────────────
// Layer 2 — weighting
// ─────────────────────────────────────────────────────────────────────────

/**
 * What a parameter is *for*. The weight attaches to the class, not to the
 * parameter, so adding a seventeenth parameter cannot silently dilute patient
 * safety — it joins a class whose share is already fixed.
 */
export const WeightClass = {
  PATIENT_SAFETY: 'PATIENT_SAFETY',
  CLINICAL_QUALITY: 'CLINICAL_QUALITY',
  PATIENT_EXPERIENCE: 'PATIENT_EXPERIENCE',
  OPERATIONS: 'OPERATIONS',
  BUSINESS: 'BUSINESS',
} as const;
export type WeightClass = (typeof WeightClass)[keyof typeof WeightClass];

/** Owner's allocation, 3 August 2026. Must total 100 — asserted in tests. */
export const CLASS_WEIGHT: Record<WeightClass, number> = {
  PATIENT_SAFETY: 40,
  CLINICAL_QUALITY: 25,
  PATIENT_EXPERIENCE: 15,
  OPERATIONS: 10,
  BUSINESS: 10,
};

// ─────────────────────────────────────────────────────────────────────────
// Layer 3 — evidence confidence
// ─────────────────────────────────────────────────────────────────────────

/**
 * How much a piece of evidence is worth.
 *
 * The point is not to rank paperwork. It is that two clinics can both report
 * 100% compliance while one proves it with autoclave printouts and the other
 * with somebody ticking a box, and a grade that cannot tell them apart is
 * worthless. Compliance is discounted by the confidence of the evidence behind
 * it.
 *
 * A consequence worth stating: raising a parameter's grade by moving from
 * CONFIRMATION to VERIFICATION is a real improvement, and the model rewards it.
 * That is the intended incentive.
 */
export const EVIDENCE_CONFIDENCE: Record<EvidenceType, number> = {
  /** The system observed it. Nobody can mistype it or do it later. */
  SYSTEM: 100,
  /** A second competent person checked the work. */
  VERIFICATION: 95,
  /** A named person put their name to it, accountably. */
  SIGNATURE: 90,
  /** A reading — a temperature, a pressure, a count. Typed, so mistypeable. */
  VALUE: 80,
  /** A photo or document. Real, but it proves a moment, not a practice. */
  ATTACHMENT: 75,
  /** Somebody ticked a box. The weakest thing that still counts as evidence. */
  CONFIRMATION: 60,
};

// ─────────────────────────────────────────────────────────────────────────
// Layer 5 — health and trend
// ─────────────────────────────────────────────────────────────────────────

/**
 * Direction, which the owner rightly says matters more than the score.
 *
 * 92% and falling for twelve days is a worse clinic than 81% and climbing, and
 * a dashboard that shows only the number cannot say so. NEEDS_INTERVENTION is
 * deliberately separate from DECLINING: declining is a trend, intervention is a
 * verdict, and one should not quietly become the other.
 */
export const HealthTrend = {
  IMPROVING: 'IMPROVING',
  STABLE: 'STABLE',
  DECLINING: 'DECLINING',
  NEEDS_INTERVENTION: 'NEEDS_INTERVENTION',
  /** Not enough history yet. Never drawn as stable — see non-negotiable 2. */
  UNKNOWN: 'UNKNOWN',
} as const;
export type HealthTrend = (typeof HealthTrend)[keyof typeof HealthTrend];

export interface ParameterHealth {
  parameter: Parameter;
  /** Null when there is nothing to measure. Never rendered as 0. */
  score: number | null;
  trend: HealthTrend;
  /** Consecutive days moving in that direction. Null when trend is UNKNOWN. */
  days: number | null;
  /** Mean evidence confidence behind the score, 0–100. */
  confidence: number | null;
  /** Dependencies not currently met. A parameter cannot outrank its inputs. */
  blockedBy: Parameter[];
}

// ─────────────────────────────────────────────────────────────────────────
// Layers 1 and 4 — the graph, and ownership
// ─────────────────────────────────────────────────────────────────────────

/** Where an owner could not be read off the matrix without a decision. */
export const DECISION_REQUIRED = 'DECISION_REQUIRED' as const;
export type OwnerOrDecision = RoleCode | typeof DECISION_REQUIRED;

export interface ParameterSpec {
  id: Parameter;
  weightClass: WeightClass;
  /**
   * ONE accountable owner. Read from the frozen matrix's Accountable Owner
   * column where it is unambiguous; DECISION_REQUIRED where the matrix itself
   * is split, which is a question for the owner and not for this file.
   */
  owner: OwnerOrDecision;
  /**
   * Parameters that must succeed before this one can. Not "related to" —
   * causally upstream. A room cannot be ready if the clinic never opened;
   * documentation cannot be complete for a journey that never happened.
   */
  dependsOn: Parameter[];
}

/**
 * The sixteen, fully specified.
 *
 * The spine the owner drew — opening → room → journey → documentation →
 * experience — is here, with the joins that make it real: sterilisation and
 * stock feed room readiness, because a clean chair with no sterile kit is not
 * a ready room.
 */
export const PARAMETER_SPEC: Record<Parameter, ParameterSpec> = {
  ATTENDANCE_LEAVE: {
    id: Parameter.ATTENDANCE_LEAVE,
    weightClass: WeightClass.OPERATIONS,
    owner: RoleCode.CLINIC_HEAD,
    dependsOn: [],
  },
  MAINTENANCE_UTILITIES: {
    id: Parameter.MAINTENANCE_UTILITIES,
    weightClass: WeightClass.OPERATIONS,
    owner: RoleCode.CLINIC_HEAD,
    dependsOn: [],
  },
  CLEANLINESS: {
    id: Parameter.CLEANLINESS,
    weightClass: WeightClass.PATIENT_EXPERIENCE,
    owner: RoleCode.CLINIC_MANAGER,
    dependsOn: [],
  },
  INFECTION_CONTROL: {
    id: Parameter.INFECTION_CONTROL,
    weightClass: WeightClass.PATIENT_SAFETY,
    owner: RoleCode.CLINICAL_DIRECTOR,
    dependsOn: [Parameter.MAINTENANCE_UTILITIES],
  },
  INVENTORY_IMPLANTS: {
    id: Parameter.INVENTORY_IMPLANTS,
    weightClass: WeightClass.OPERATIONS,
    owner: RoleCode.CLINIC_MANAGER,
    dependsOn: [],
  },
  SAFETY_EMERGENCY: {
    id: Parameter.SAFETY_EMERGENCY,
    weightClass: WeightClass.PATIENT_SAFETY,
    owner: RoleCode.CLINIC_HEAD,
    dependsOn: [Parameter.INVENTORY_IMPLANTS],
  },
  // The spine begins here.
  OPENING_READINESS: {
    id: Parameter.OPENING_READINESS,
    weightClass: WeightClass.OPERATIONS,
    owner: RoleCode.CLINIC_MANAGER,
    dependsOn: [Parameter.ATTENDANCE_LEAVE, Parameter.MAINTENANCE_UTILITIES],
  },
  ROOM_CHAIR_READINESS: {
    id: Parameter.ROOM_CHAIR_READINESS,
    weightClass: WeightClass.PATIENT_SAFETY,
    owner: RoleCode.CLINIC_MANAGER,
    // A clean chair with no sterile kit is not a ready room, and neither is a
    // ready room with no stock. Both joins are load-bearing.
    dependsOn: [
      Parameter.OPENING_READINESS,
      Parameter.CLEANLINESS,
      Parameter.INFECTION_CONTROL,
      Parameter.INVENTORY_IMPLANTS,
    ],
  },
  APPOINTMENT_CONTROL: {
    id: Parameter.APPOINTMENT_CONTROL,
    weightClass: WeightClass.PATIENT_EXPERIENCE,
    owner: RoleCode.CLINIC_MANAGER,
    dependsOn: [],
  },
  PATIENT_JOURNEY: {
    id: Parameter.PATIENT_JOURNEY,
    weightClass: WeightClass.CLINICAL_QUALITY,
    owner: RoleCode.CLINICAL_DIRECTOR,
    dependsOn: [Parameter.ROOM_CHAIR_READINESS, Parameter.APPOINTMENT_CONTROL],
  },
  CLINICAL_DOCUMENTATION: {
    id: Parameter.CLINICAL_DOCUMENTATION,
    weightClass: WeightClass.CLINICAL_QUALITY,
    owner: RoleCode.CLINICAL_DIRECTOR,
    dependsOn: [Parameter.PATIENT_JOURNEY],
  },
  SURGICAL_HIGH_RISK: {
    id: Parameter.SURGICAL_HIGH_RISK,
    weightClass: WeightClass.PATIENT_SAFETY,
    owner: RoleCode.CLINICAL_DIRECTOR,
    dependsOn: [
      Parameter.PATIENT_JOURNEY,
      Parameter.CLINICAL_DOCUMENTATION,
      Parameter.SAFETY_EMERGENCY,
      Parameter.INFECTION_CONTROL,
    ],
  },
  LABORATORY: {
    id: Parameter.LABORATORY,
    weightClass: WeightClass.CLINICAL_QUALITY,
    owner: RoleCode.CLINIC_MANAGER,
    dependsOn: [Parameter.PATIENT_JOURNEY],
  },
  FOLLOWUP_EXPERIENCE: {
    id: Parameter.FOLLOWUP_EXPERIENCE,
    weightClass: WeightClass.PATIENT_EXPERIENCE,
    owner: RoleCode.CLINICAL_DIRECTOR,
    dependsOn: [Parameter.PATIENT_JOURNEY, Parameter.CLINICAL_DOCUMENTATION],
  },
  STAFF_CONDUCT: {
    id: Parameter.STAFF_CONDUCT,
    weightClass: WeightClass.OPERATIONS,
    // Matrix is split three ways across three activities — Clinic Head, Owner,
    // and "Owner/Clinic Head". That is not a plurality, it is an unmade
    // decision, and it stays one.
    owner: DECISION_REQUIRED,
    dependsOn: [Parameter.ATTENDANCE_LEAVE],
  },
  QUALITY_CAPA: {
    id: Parameter.QUALITY_CAPA,
    weightClass: WeightClass.CLINICAL_QUALITY,
    owner: RoleCode.CLINIC_HEAD,
    // Quality reads from everything, but depends on nothing: the loop must
    // keep running precisely when the rest of the clinic is failing.
    dependsOn: [],
  },
};

/** Parameters that cannot succeed until this one does. The graph, downward. */
export function dependents(p: Parameter): Parameter[] {
  return (Object.keys(PARAMETER_SPEC) as Parameter[])
    .filter((k) => PARAMETER_SPEC[k].dependsOn.includes(p));
}

/**
 * Everything upstream of a parameter, transitively.
 *
 * Iterative rather than recursive, and it tracks what it has seen: a cycle
 * would otherwise hang the request rather than fail it. The cycle-free property
 * is asserted in tests, but a graph that is edited by hand should not be able
 * to take the server down between the edit and the test run.
 */
export function upstreamOf(p: Parameter): Parameter[] {
  const seen = new Set<Parameter>();
  const queue = [...PARAMETER_SPEC[p].dependsOn];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...PARAMETER_SPEC[next].dependsOn);
  }
  return [...seen];
}

/**
 * A parameter's share of the whole grade.
 *
 * Its class's weight, split evenly between the parameters in that class. So
 * infection control and room readiness each carry half of patient safety's 40,
 * and attendance carries a quarter of operations' 10 — which is the owner's
 * point: attendance is not sterilisation.
 */
export function weightOf(p: Parameter): number {
  const cls = PARAMETER_SPEC[p].weightClass;
  const inClass = (Object.keys(PARAMETER_SPEC) as Parameter[])
    .filter((k) => PARAMETER_SPEC[k].weightClass === cls).length;
  return CLASS_WEIGHT[cls] / inClass;
}

/**
 * Weight classes with no parameters behind them yet.
 *
 * BUSINESS is empty today — Business Growth is Phase 4 — which means ten points
 * of the grade are currently **unearnable by anybody**. That is a fact about
 * the product and it has to be said, not smoothed away:
 *
 *   - Silently redistributing the ten would make today's grades incomparable
 *     with next year's, and a clinic's score would jump on a release day
 *     without anything changing at the clinic.
 *   - Silently keeping them would cap every clinic at 90 and make a "90 for
 *     Gold" threshold unreachable, which nobody would notice until the first
 *     clinic tried.
 *
 * So the model reports both numbers and refuses to pick for you. A grade is
 * computed over `attainableWeight()`, and the UI says which classes are not
 * yet gradeable — principle 3, say the gap out loud.
 */
export function unattainableClasses(): WeightClass[] {
  const used = new Set((Object.keys(PARAMETER_SPEC) as Parameter[])
    .map((k) => PARAMETER_SPEC[k].weightClass));
  return (Object.keys(CLASS_WEIGHT) as WeightClass[]).filter((c) => !used.has(c));
}

/** The share of the grade a clinic can actually earn today. 90, not 100. */
export function attainableWeight(): number {
  return 100 - unattainableClasses().reduce((sum, c) => sum + CLASS_WEIGHT[c], 0);
}
