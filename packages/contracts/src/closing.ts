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
 * That is an override path, and this file does not build one. Constitution
 * rule 2: a BLOCK_HARD gate has no override, enforced by the absence of a
 * permission rather than by a runtime check. Inventing an acknowledgement
 * that lets a patient-safety failure through would be exactly the thing that
 * rule exists to prevent, so `criticalException` below *names* the state and
 * `CLINIC_LOCKED` still refuses. Whether the owner wants an acknowledged
 * close is an open decision, and an open decision is never silently resolved.
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
 * The real long pole is the instrument loop, and it is a genuine problem the
 * owner has to settle — see `SAME_DAY_STERILISATION_NOTE`.
 */
import { RoleCode } from './enums.js';
import { Objective } from './objectives.js';
import { ClinicEvent } from './operating-model.js';
import type { Operatory, ReadinessEvent } from './readiness.js';

/**
 * The timing problem, recorded where somebody will find it.
 *
 * The closing drill sends used instruments to the sterilisation room at
 * closing: *"All instrument trays cleared; used instruments placed in the
 * sterilization room"*. The matrix demands *"Sterilization complete — same
 * day"* at 100%. The cycle takes seventy-five minutes to cooling.
 *
 * Those three cannot all hold. A tray cleared at 19:00 is not stored before
 * 20:15, so either somebody stays, or there is a collection cut-off, or
 * same-day is not really the rule and the morning run is what catches
 * yesterday's instruments — which would explain why the opening procedure has
 * one. KuBi does not choose; it refuses to close with instruments in the loop,
 * which is the existing behaviour, and this note says why that will bite.
 */
export const SAME_DAY_STERILISATION_NOTE =
  'Instruments go to the sterilisation room at closing and the cycle takes 75 '
  + 'minutes to cooling, so same-day completion needs a collection cut-off.';

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
 * This is the same-day sterilisation problem, done as arithmetic instead of
 * worried about in prose. The drill takes thirty minutes from the moment the
 * clinic shuts, so the team leaves at `shutAt + 30`. A cycle takes
 * seventy-five minutes to cooling. Working back:
 *
 *     18:30 shut  →  19:00 leave  →  17:45 last possible collection
 *
 * which is **forty-five minutes before the clinic shuts**. Instruments used in
 * the last treatment of the day cannot be stored the same day, by arithmetic
 * and not by anybody's carelessness. `reachable` is false whenever the cut-off
 * lands before the clinic shuts, which on these numbers is always.
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
