/**
 * Clinic closing — the end of the day, as the owner actually runs it.
 *
 * The mirror of `readiness.ts`, and deliberately its own module rather than a
 * flag on that one: the morning and the evening share a shape but almost
 * nothing else. Different people, different order, and one question the
 * morning never asks.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The question the morning never asks
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The activity matrix: *"KuBi should distinguish **Task Completed** from
 * **Clinic Safe to Close**. If a critical sterilization or patient-safety task
 * remains unresolved, the system should display 🔴 CLOSING WITH CRITICAL
 * EXCEPTION and require manager acknowledgement."*
 *
 * That is an override path, and this file does not build one — and that is now
 * the owner's ruling rather than a pending question: **keep refusing at
 * lockup.** It agrees with constitution rule 2, which says a BLOCK_HARD gate
 * has no override, enforced by the absence of a permission rather than by a
 * runtime check.
 *
 * `criticalException` below still *names* the state, because a manager is
 * entitled to see which patient-safety item is holding the door even though
 * nothing lets them through it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why fumigation is not the long pole
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It looked like it would be: fumigation is last and the rooms stay shut for
 * an hour. But the hour is spent with nobody in the building — it constrains
 * *re-entry*, not departure, and the clinic does not reopen inside it. So it
 * adds nothing to how long closing takes, and the guess that it would has
 * been dropped rather than carried forward.
 *
 * The instrument loop looked like the real long pole, and it turned out not to
 * be one either — the owner ruled that the morning run catches yesterday's
 * instruments. See `SAME_DAY_STERILISATION_NOTE`.
 */
import { RoleCode } from './enums.js';
import { Objective } from './objectives.js';
import { ClinicEvent } from './operating-model.js';
import type { Operatory, ReadinessEvent } from './readiness.js';

/**
 * The timing problem, and how the owner settled it.
 *
 * The closing drill sends used instruments to the sterilisation room at
 * closing. The cycle takes seventy-five minutes to cooling. The team leaves
 * thirty minutes after the door shuts. Working back, the last instrument that
 * could be stored the same day would have to be collected forty-five minutes
 * *before* the clinic shuts — so same-day sterilisation was never reachable,
 * and the matrix's *"Same-Day Sterilization = 100%"* was measuring something
 * this clinic is not built to do.
 *
 * The owner's ruling: **the morning run catches yesterday's instruments.**
 * That is why the opening procedure has a morning run at all. So a batch
 * waiting overnight is the normal end of a day, not a failure, and the safety
 * net sits at opening — the clinic cannot open until a run is released, which
 * `readiness()` enforces as the `STERILE` block.
 *
 * What closing still refuses is the one thing that is genuinely a today
 * problem: a cycle that ran and was never released. See the `CLINIC_LOCKED`
 * rule in `engine.ts`.
 */
export const SAME_DAY_STERILISATION_NOTE =
  'Same-day sterilisation is not reachable: the cycle is 75 minutes and the '
  + 'team leaves 30 minutes after the clinic shuts. The morning run catches '
  + 'yesterday’s instruments, and the clinic cannot open until it is released.';

/**
 * How long the closing drill takes.
 *
 * The owner: **30 minutes**. Like the morning's fifty, it is a whole-clinic
 * figure rather than the sum of the blocks — reception is reconciling while
 * housekeeping is mopping — so it is taken as given rather than added up.
 */
export const CLOSING_MINUTES = 30;

/**
 * The sterilisation cycle, repeated here from `readiness.ts` because the
 * evening's arithmetic needs it and importing the morning for one number
 * would tie two modules together for no reason.
 */
const STERILISATION_MINUTES = 75;

/**
 * The latest an instrument can be collected and still be stored before the
 * team leaves — and whether that time is reachable at all.
 *
 * This is the arithmetic that settled the same-day question. The drill takes
 * thirty minutes from the moment the clinic shuts, so the team leaves at
 * `shutAt + 30`. A cycle takes seventy-five minutes to cooling. Working back:
 *
 *     18:30 shut  →  19:00 leave  →  17:45 last possible collection
 *
 * which is **forty-five minutes before the clinic shuts**. `reachable` is
 * false whenever the cut-off lands before the clinic shuts, which on these
 * numbers is always — and that is why the owner ruled for the morning run
 * rather than a cut-off.
 *
 * Kept rather than deleted: the day somebody proposes same-day sterilisation
 * again, this says in one call why it cannot work at these hours, and it moves
 * on its own if the shut time or the drill ever changes.
 */
