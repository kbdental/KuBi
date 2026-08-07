/**
 * The seven objectives, in the owner's order — and the order is the point.
 *
 * Specification §2.1. This is not a mission statement pinned to a wall; it is
 * the tie-breaker the decision engine uses when two pieces of work compete for
 * the same person at the same minute. The one serving the lower-numbered
 * objective wins.
 *
 * That single rule replaces every priority field, severity enum and "urgent"
 * flag the system would otherwise accumulate — each of which would be somebody
 * guessing at what the clinic values, in a different file, on a different day.
 * Here it is written once and it is the owner's.
 */

export const Objective = {
  /** 1. No unsafe treatment starts. Ever. */
  PATIENT_SAFE: 'PATIENT_SAFE',
  /** 2. Nobody waits without a reason somebody knows. */
  PATIENT_HAPPY: 'PATIENT_HAPPY',
  /** 3. The clinical work is done, and done well. */
  TREATMENT_SUCCESSFUL: 'TREATMENT_SUCCESSFUL',
  /** 4. Resources are used; nobody idles beside a queue. */
  CLINIC_EFFICIENT: 'CLINIC_EFFICIENT',
  /** 5. Work done is work paid for. */
  MONEY_COLLECTED: 'MONEY_COLLECTED',
  /** 6. The note, the consent, the batch log, the audit trail. */
  RECORDS_COMPLETE: 'RECORDS_COMPLETE',
  /** 7. The relationship outlives the visit. */
  PATIENT_RECALLED: 'PATIENT_RECALLED',
} as const;
export type Objective = (typeof Objective)[keyof typeof Objective];

/**
 * The order, as a list. Index + 1 is the rank.
 *
 * Deliberately a list rather than a number on each entry: a rank stored per
 * objective can be edited to two 3s, and then the tie-break is silently
 * undefined. A list cannot hold a duplicate position.
 */
export const OBJECTIVE_ORDER: readonly Objective[] = [
  Objective.PATIENT_SAFE,
  Objective.PATIENT_HAPPY,
  Objective.TREATMENT_SUCCESSFUL,
  Objective.CLINIC_EFFICIENT,
  Objective.MONEY_COLLECTED,
  Objective.RECORDS_COMPLETE,
  Objective.PATIENT_RECALLED,
];

/** 1 for the most important. Never 0, so a missing objective cannot pass as one. */
export function rank(o: Objective): number {
  const i = OBJECTIVE_ORDER.indexOf(o);
  if (i < 0) throw new Error(`${o} is not one of the seven objectives`);
  return i + 1;
}

/** What a person is told this is for, in the words the owner used. */
export const OBJECTIVE_WORD: Record<Objective, string> = {
  PATIENT_SAFE: 'keeping the patient safe',
  PATIENT_HAPPY: 'not keeping the patient waiting',
  TREATMENT_SUCCESSFUL: 'getting the treatment right',
  CLINIC_EFFICIENT: 'keeping the clinic moving',
  MONEY_COLLECTED: 'collecting what is owed',
  RECORDS_COMPLETE: 'completing the record',
  PATIENT_RECALLED: 'bringing the patient back',
};
