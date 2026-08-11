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
 *   equipment       exactly those movable and central items, checked once,
 *                   by the head assistant — *"Equipment round is to be done
 *                   by head dental nurse or Head dental assistant"*
 *
 * That distinction is why an operatory block is a fixed four checks however
 * much kit the clinic owns, and why buying a second intraoral scanner does
 * not change the shape of anybody's morning.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Two paths, not one list
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The morning is not a queue. Housekeeping's forty-five minutes and the
 * seventy-five-minute sterilisation cycle run side by side, and the clinic is
 * ready when the longer one finishes — which is why `startBy` subtracts the
 * long pole from the first appointment rather than adding the blocks up, and
 * why it names which path decided.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Mandatory, and merely listed
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Stock is checked *"as per requirement"*, so it appears as work and does not
 * hold the door. `outstanding` is what is stopping the clinic opening;
 * `advisory` is what else is on somebody's list. Keeping them apart is what
 * stops "the clinic cannot open" from being said about a stock count.
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

/* -------------------------------------------------------------------------
 * How long the morning takes
 *
 * All measured by the owner rather than estimated here. The important shape
 * is that the morning has two paths of very different lengths running side by
 * side, and the clinic is not ready until the longer one finishes.
 * ---------------------------------------------------------------------- */

/** *"it normally takes 15 minutes to get the things ready"* — per operatory. */
export const OPERATORY_MINUTES = 15;

/** *"The house keeping staff would take around 45 minutes"* — mopping and the rest. */
export const HOUSEKEEPING_MINUTES = 45;

/**
 * Everything except the sterilisation cycle.
 *
 * The owner: *"total time for clinic readiness should be put as 45 to 50 min
 * that should include all tasks leaving the sterilization cycle"*. The upper
 * bound is used, because a morning that finishes early is fine and one that
 * runs late is not.
 *
 * This is a whole-clinic figure, not the sum of the blocks: four operatories
 * at fifteen minutes each is sixty minutes of work done inside fifty minutes
 * of morning, because more than one person is doing it. KuBi does not model
 * who is rostered, so it takes the owner's number rather than adding up.
 */
export const READINESS_MINUTES = 50;

/**
 * The sterilisation cycle, which is the long pole of the morning.
 *
 * The owner: *"the sterilization cycle which takes 1 hour 15 minutes uptill
 * cooling in an autoclave"*. Cooling is inside that figure deliberately — a
 * pack that has not cooled is not a pack you can use, and a system that
 * called the run finished at the end of the autoclave stage would declare the
 * clinic ready twenty minutes early.
 */
export const STERILIZATION_MINUTES = 75;

/* -------------------------------------------------------------------------
 * Traceability: the matrix's twelve opening controls, and what covers each
 * ---------------------------------------------------------------------- */

/**
 * Where each of `OPEN-001`…`OPEN-012` ended up.
 *
 * The evening had this table from the day it was built and the morning never
 * did, which is why the morning's gaps were a paragraph in a document rather
 * than a number a test could fail on. This is the mirror, written to the same
 * rule: `covers` is the readiness block that carries it, or **null** where
 * nothing does.
 *
 * The nulls are the finding, and there are seven of them. Six are one thing
 * wearing six matrix rows — **opening the building**: unlocking it, the
 * lights and fans, the ACs, the air diffuser, the water supply and the water
 * pump. Neither source document has that section. The owner's closing drill
 * has its mirror image (Clinic Environment Closing switches all of it off),
 * and the opening procedure begins with people already inside a working
 * building. So the clinic certainly does it; KuBi simply has no block for it,
 * and nobody has said whose job it is.
 *
 * The seventh is `OPEN-012`, morning emergency readiness, and it is not part
 * of that cluster. It is patient safety — the emergency kit, the drugs and
 * their expiry, the oxygen — and it is absent from both documents and from
 * every block. That one is worth its own line rather than being counted in
 * with the light switches.
 *
 * Nothing here invents an owner for any of the seven. Naming them is the
 * point; `UNCOVERED_OPENING_CONTROLS` is what stops them being forgotten.
 */