export function lastCollection(shutAt: number | null): {
  at: number | null;
  reachable: boolean;
  shortfallMinutes: number | null;
} {
  if (shutAt === null) return { at: null, reachable: false, shortfallMinutes: null };
  const at = shutAt + CLOSING_MINUTES - STERILISATION_MINUTES;
  return {
    at,
    reachable: at >= shutAt,
    shortfallMinutes: at >= shutAt ? null : shutAt - at,
  };
}

/* -------------------------------------------------------------------------
 * Traceability: the matrix's sixteen controls, and what covers each one
 * ---------------------------------------------------------------------- */

/**
 * Where each of `CLOSE-001`…`CLOSE-016` ended up.
 *
 * Seven of the matrix's owners read "Assigned Staff", which is not an owner.
 * Rather than infer them, each is traced to the section of the owner's closing
 * drill that contains the work — the drill assigns owners per protocol, so the
 * owner falls out of which protocol the control belongs to. That is a
 * derivation, not a guess, and it is written here so it can be checked instead
 * of believed.
 *
 * `covers` is the closing block that carries it, `GOVERNANCE` for the ones
 * `CLINIC_LOCKED` refuses on directly, `MORNING` for work the owner moved to
 * the next day, or **null** where the drill genuinely has no home for it.
 *
 * The nulls are the point. Four controls have no place in the closing drill,
 * and three of those four are "get ready for tomorrow" work — which suggests
 * the drill is complete about shutting the building down and silent about
 * handing the day on. That is the owner's to settle; nothing here invents it.
 */
export const CLOSING_CONTROLS: Readonly<Record<string, {
  covers: string | null;
  why: string;
}>> = {
  'CLOSE-001': { covers: 'GOVERNANCE', why: 'CLINIC_LOCKED refuses on an unfinished visit' },
  'CLOSE-002': { covers: 'GOVERNANCE', why: 'CLINIC_LOCKED refuses on an unwritten clinical note' },
  'CLOSE-003': { covers: 'GOVERNANCE', why: 'the day-after call is a consequence of finishing treatment' },
  'CLOSE-004': { covers: 'OPERATORY_CLOSED', why: 'Operatory Closing (a) — trays cleared to the sterilisation room' },
  'CLOSE-005': { covers: 'MORNING', why: 'same-day sterilisation superseded: the morning run catches yesterday' },
  'CLOSE-006': { covers: 'MORNING', why: 'storage happens after the morning run is released' },
  'CLOSE-007': { covers: 'WASTE', why: 'BMW Closing Protocol — housekeeping' },
  'CLOSE-008': { covers: 'OPERATORY_CLOSED', why: 'Operatory Closing (b) — chair surfaces re-wiped, per room' },
  'CLOSE-009': { covers: null, why: 'replenishing consumables is nowhere in the closing drill' },
  'CLOSE-010': { covers: 'OPERATORY_CLOSED', why: 'Operatory Closing (d, e) — light, compressor and suction off; the board is Security (c) and the chairs are Environment (a)' },
  'CLOSE-011': { covers: 'ENVIRONMENT', why: 'Clinic Environment Closing (d) — windows, fans and ACs' },
  'CLOSE-012': { covers: null, why: 'the water pump appears in the matrix and in no section of the drill' },
  'CLOSE-013': { covers: null, why: 'reviewing lab cases is nowhere in the closing drill' },
  'CLOSE-014': { covers: null, why: 'reviewing tomorrow’s list is nowhere in the closing drill' },
  'CLOSE-015': { covers: 'SECURITY', why: 'Security & Lockdown Protocol — reception, ending in the key handover' },
  'CLOSE-016': { covers: 'GOVERNANCE', why: 'CLINIC_LOCKED is the day closing; there is no separate tick' },
};

/** The matrix controls the closing drill has no home for. */
export const UNCOVERED_CLOSING_CONTROLS = Object.entries(CLOSING_CONTROLS)
  .filter(([, v]) => v.covers === null)
  .map(([id]) => id);

