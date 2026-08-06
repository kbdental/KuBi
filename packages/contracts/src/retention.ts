/**
 * Patients who stopped coming, and the thirty-day line.
 *
 * The owner wrote it as one line: *"Dr's to do follow up with existing patient
 * and patient that have come but not started treatment or not coming back for
 * any reason to be done more effectively."* Asked how long counts as not
 * coming back, they said thirty days. That number is the whole reason this
 * file can exist — before it, "not coming back" was a feeling.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this is NOT, checked before it was written
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The last requirement round produced twelve controls that already existed in
 * the frozen matrix, because nobody read it first. So, explicitly:
 *
 *   FUP-004  Treatment progress follow-up — follows a patient *during*
 *            treatment. This one starts where that stops.
 *   APT-006  No-show handling — one missed appointment, handled that day.
 *            A dormant patient may never have missed anything; they simply
 *            stopped booking.
 *   CND-092  Recall appointment — a patient whose treatment *finished* and
 *            who is due a routine visit. That is a success being maintained.
 *            Dormancy is a treatment that stalled.
 *
 * The three do not overlap and this file must not take work from any of them.
 * `isRecallNotDormancy()` exists to keep that line drawn in code.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Pure, and a function of a supplied clock
 * ─────────────────────────────────────────────────────────────────────────
 *
 * No `Date.now()`. The rule takes the instant it is being asked about, so a
 * test can stand on day 29, day 30 and day 31 and see three different answers.
 */

/** Thirty days, as the owner said. One place, because it will be argued with. */
export const DORMANT_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why a patient is on the list. Two populations, not one — they need
 * different conversations, and lumping them together is how the call goes
 * wrong.
 */
export const RetentionReason = {
  /**
   * Attended, was given a plan, and never began it. The conversation is about
   * the plan: cost, fear, time, or a second opinion elsewhere.
   */
  NEVER_STARTED: 'NEVER_STARTED',
  /**
   * Began treatment and stopped mid-course. The conversation is clinical
   * first: an unfinished root canal is not a lost sale, it is an open tooth.
   */
  STOPPED_MID_TREATMENT: 'STOPPED_MID_TREATMENT',
} as const;
export type RetentionReason = (typeof RetentionReason)[keyof typeof RetentionReason];

/** What happened when somebody rang. */
export const OutreachOutcome = {
  /** Booked. The only outcome that closes the loop by succeeding. */
  RETURNING: 'RETURNING',
  /** Reached, and does not want to continue. A real answer; the loop closes. */
  DECLINED: 'DECLINED',
  /** Reached, wants to think. Comes back to the list after the interval. */
  WILL_DECIDE: 'WILL_DECIDE',
  /** Not reached. Comes back to the list; never counted as contacted. */
  NO_ANSWER: 'NO_ANSWER',
  /** The number is wrong. Reception's problem before it is the doctor's. */
  UNREACHABLE: 'UNREACHABLE',
  /**
   * Treatment was finished elsewhere, or the record was wrong. Closes the loop
   * without claiming a win.
   */
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type OutreachOutcome = (typeof OutreachOutcome)[keyof typeof OutreachOutcome];

/** Outcomes after which the patient leaves the list for good. */
export const CLOSING_OUTCOMES: readonly OutreachOutcome[] = [
  OutreachOutcome.RETURNING,
  OutreachOutcome.DECLINED,
  OutreachOutcome.NOT_APPLICABLE,
];

/**
 * What KuBi knows about one patient, reduced to the few facts the rule needs.
 *
 * Deliberately not the Prisma row. The rule is arithmetic on dates and states;
 * giving it a database model would make it untestable without a database and
 * would tempt it into asking a second question halfway through.
 */
export interface PatientActivity {
  patientId: string;
  /** Last visit the patient actually attended, in ms. Null if they never have. */
  lastAttendedAt: number | null;
  /** Next booked appointment, in ms. Null if nothing is booked. */
  nextBookedAt: number | null;
  /** Procedures planned and never started. */
  plannedNotStarted: number;
  /** Procedures started and not finished. */
  startedNotCompleted: number;
  /** Procedures finished. */
  completed: number;
}

export interface Dormancy {
  patientId: string;
  reason: RetentionReason;
  /** Whole days since the last attended visit. */
  daysSinceLastVisit: number;
  /** The clinical stake, in one clause a doctor can read at a glance. */
  stake: string;
}

/**
 * A patient whose treatment finished and who has simply not been back yet.
 *
 * Not dormancy, however long the gap. They are a recall (CND-092), and putting
 * them on a doctor's retention list buries the two people with an open tooth
 * under forty people due a check-up.
 */
export function isRecallNotDormancy(a: PatientActivity): boolean {
  return a.completed > 0 && a.startedNotCompleted === 0 && a.plannedNotStarted === 0;
}

/**
 * Whether this patient is dormant at this instant, and why.
 *
 * Null is the common answer and it means exactly one of: they were here
 * recently, they are booked in, they have nothing outstanding, or they have
 * never attended at all. Each of those is a different kind of not-dormant, and
 * none of them is a patient to ring.
 */
export function dormancyOf(a: PatientActivity, now: number): Dormancy | null {
  // Booked in is booked in. A patient with an appointment next week is not
  // lost, however long ago they last came — this check first, because it is
  // the one that most often prevents a pointless and slightly insulting call.
  if (a.nextBookedAt !== null && a.nextBookedAt >= now) return null;

  // Never attended is not dormancy. Someone who booked and never arrived is a
  // no-show (APT-006); someone who exists only as a record is reception's.
  if (a.lastAttendedAt === null) return null;

  if (isRecallNotDormancy(a)) return null;
  if (a.startedNotCompleted === 0 && a.plannedNotStarted === 0) return null;

  const days = Math.floor((now - a.lastAttendedAt) / DAY_MS);
  if (days < DORMANT_AFTER_DAYS) return null;

  // Mid-treatment wins when both are true. A patient with an unfinished root
  // canal and an unstarted crown plan is, first, a patient with an unfinished
  // root canal.
  const reason = a.startedNotCompleted > 0
    ? RetentionReason.STOPPED_MID_TREATMENT
    : RetentionReason.NEVER_STARTED;

  return {
    patientId: a.patientId,
    reason,
    daysSinceLastVisit: days,
    stake: reason === RetentionReason.STOPPED_MID_TREATMENT
      ? `${a.startedNotCompleted} treatment${a.startedNotCompleted === 1 ? '' : 's'} left unfinished`
      : `${a.plannedNotStarted} planned treatment${a.plannedNotStarted === 1 ? '' : 's'} never begun`,
  };
}

/**
 * Order for a doctor's list: unfinished treatment first, then by how long.
 *
 * Not by "value". KuBi could sort this by the price of the untaken plan and it
 * would be a more profitable list and a worse one — the patient with an open
 * access cavity for six weeks is the call to make first, whatever it bills.
 */
export function retentionOrder(a: Dormancy, b: Dormancy): number {
  if (a.reason !== b.reason) {
    return a.reason === RetentionReason.STOPPED_MID_TREATMENT ? -1 : 1;
  }
  return b.daysSinceLastVisit - a.daysSinceLastVisit;
}

/**
 * How long before a WILL_DECIDE patient comes back to the list.
 *
 * Fourteen days is not the owner's number — they have not been asked. It is
 * declared here as a named constant with this comment attached rather than
 * buried as a `14` in a query, so that when it is wrong it can be found and
 * changed in one place, and so nobody mistakes it for a decision.
 */
export const RECONSIDER_AFTER_DAYS = 14;
