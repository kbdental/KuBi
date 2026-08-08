/**
 * Clinic readiness — the morning, as the owner actually runs it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this is calculated and not ticked
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The activity matrix is explicit: *"The staff should not manually tick
 * 'Clinic Ready.' KuBi calculates it: Clinic Ready = all mandatory opening
 * controls passed."*
 *
 * So `ready` below is a function, never a field, and `ROOMS_READY` — which
 * used to be a button an assistant pressed — is refused by governance until
 * every block underneath it has actually been reported. Nobody can assert a
 * ready clinic; they can only do the work that makes it one.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What is a block, and what is not
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A block is one piece of the morning with one owner and one completing
 * event. The owner's own split:
 *
 *   per operatory   dental chair, x-ray, hand instruments, suction —
 *                   *"do not put special instruments and equipments as they
 *                   can be taken any where on a movable trolley"*
 *   equipment       exactly those movable and central items, checked once —
 *                   *"as she is the one who checks the working"*, so it is
 *                   the assistant's task and not the operatory's
 *
 * That distinction is why an operatory block is a fixed four checks however
 * much kit the clinic owns, and why buying a second intraoral scanner does
 * not change the shape of anybody's morning.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNKNOWN is never PASS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A clinic whose operatory master is empty is not a ready clinic — it is an
 * unconfigured one, and `ready` is false with `unconfigured` saying so. That
 * is ADR-013 applied to the master data rather than to the checks.
 */
import { RoleCode } from './enums.js';
import { Objective } from './objectives.js';
import { ClinicEvent } from './operating-model.js';

/**
 * The only thing readiness needs to know about an event.
 *
 * Deliberately its own type rather than the engine's `RecordedEvent`: the
 * governance rule for `ROOMS_READY` has to ask this module a question, and a
 * module the engine imports must not import the engine back. `RecordedEvent`
 * satisfies this shape, so callers pass `world.events` unchanged.
 */
export interface ReadinessEvent {
  type: ClinicEvent;
  subjectId: string;
  at: number;
}

/* -------------------------------------------------------------------------
 * The master
 * ---------------------------------------------------------------------- */

/**
 * One operatory, from the clinic's master.
 *
 * The owner has four. The number is deliberately not written down anywhere in
 * this file — *"i have got 4 operatories but you will have to make a master to
 * decide the number of operatories"* — so a fifth is a row, not a release.
 */
export interface Operatory {
  id: string;
  /** How a person says it: "Operatory 2". */
  label: string;
  /** Left-to-right order, so the morning list reads like the corridor. */
  position: number;
}

/**
 * How long one operatory takes to prepare.
 *
 * The owner, measured rather than estimated: *"I have given the steps and it
 * normally takes 15 minutes to get the things ready"*. It is the only duration
 * in the opening procedure that has been stated, which is why every other
 * block below carries `null` instead of a plausible-looking number.
 */
export const OPERATORY_MINUTES = 15;

/* -------------------------------------------------------------------------
 * The blocks
 * ---------------------------------------------------------------------- */

export interface ReadinessBlock {
  /** `OPERATORY:op-2`, `RECEPTION`, `STERILE`… */
  id: string;
  label: string;
  owner: RoleCode;
  /** What this part of the morning is for, which is how the list is ordered. */
  objective: Objective;
  /** The event that completes it. */
  completedBy: ClinicEvent;
  /** The operatory or other subject it is about, where it has one. */
  subjectId: string | null;
  /** Minutes it should take, or null where the owner has not said. */
  expectMinutes: number | null;
  done: boolean;
  /** The minute it was reported, or null while outstanding. */
  doneAt: number | null;
  /** Said plainly, for the person who has to be told why they are waiting. */
  ifOutstanding: string;
}

export interface Readiness {
  blocks: readonly ReadinessBlock[];
  outstanding: readonly ReadinessBlock[];
  /** Calculated. There is no event that sets this and no field that holds it. */
  ready: boolean;
  /** The minute the last outstanding block was reported, once all are. */
  readyAt: number | null;
  /**
   * The minute the clinic was due to be ready — the day's first appointment.
   * Null when nothing is booked; a clinic with no patients has no deadline,
   * and inventing one would report a variance nobody owes.
   */
  targetAt: number | null;
  /**
   * Actual minus target, in minutes. Negative is early, positive is late,
   * null while the clinic is not ready yet.
   *
   * This is the owner's *"Time of First Patient Readiness vs. Target"*.
   */
  varianceMinutes: number | null;
  /**
   * Of the mandatory blocks, the share reported — the owner's *"Compliance
   * with Opening Checklist"*. Counted over blocks, not over the 60-odd
   * individual actions inside them, because a block is what one person
   * reports and a share of half-done blocks would not mean anything.
   */
  compliance: number;
  /** Master data we need and do not have. Non-empty means `ready` is false. */
  unconfigured: readonly string[];
  /**
   * The first patient is due, or past due, and the clinic is not ready.
   * False when nothing is booked — not late, just no deadline.
   */
  overdue: boolean;
  /**
   * Minutes left before the first patient, negative once that time has
   * passed. Null when there is no first patient to count towards.
   */
  minutesToTarget: number | null;
  /**
   * Staff through the hygiene protocol (§1), reported rather than enforced.
   *
   * §1 gates each *person*, and an event in this model carries the role that
   * recorded it rather than the individual — so the count is honest and the
   * gate is not yet expressible. Recorded here rather than dropped, because a
   * morning where nobody logged entry is worth seeing.
   */
  staffEntered: number;
}