/* -------------------------------------------------------------------------
 * The blocks
 * ---------------------------------------------------------------------- */

export interface ClosingBlock {
  id: string;
  label: string;
  owner: RoleCode;
  objective: Objective;
  completedBy: ClinicEvent;
  subjectId: string | null;
  /**
   * Whether this one is patient-safety critical.
   *
   * The matrix's exception is specifically about *"a critical sterilization or
   * patient-safety task"*, so the distinction has to exist in the data before
   * any decision about acknowledgement can be made about it.
   */
  critical: boolean;
  done: boolean;
  doneAt: number | null;
  ifOutstanding: string;
}

export interface Closing {
  blocks: readonly ClosingBlock[];
  outstanding: readonly ClosingBlock[];
  /** Calculated. Nobody ticks "clinic closed" any more than they tick ready. */
  clear: boolean;
  /** The minute the last block was reported, once all are. */
  closedAt: number | null;
  /**
   * The minute the clinic shuts today.
   *
   * The owner: *"clinic shut time is 6.30 normally with exceptions of some
   * days that is 7"*. Both facts are data — the normal time on the clinic, the
   * exception days in their own table — because a system that only knew the
   * normal time would call every late Thursday an overrun.
   *
   * Null when nobody has set one, and null is not a plausible hour.
   */
  shutAt: number | null;
  /**
   * Minutes between the clinic shutting and the team actually leaving.
   *
   * Deliberately not "lateness". The closing drill *starts* when the clinic
   * shuts, so finishing after 18:30 is the normal case and not a failure —
   * what is worth knowing is how long it takes, which is this. Null until the
   * drill is finished, or when there is no shut time to measure from.
   */
  overrunMinutes: number | null;
  /** The clinic has shut and the drill is not finished. */
  closingNow: boolean;
  /**
   * The minute the team should be out by — `shutAt` plus the thirty minutes
   * the drill takes. Null when there is no shut time to add them to.
   */
  expectedCloseAt: number | null;
  /**
   * Actual minus expected, in minutes. Negative is early, positive is late.
   *
   * The evening's mirror of the morning's *"Time of First Patient Readiness
   * vs. Target"*: `overrunMinutes` says how long closing took, this says
   * whether that was longer than it should have been.
   */
  varianceMinutes: number | null;
  /** Past the time the team should have left, and still not finished. */
  runningLate: boolean;
  /**
   * Outstanding work that is patient-safety critical.
   *
   * Named rather than acted on. This is the matrix's 🔴 CLOSING WITH CRITICAL
   * EXCEPTION, reported so that the state is visible and countable — the
   * acknowledgement path it asks for is an open owner decision and is not
   * built.
   */
  criticalException: readonly ClosingBlock[];
  /** The share of blocks reported — *"Compliance with Closing Checklist"*. */
  compliance: number;
  unconfigured: readonly string[];
  /**
   * Staff out through the exit protocol (§ End-of-Day Staff Protocol),
   * reported rather than enforced — the same limit as staff entry, for the
   * same reason: an event carries a role, not a person.
   */
  staffLeft: number;
}

const block = (
  id: string, label: string, owner: RoleCode, objective: Objective,
  completedBy: ClinicEvent, subjectId: string | null, critical: boolean,
  ifOutstanding: string,
): Omit<ClosingBlock, 'done' | 'doneAt'> =>
  ({ id, label, owner, objective, completedBy, subjectId, critical, ifOutstanding });

/**
 * The closing drill, in the order the clinic works it.
 *
 * Operatories first because they feed the instrument loop; money next because
 * reception can do it while the rooms are being turned round; the premises
 * after the rooms are empty, since fumigation cannot happen with people in
 * them; and lockdown last, because it is the act of leaving.
 */