export const OPENING_CONTROLS: Readonly<Record<string, {
  covers: string | null;
  why: string;
}>> = {
  'OPEN-001': { covers: null, why: 'opening the premises itself — no block unlocks the building or switches it on' },
  'OPEN-002': { covers: 'RECEPTION', why: 'the waiting and billing area, reception — 15 items in the owner’s §4' },
  'OPEN-003': { covers: 'OPERATORY', why: 'one block per room from the master — 24 disinfection actions each' },
  'OPEN-004': { covers: 'OPERATORY', why: 'the dental chair, one of the four per-room checks the owner named' },
  'OPEN-005': { covers: 'OPERATORY', why: 'suction, checked in each room even though the plant is centralised' },
  'OPEN-006': { covers: 'EQUIPMENT', why: 'the compressor is central kit, so it is the senior assistant’s one round — including its 5-minute warm-up' },
  'OPEN-007': { covers: null, why: 'the ACs at 24 °C — part of opening the building, which no block covers' },
  'OPEN-008': { covers: null, why: 'the air diffuser — part of opening the building, which no block covers' },
  'OPEN-009': { covers: null, why: 'water availability — part of opening the building, which no block covers' },
  'OPEN-010': { covers: null, why: 'the water pump — the owner ruled this belongs to opening rather than closing, and the morning has no block for it yet' },
  'OPEN-011': { covers: null, why: 'lights and fans — part of opening the building, which no block covers' },
  'OPEN-012': { covers: null, why: 'morning emergency readiness — the kit, the drugs and their expiry. Patient safety, in neither document and in no block' },
  // The one control with no doer, and that is the point of it.
  'OPEN-013': { covers: 'DERIVED', why: 'opening complete — the matrix gives the doer as “System” and the evidence as “Auto”. `readiness().ready` is that control: it is computed from the mandatory blocks every time it is read, and there is no event, field or permission that can set it' },
};

/**
 * OPEN-013, enforced rather than described.
 *
 * The owner: *"The staff should not manually tick 'Clinic Ready.' KuBi
 * calculates it: Clinic Ready = all mandatory opening controls passed."*
 *
 * The way that is guaranteed here is by **absence** — the same technique the
 * constitution uses for BLOCK_HARD gates. There is no `CLINIC_READY` event in
 * the log, so there is no thing to record; `ready` exists only as the return
 * value of a function over the blocks. A test asserts the event does not
 * exist, because the way this rule would be lost is somebody adding one in
 * good faith to make a screen simpler.
 *
 * This constant is what that test names, so the rule has somewhere to live
 * other than a comment.
 */
export const READY_IS_DERIVED_ONLY = true;