/* -------------------------------------------------------------------------
 * The calculation
 * ---------------------------------------------------------------------- */

const block = (
  id: string, label: string, owner: RoleCode, objective: Objective,
  completedBy: ClinicEvent,
  subjectId: string | null, expectMinutes: number | null, ifOutstanding: string,
): Omit<ReadinessBlock, 'done' | 'doneAt'> =>
  ({ id, label, owner, objective, completedBy, subjectId, expectMinutes, ifOutstanding });

/**
 * Every block this clinic's morning consists of, in the order it is worked.
 *
 * Derived from the master, so a clinic with six operatories gets six blocks
 * without anybody editing this list.
 */
function planFor(operatories: readonly Operatory[]): Array<Omit<ReadinessBlock, 'done' | 'doneAt'>> {
  const rooms = [...operatories]
    .sort((a, b) => a.position - b.position)
    .map((o) => block(
      `OPERATORY:${o.id}`, `Prepare ${o.label}`, RoleCode.DENTAL_ASSISTANT,
      Objective.PATIENT_SAFE,
      ClinicEvent.OPERATORY_READY, o.id, OPERATORY_MINUTES,
      `${o.label} is not prepared, so nobody can be seated in it`,
    ));

  return [
    ...rooms,
    block('STERILE', 'Release the morning sterilisation run',
      RoleCode.STERILIZATION_TECHNICIAN, Objective.PATIENT_SAFE,
      ClinicEvent.BATCH_RELEASED, null, null,
      'There are no sterile packs in the cabinets for today'),
    block('EQUIPMENT', 'Check the equipment',
      RoleCode.DENTAL_ASSISTANT, Objective.PATIENT_SAFE,
      ClinicEvent.EQUIPMENT_VERIFIED, null, null,
      'The equipment has not been checked, so a fault would be found on a patient'),
    block('COMMON_AREAS', 'Clean the floors, pantry and washroom',
      RoleCode.HOUSEKEEPING, Objective.PATIENT_SAFE,
      ClinicEvent.COMMON_AREAS_READY, null, null,
      'The floors and shared areas have not been done'),
    block('RECEPTION', 'Ready the waiting and billing area',
      RoleCode.RECEPTION, Objective.PATIENT_HAPPY,
      ClinicEvent.RECEPTION_READY, null, null,
      'The waiting area is not ready for the first patient'),
    block('STOCK', 'Verify the day’s stock',
      RoleCode.DENTAL_ASSISTANT, Objective.CLINIC_EFFICIENT,
      ClinicEvent.STOCK_VERIFIED, null, null,
      'Stock has not been counted, so a shortage would be found mid-treatment'),
  ];
}

/**
 * Where the clinic's morning has got to.
 *
 * Pure, like everything else here: hand it a world and a minute and it will
 * tell you about that minute, which is what lets a test stand at 09:10 and
 * again at 09:40 without a clock.
 *
 * `targetAt` is the first appointment. The owner's KPI is readiness measured
 * against it, so it is a parameter rather than a constant — a nine o'clock
 * list and a noon list are not the same morning.
 */
export function readiness(
  events: readonly ReadinessEvent[],
  operatories: readonly Operatory[],
  targetAt: number | null,
  now: number,
): Readiness {
  const unconfigured: string[] = [];
  if (operatories.length === 0) {
    // Not "ready because there is nothing to check". An empty master is a
    // question we have not answered, and an unanswered question never passes.
    unconfigured.push('No operatory has been set up for this clinic');
  }

  const blocks: ReadinessBlock[] = planFor(operatories).map((b) => {
    const ev = events.find((e) => e.type === b.completedBy
      && (b.subjectId === null || e.subjectId === b.subjectId));
    return { ...b, done: ev !== undefined, doneAt: ev ? ev.at : null };
  });

  const outstanding = blocks.filter((b) => !b.done);
  const done = blocks.filter((b) => b.done);
  const ready = unconfigured.length === 0 && outstanding.length === 0;

  // The minute the *last* block landed — when the clinic actually became
  // ready, not when somebody noticed.
  const readyAt = ready
    ? done.reduce((latest, b) => Math.max(latest, b.doneAt ?? 0), 0)
    : null;

  const staffEntered = new Set(
    events.filter((e) => e.type === ClinicEvent.STAFF_READY).map((e) => e.subjectId),
  ).size;

  return {
    blocks,
    outstanding,
    ready,
    readyAt,
    targetAt,
    varianceMinutes: readyAt === null || targetAt === null ? null : readyAt - targetAt,
    compliance: blocks.length === 0 ? 0 : done.length / blocks.length,
    unconfigured,
    staffEntered,
    // The first patient is due and the clinic is not ready. Reported as its
    // own fact rather than left to be worked out from a null variance,
    // because it is the one state somebody has to be told about while there
    // is still time to do something.
    overdue: targetAt !== null && !ready && now > targetAt,
    minutesToTarget: targetAt === null ? null : targetAt - now,
  };
}

/**
 * The one sentence to put in front of whoever is waiting.
 *
 * Names the block, its owner and what it is holding up — never a count of
 * outstanding items, which tells somebody they are blocked without telling
 * them by whom.
 */
export function whyNotReady(r: Readiness): string | null {
  if (r.ready) return null;
  if (r.unconfigured.length > 0) return r.unconfigured[0]!;
  const first = r.outstanding[0]!;
  return first.ifOutstanding;
}