function planFor(operatories: readonly Operatory[]): Array<Omit<ClosingBlock, 'done' | 'doneAt'>> {
  const rooms = [...operatories]
    .sort((a, b) => a.position - b.position)
    .map((o) => block(
      `OPERATORY_CLOSED:${o.id}`, `Close down ${o.label}`,
      RoleCode.DENTAL_ASSISTANT, Objective.PATIENT_SAFE,
      ClinicEvent.OPERATORY_CLOSED, o.id, true,
      `${o.label} has not been closed down — instruments, film, power and floor`,
    ));

  return [
    ...rooms,
    block('PAYMENTS', 'Reconcile the day’s takings',
      RoleCode.RECEPTION, Objective.MONEY_COLLECTED,
      ClinicEvent.PAYMENTS_RECONCILED, null, false,
      'The day’s cash, card and TPA payments have not been reconciled'),
    block('REPORT', 'Send the daily collection report',
      RoleCode.RECEPTION, Objective.RECORDS_COMPLETE,
      ClinicEvent.DAY_REPORTED, null, false,
      'The manager has not been sent today’s figures'),
    block('WASTE', 'Close the bio-medical waste',
      RoleCode.HOUSEKEEPING, Objective.PATIENT_SAFE,
      ClinicEvent.WASTE_CLOSED, null, true,
      'The waste bins are not closed and the logbook is not written'),
    block('ENVIRONMENT', 'Close the clinic down and fumigate',
      RoleCode.HOUSEKEEPING, Objective.PATIENT_SAFE,
      ClinicEvent.ENVIRONMENT_CLOSED, null, true,
      'The waiting area, pantry, washroom and fumigation are not done'),
    block('SECURITY', 'Secure the premises and hand over the key',
      RoleCode.RECEPTION, Objective.CLINIC_EFFICIENT,
      ClinicEvent.PREMISES_SECURED, null, false,
      'The clinic is not locked and the key has not been handed over'),
  ];
}

/**
 * Where the clinic's evening has got to.
 *
 * Pure, like the morning. `shutAt` is when the clinic shuts today — the normal
 * time unless this is one of the exception days — and it is the moment the
 * drill begins rather than a deadline it has to beat. Both it and `now` are
 * optional and default to null, so a caller that has neither gets a truthful
 * answer about the work with no invented clock attached to it.
 */
export function closing(
  events: readonly ReadinessEvent[],
  operatories: readonly Operatory[],
  shutAt: number | null = null,
  now: number | null = null,
): Closing {
  const unconfigured: string[] = [];
  if (operatories.length === 0) {
    unconfigured.push('No operatory has been set up for this clinic');
  }

  const blocks: ClosingBlock[] = planFor(operatories).map((b) => {
    const ev = events.find((e) => e.type === b.completedBy
      && (b.subjectId === null || e.subjectId === b.subjectId));
    return { ...b, done: ev !== undefined, doneAt: ev ? ev.at : null };
  });

  const outstanding = blocks.filter((b) => !b.done);
  const done = blocks.filter((b) => b.done);
  const clear = unconfigured.length === 0 && outstanding.length === 0;

  const staffLeft = new Set(
    events.filter((e) => e.type === ClinicEvent.STAFF_LEFT).map((e) => e.subjectId),
  ).size;

  const closedAt = clear
    ? done.reduce((latest, b) => Math.max(latest, b.doneAt ?? 0), 0)
    : null;

  const expectedCloseAt = shutAt === null ? null : shutAt + CLOSING_MINUTES;

  return {
    blocks,
    outstanding,
    clear,
    closedAt,
    shutAt,
    expectedCloseAt,
    overrunMinutes: closedAt === null || shutAt === null ? null : closedAt - shutAt,
    varianceMinutes: closedAt === null || expectedCloseAt === null
      ? null : closedAt - expectedCloseAt,
    closingNow: shutAt !== null && now !== null && now >= shutAt && !clear,
    runningLate: expectedCloseAt !== null && now !== null && now > expectedCloseAt && !clear,
    criticalException: outstanding.filter((b) => b.critical),
    compliance: blocks.length === 0 ? 0 : done.length / blocks.length,
    unconfigured,
    staffLeft,
  };
}

/** The one sentence to put in front of whoever is trying to lock up. */
export function whyNotClosed(c: Closing): string | null {
  if (c.clear) return null;
  if (c.unconfigured.length > 0) return c.unconfigured[0]!;
  // Patient safety first, whatever order the list happens to be in.
  const first = c.criticalException[0] ?? c.outstanding[0]!;
  return first.ifOutstanding;
}