/** The matrix opening controls nothing covers yet. */
export const UNCOVERED_OPENING_CONTROLS = Object.entries(OPENING_CONTROLS)
  .filter(([, v]) => v.covers === null)
  .map(([id]) => id);

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
  /**
   * Minutes it should take on its own, where that has a separate figure.
   *
   * Null does not mean unknown. The equipment round and the waiting area
   * *"happen in that 50 min"* — they sit inside the whole-morning window
   * rather than carrying a clock of their own, and the stock check is done as
   * required rather than to a duration. Only the three the owner timed
   * separately — an operatory, housekeeping, the sterilisation cycle — have a
   * number here, and only those can drive the start time.
   */
  expectMinutes: number | null;
  /**
   * Whether the clinic may open without it.
   *
   * Everything in the opening procedure is "before first patient", but the
   * owner has since separated two kinds of thing: work the morning cannot be
   * finished without, and work done *"as per requirement"*. Stock is the
   * second — it is real, it is listed, and it does not hold the door.
   */
  mandatory: boolean;
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
  /**
   * Work that is listed and does not hold the door — stock, checked *"as per
   * requirement"*. Separate from `outstanding` so that "what is stopping the
   * clinic opening" and "what else is on somebody's list" are never the same
   * number.
   */
  advisory: readonly ReadinessBlock[];
  /**
   * The latest minute the morning can begin and still be ready on time, and
   * the block that decides it.
   *
   * Two paths run side by side: the sterilisation cycle at 75 minutes, and
   * everything else at 50. The clinic is ready when the longer one finishes,
   * so the start time is the target minus the longer one — and naming which
   * block drives it is the difference between "start at 08:45" and knowing
   * that starting the autoclave late is what makes the morning late.
   *
   * Null when nothing is booked, for the same reason `targetAt` is.
   */
  startBy: number | null;
  startDrivenBy: string | null;
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
  mandatory = true,
): Omit<ReadinessBlock, 'done' | 'doneAt'> =>
  ({ id, label, owner, objective, completedBy, subjectId, expectMinutes,
    ifOutstanding, mandatory });

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
    // The long pole. Owned by the sterilisation technician for the morning
    // run; the per-patient runs during the day may be done by either the
    // technician or a dental assistant, which is turnover rather than opening
    // and so is not one of these blocks.
    block('STERILE', 'Release the morning sterilisation run',
      RoleCode.STERILIZATION_TECHNICIAN, Objective.PATIENT_SAFE,
      ClinicEvent.BATCH_RELEASED, null, STERILIZATION_MINUTES,
      'There are no sterile packs in the cabinets for today'),
    // "Equipment round is to be done by head dental nurse or Head dental
    // assistant" — the senior assistant, which is the role this clinic has
    // for that person. It is one round for the whole clinic because the kit
    // travels on a trolley.
    block('EQUIPMENT', 'Check the equipment',
      RoleCode.SENIOR_ASSISTANT, Objective.PATIENT_SAFE,
      ClinicEvent.EQUIPMENT_VERIFIED, null, null,
      'The equipment has not been checked, so a fault would be found on a patient'),
    block('COMMON_AREAS', 'Clean the floors, pantry and washroom',
      RoleCode.HOUSEKEEPING, Objective.PATIENT_SAFE,
      ClinicEvent.COMMON_AREAS_READY, null, HOUSEKEEPING_MINUTES,
      'The floors and shared areas have not been done'),
    block('RECEPTION', 'Ready the waiting and billing area',
      RoleCode.RECEPTION, Objective.PATIENT_HAPPY,
      ClinicEvent.RECEPTION_READY, null, null,
      'The waiting area is not ready for the first patient'),
    // As required, not every morning: "Inventory is just checked as per
    // requirement". Listed so it is visible and countable, and deliberately
    // not allowed to hold the clinic shut.
    block('STOCK', 'Check stock, as required',
      RoleCode.DENTAL_ASSISTANT, Objective.CLINIC_EFFICIENT,
      ClinicEvent.STOCK_VERIFIED, null, null,
      'Stock has not been counted, so a shortage would be found mid-treatment',
      false),
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

  const required = blocks.filter((b) => b.mandatory);
  const outstanding = required.filter((b) => !b.done);
  const advisory = blocks.filter((b) => !b.mandatory && !b.done);
  const done = required.filter((b) => b.done);
  const ready = unconfigured.length === 0 && outstanding.length === 0;

  // The minute the *last* mandatory block landed — when the clinic actually
  // became ready, not when somebody noticed.
  const readyAt = ready
    ? done.reduce((latest, b) => Math.max(latest, b.doneAt ?? 0), 0)
    : null;

  // The long pole decides the start. Sterilisation only counts towards it
  // while it is still outstanding: once the packs are out, the morning is a
  // fifty-minute job and saying otherwise would push the start time earlier
  // than the work needs.
  const sterileOutstanding = outstanding.some((b) => b.id === 'STERILE');
  const lead = sterileOutstanding
    ? Math.max(STERILIZATION_MINUTES, READINESS_MINUTES)
    : READINESS_MINUTES;

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
    advisory,
    startBy: targetAt === null ? null : targetAt - lead,
    startDrivenBy: targetAt === null
      ? null
      : sterileOutstanding ? 'the sterilisation cycle' : 'the rest of the morning',
    compliance: required.length === 0 ? 0 : done.length / required.length,
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
