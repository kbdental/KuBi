/**
 * The audit engine — module 7.
 *
 * Closes the chain that was specified and never finished:
 *
 *   Task → Perform → Evidence → Verification → Escalation → **Audit**
 *
 * An audit trail is not a log. A log is for engineers and may be pruned; an
 * audit trail is evidence, and three properties follow from that:
 *
 * 1. **Append-only.** There is no edit and no delete. A correction is a new
 *    entry that supersedes an old one, and both survive. An audit trail you
 *    can tidy is an audit trail worth nothing.
 * 2. **It records who, not just what.** "Completed" is useless; "completed by
 *    Priya at 09:47, verified by Anita at 09:52" is evidence.
 * 3. **It records refusals.** Most systems log what happened. The interesting
 *    entries are the ones where the system said no — a gate that blocked, an
 *    override that was requested, a check that was sent back.
 */

export const AuditAction = {
  RAISED: 'RAISED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  EVIDENCE_RECORDED: 'EVIDENCE_RECORDED',
  VERIFIED: 'VERIFIED',
  SENT_BACK: 'SENT_BACK',
  /** The system refused. The most useful entries in the trail. */
  BLOCKED: 'BLOCKED',
  OVERRIDE_REQUESTED: 'OVERRIDE_REQUESTED',
  OVERRIDE_GRANTED: 'OVERRIDE_GRANTED',
  ESCALATED: 'ESCALATED',
  DEVIATION_RAISED: 'DEVIATION_RAISED',
  CAPA_OPENED: 'CAPA_OPENED',
  CAPA_CLOSED: 'CAPA_CLOSED',
  NOT_APPLICABLE_CLAIMED: 'NOT_APPLICABLE_CLAIMED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Which of these are refusals, for the "what did the system stop" view. */
export const REFUSALS: readonly AuditAction[] = [
  AuditAction.BLOCKED, AuditAction.SENT_BACK, AuditAction.OVERRIDE_REQUESTED,
];

export interface AuditEntry {
  id: string;
  /** ISO 8601, from the injected clock. Never `new Date()`. */
  at: string;
  action: AuditAction;
  /** The activity this traces to. Constitution rule 5 — always present. */
  activityId: string;
  /** What it was about, in the words a person would use. */
  subject: string;
  /** Who did it. Never blank: "the system" is a named actor. */
  by: string;
  /** Who checked, where the action was a verification. */
  verifiedBy?: string;
  /** The evidence class recorded at this step. */
  evidence?: string;
  /** What the evidence actually said — a reading, a filename, a comment. */
  evidenceValue?: string;
  /** Set when this entry records a departure from the standard. */
  deviation?: string;
  /** Set when the deviation obliged a CAPA. */
  capaRef?: string;
  /** Set when this entry supersedes an earlier one — never overwrites it. */
  supersedes?: string;
}

/**
 * Append an entry.
 *
 * Takes the existing trail and returns a new one. There is deliberately no
 * `update` and no `remove`: the only operation an audit trail supports is
 * adding to it.
 */
export function append(trail: readonly AuditEntry[], entry: AuditEntry): AuditEntry[] {
  return [...trail, entry];
}

/**
 * Correct an earlier entry.
 *
 * The old entry stays. The new one points at it. Anyone reading the trail sees
 * both the mistake and the correction, which is the entire point — a trail
 * that shows only the corrected value cannot be trusted about anything.
 */
export function supersede(
  trail: readonly AuditEntry[], oldId: string, correction: AuditEntry,
): AuditEntry[] {
  if (!trail.some((e) => e.id === oldId)) {
    throw new Error(`Cannot supersede ${oldId}: it is not in the trail`);
  }
  return append(trail, { ...correction, supersedes: oldId });
}

/** Everything that happened to one activity, oldest first. */
export function trailFor(trail: readonly AuditEntry[], activityId: string): AuditEntry[] {
  return trail.filter((e) => e.activityId === activityId);
}

/** Every time the system refused. The view an auditor actually wants. */
export function refusals(trail: readonly AuditEntry[]): AuditEntry[] {
  return trail.filter((e) => REFUSALS.includes(e.action));
}

/** Every departure from the standard, with whether a CAPA followed. */
export function deviations(trail: readonly AuditEntry[]): AuditEntry[] {
  return trail.filter((e) => e.deviation !== undefined);
}

/**
 * Deviations that never became a CAPA.
 *
 * The single most useful audit query there is, and the one no clinic can
 * answer today: a departure from the standard that nobody turned into an
 * action is how the same failure arrives again in March.
 */
export function deviationsWithoutCapa(trail: readonly AuditEntry[]): AuditEntry[] {
  const withCapa = new Set(
    trail.filter((e) => e.capaRef !== undefined).map((e) => e.activityId),
  );
  return deviations(trail).filter((e) => !withCapa.has(e.activityId));
}

/** Whether an activity was verified by somebody other than whoever did it. */
export function independentlyVerified(
  trail: readonly AuditEntry[], activityId: string,
): boolean {
  const entries = trailFor(trail, activityId);
  const completedBy = entries.find((e) => e.action === AuditAction.COMPLETED)?.by;
  const verified = entries.find((e) => e.action === AuditAction.VERIFIED);
  if (!completedBy || !verified) return false;
  // Separation of duties, checked after the fact as well as enforced before it.
  return (verified.verifiedBy ?? verified.by) !== completedBy;
}
