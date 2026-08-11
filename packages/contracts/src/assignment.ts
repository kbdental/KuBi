/**
 * Which assistant covers which chair today.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The gap this closes
 * ─────────────────────────────────────────────────────────────────────────
 *
 * PAT-001.a: *"Dental Assistants must be aware of all appointments for the day
 * in their assigned operatory."* The clinic has four operatories and two
 * assistants, and no assignment existed anywhere in KuBi. So the sentence had
 * nothing to stand on — an assistant cannot be aware of the appointments in
 * "her" operatory when the software does not know which one that is.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The room carries the assistant, not the appointment
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The obvious fix — type an assistant on every booking — is the same mistake
 * the appointment book had already made once. Two hundred bookings a month
 * each naming a person is two hundred places for the roster to be wrong, and
 * nobody updates two hundred rows when somebody calls in sick.
 *
 * So the **room** is assigned, once a day, and an appointment inherits its
 * assistant from the room it is booked into. A booking may still name somebody
 * else — a genuine swap happens — and when it does that is reported as an
 * override rather than absorbed silently, because a swap nobody can see is a
 * roster that has quietly stopped describing the clinic.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The finding nothing else could produce
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Two assistants and four rooms means somebody covers two chairs, and two
 * chairs can run at the same time. **One person cannot be in two rooms at
 * once**, and until the rooms had names against them there was nothing in KuBi
 * that could notice. `clashes` is arithmetic on two intervals, not an opinion,
 * and it is the kind of thing a clinic discovers at 11:05 when the second
 * patient is already in the chair.
 */
import { RoleCode } from './enums.js';
import { ControlPriority } from './housekeeping.js';

/* -------------------------------------------------------------------------
 * The assignment
 * ---------------------------------------------------------------------- */

export interface RoomAssignment {
  operatoryId: string;
  /**
   * The assistant who covers this chair today.
   *
   * Null is a real state and not a placeholder: a room with no assistant and
   * no appointments is simply not in use, and a room with no assistant and
   * three appointments is the clinic's most urgent staffing problem.
   */
  assistantEmployeeCode: string | null;
  /**
   * Who covers it when the assigned assistant is not here.
   *
   * ATT-007 already asks for cover to be *named* on approved leave. This is
   * the same rule one level down — the difference between "Priya is off, so
   * Operatory 3 is nobody's" and "Priya is off, Nisha has 3 and 4".
   */
  standInEmployeeCode: string | null;
}

/**
 * The assignment is the clinic's to make, and KuBi has not been told it.
 *
 * Two assistants and four rooms admits several sensible answers — by corridor,
 * by treatment type, by seniority — and they are not equivalent: pairing the
 * two surgical rooms under one person is what produces the clash below. The
 * demo carries a plausible split so the engine is real and testable, and this
 * flag says plainly that nobody has signed it.
 */
export const UNRATIFIED_ASSIGNMENT = true;

export const ASSIGNMENT_QUESTIONS: readonly string[] = [
  'Which two operatories does each assistant cover, and on what basis — by '
  + 'corridor, by treatment type, or by seniority? The answers are not '
  + 'equivalent: putting both surgical rooms under one person is what creates '
  + 'a clash when two long cases run together.',
  'When an assistant is absent, does her stand-in take both her rooms or does '
  + 'the day get rebuilt? KuBi can only report cover that has been named.',
  'May an appointment name an assistant other than the room’s? KuBi allows it '
  + 'and reports it as an override, on the assumption that a swap is real and '
  + 'should be visible.',
];

/* -------------------------------------------------------------------------
 * What the engine says
 * ---------------------------------------------------------------------- */

/** One appointment, as far as chair cover is concerned. */
export interface CoveredSlot {
  id: string;
  patientLabel: string;
  operatoryId: string | null;
  at: number;
  endsAt: number;
  /** Named on the appointment itself, where one is. */
  namedAssistant: string | null;
}

export const CoverState = {
  /** Assigned, and that person is in the building. */
  COVERED: 'COVERED',
  /** Assigned, they are not here, and a stand-in is named and present. */
  STOOD_IN: 'STOOD_IN',
  /** Has appointments and nobody to staff them. */
  UNCOVERED: 'UNCOVERED',
  /** Nobody assigned, and nothing booked. Not a problem. */
  UNUSED: 'UNUSED',
} as const;
export type CoverState = (typeof CoverState)[keyof typeof CoverState];

export interface RoomCover {
  operatoryId: string;
  label: string;
  state: CoverState;
  /** Who is actually covering it — the assistant, the stand-in, or nobody. */
  coveredBy: string | null;
  assignedTo: string | null;
  standInEmployeeCode: string | null;
  /** Today's appointments in this room, in time order. */
  slots: readonly CoveredSlot[];
  /** Minutes of chair time booked here today. */
  bookedMinutes: number;
  because: string;
}

/**
 * One person needed in two rooms at the same time.
 *
 * Arithmetic on two intervals. Reported as a pair rather than as a property of
 * either appointment, because neither of them is the problem — the overlap is.
 */
export interface Clash {
  assistantEmployeeCode: string;
  first: CoveredSlot;
  second: CoveredSlot;
  /** How many minutes the two overlap. */
  overlapMinutes: number;
  because: string;
}

/** What one assistant is carrying today. */
export interface AssistantLoad {
  employeeCode: string;
  present: boolean;
  rooms: readonly string[];
  slots: number;
  bookedMinutes: number;
}

export interface CoverFinding {
  control: string;
  priority: ControlPriority;
  what: string;
  ownerRole: RoleCode;
}

export interface CoverView {
  rooms: readonly RoomCover[];
  /** Rooms with work and nobody to do it. The clinic's most urgent staffing gap. */
  uncovered: readonly RoomCover[];
  /** Somebody needed in two places at once. */
  clashes: readonly Clash[];
  /** Appointments naming an assistant other than their room's. */
  overrides: readonly CoveredSlot[];
  /** Appointments with no room, so cover cannot be worked out at all. */
  unplaced: readonly CoveredSlot[];
  load: readonly AssistantLoad[];
  findings: readonly CoverFinding[];
  headline: string;
}

/* -------------------------------------------------------------------------
 * The calculation
 * ---------------------------------------------------------------------- */

/**
 * Who is covering which chair, and where that falls apart.
 *
 * Pure. `present` comes from the attendance engine and absent means UNKNOWN —
 * a book read before the attendance sheet must not report every room as
 * uncovered, so an undefined set produces no staffing findings at all.
 *
 * `label` resolves an operatory id to how a person says it, passed in for the
 * same reason as everywhere else: this file does not own the operatory master.
 */
export function chairCover(
  operatories: readonly { id: string; label: string }[],
  assignments: readonly RoomAssignment[],
  slots: readonly CoveredSlot[],
  present: ReadonlySet<string> | undefined,
  now: number,
): CoverView {
  void now;
  const byRoom = new Map(assignments.map((a) => [a.operatoryId, a]));
  const isHere = (code: string | null): boolean =>
    code !== null && (present === undefined || present.has(code));

  const rooms: RoomCover[] = operatories.map((o) => {
    const a = byRoom.get(o.id);
    const mine = slots
      .filter((s) => s.operatoryId === o.id)
      .sort((x, y) => x.at - y.at);
    const bookedMinutes = mine.reduce((n, s) => n + (s.endsAt - s.at), 0);

    const assigned = a?.assistantEmployeeCode ?? null;
    const standIn = a?.standInEmployeeCode ?? null;

    // Nothing booked comes first. A room with an assistant against it and no
    // patients is not "covered" — it is not in use, and counting it as a
    // staffed chair made the headline claim four chairs running on a morning
    // with one appointment.
    const state: CoverState =
      mine.length === 0 ? CoverState.UNUSED
        : assigned !== null && isHere(assigned) ? CoverState.COVERED
          : isHere(standIn) ? CoverState.STOOD_IN
            : CoverState.UNCOVERED;

    const coveredBy = state === CoverState.COVERED ? assigned
      : state === CoverState.STOOD_IN ? standIn : null;

    return {
      operatoryId: o.id,
      label: o.label,
      state,
      coveredBy,
      assignedTo: assigned,
      standInEmployeeCode: standIn,
      slots: mine,
      bookedMinutes,
      because: becauseFor(state, o.label, assigned, standIn, mine.length),
    };
  });

  /* ── One person, two rooms, one minute ────────────────────────────── */
  //
  // The finding nothing else in KuBi could produce, because until the rooms
  // had names against them there was nothing to compare.
  const clashes: Clash[] = [];
  const coverOf = (s: CoveredSlot): string | null =>
    s.namedAssistant ?? rooms.find((r) => r.operatoryId === s.operatoryId)?.coveredBy
    ?? null;

  const byPerson = new Map<string, CoveredSlot[]>();
  for (const s of slots) {
    const who = coverOf(s);
    if (who === null || s.operatoryId === null) continue;
    byPerson.set(who, [...(byPerson.get(who) ?? []), s]);
  }
  for (const [who, theirs] of byPerson) {
    const ordered = [...theirs].sort((a, b) => a.at - b.at);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i]!;
        const b = ordered[j]!;
        if (a.operatoryId === b.operatoryId) continue;
        const overlap = Math.min(a.endsAt, b.endsAt) - Math.max(a.at, b.at);
        if (overlap <= 0) continue;
        clashes.push({
          assistantEmployeeCode: who,
          first: a,
          second: b,
          overlapMinutes: overlap,
          because: `${a.patientLabel} and ${b.patientLabel} overlap by `
            + `${overlap} minutes in two different rooms, and the same assistant `
            + 'is down for both.',
        });
      }
    }
  }

  /* ── Overrides and unplaced work ──────────────────────────────────── */
  const overrides = slots.filter((s) => {
    if (s.namedAssistant === null || s.operatoryId === null) return false;
    const room = rooms.find((r) => r.operatoryId === s.operatoryId);
    return room !== undefined
      && room.assignedTo !== null
      && room.assignedTo !== s.namedAssistant;
  });
  const unplaced = slots.filter((s) => s.operatoryId === null);

  /* ── What each assistant is carrying ──────────────────────────────── */
  const people = new Set<string>([
    ...assignments.map((a) => a.assistantEmployeeCode),
    ...assignments.map((a) => a.standInEmployeeCode),
    ...slots.map((s) => s.namedAssistant),
  ].filter((c): c is string => c !== null));

  const load: AssistantLoad[] = [...people].sort().map((code) => {
    const theirs = slots.filter((s) => coverOf(s) === code);
    return {
      employeeCode: code,
      present: isHere(code),
      rooms: rooms.filter((r) => r.coveredBy === code).map((r) => r.operatoryId),
      slots: theirs.length,
      bookedMinutes: theirs.reduce((n, s) => n + (s.endsAt - s.at), 0),
    };
  });

  const uncovered = rooms.filter((r) => r.state === CoverState.UNCOVERED);

  return {
    rooms,
    uncovered,
    clashes,
    overrides,
    unplaced,
    load,
    findings: findingsFrom(rooms, uncovered, clashes, overrides, unplaced),
    headline: headlineFor(uncovered, clashes, rooms),
  };
}

function becauseFor(
  state: CoverState, label: string, assigned: string | null,
  standIn: string | null, slots: number,
): string {
  switch (state) {
    case CoverState.COVERED:
      return `${slots} booked. Covered as assigned.`;
    case CoverState.STOOD_IN:
      return `${slots} booked. The assigned assistant is not here; the named `
        + 'stand-in is covering.';
    case CoverState.UNCOVERED:
      return assigned === null
        ? `${slots} booked into ${label} and no assistant is assigned to it.`
        : standIn === null
          ? `${slots} booked, the assigned assistant is not here, and no `
            + 'stand-in has been named.'
          : `${slots} booked, and neither the assigned assistant nor the `
            + 'named stand-in is here.';
    default:
      return 'Nothing booked here today.';
  }
}

function findingsFrom(
  rooms: readonly RoomCover[], uncovered: readonly RoomCover[],
  clashes: readonly Clash[], overrides: readonly CoveredSlot[],
  unplaced: readonly CoveredSlot[],
): CoverFinding[] {
  const out: CoverFinding[] = [];

  for (const r of uncovered) {
    out.push({
      control: 'PAT-001.a',
      priority: ControlPriority.C,
      what: `${r.label} has ${r.slots.length} appointment`
        + `${r.slots.length === 1 ? '' : 's'} and nobody to staff `
        + `${r.slots.length === 1 ? 'it' : 'them'}. ${r.because}`,
      ownerRole: RoleCode.CLINIC_MANAGER,
    });
  }

  // A clash is patient safety rather than a rota inconvenience: the second
  // patient is in a chair with nobody at it, and that is where a swallowed
  // instrument or an unmonitored sedation comes from.
  for (const c of clashes) {
    out.push({
      control: 'PAT-001.a',
      priority: ControlPriority.PS,
      what: `One assistant is down for two rooms at once — ${c.because}`,
      ownerRole: RoleCode.CLINIC_MANAGER,
    });
  }

  for (const s of unplaced) {
    out.push({
      control: 'APT-001.c',
      priority: ControlPriority.C,
      what: `${s.patientLabel} has no operatory, so no assistant can be `
        + 'worked out for them either.',
      ownerRole: RoleCode.RECEPTION,
    });
  }

  // Not a failure. A swap is real and happens; what must not happen is a swap
  // nobody can see, because that is a roster that has stopped describing the
  // clinic.
  for (const s of overrides) {
    const room = rooms.find((r) => r.operatoryId === s.operatoryId);
    out.push({
      control: 'PAT-001.a',
      priority: ControlPriority.I,
      what: `${s.patientLabel} names an assistant other than ${room?.label}’s. `
        + 'Fine if it is a deliberate swap, and worth knowing.',
      ownerRole: RoleCode.RECEPTION,
    });
  }

  return out.sort((a, b) => RANK[a.priority] - RANK[b.priority]);
}

const RANK: Record<ControlPriority, number> = { PS: 0, C: 1, I: 2, R: 3 };

function headlineFor(
  uncovered: readonly RoomCover[], clashes: readonly Clash[],
  rooms: readonly RoomCover[],
): string {
  if (clashes.length > 0) {
    return `${clashes.length} time${clashes.length === 1 ? '' : 's'} today an `
      + 'assistant is needed in two rooms at once.';
  }
  if (uncovered.length > 0) {
    return `${uncovered[0]!.label} has work and nobody to do it.`;
  }
  const inUse = rooms.filter((r) => r.state !== CoverState.UNUSED);
  if (inUse.length === 0) return 'No chair has work today.';
  return `${inUse.length} chair${inUse.length === 1 ? '' : 's'} in use, all covered.`;
}

/**
 * The assistant a booking should get, given the room it is in.
 *
 * The one-line reason the room carries the assignment: reception books a
 * patient into a chair, and who staffs that chair is a fact about the day
 * rather than a fact about the patient.
 */
export function assistantForRoom(
  operatoryId: string | null, assignments: readonly RoomAssignment[],
  present: ReadonlySet<string> | undefined,
): string | null {
  if (operatoryId === null) return null;
  const a = assignments.find((x) => x.operatoryId === operatoryId);
  if (a === undefined) return null;
  const here = (code: string | null) =>
    code !== null && (present === undefined || present.has(code));
  if (here(a.assistantEmployeeCode)) return a.assistantEmployeeCode;
  if (here(a.standInEmployeeCode)) return a.standInEmployeeCode;
  // The assigned person, even though they are not here. Returning null would
  // read as "nobody is assigned", which is a different problem from "the
  // person assigned has not come in".
  return a.assistantEmployeeCode;
}

/** The columns the assignment sheet must carry. */
export const ASSIGNMENT_SHEET_COLUMNS: readonly string[] = [
  'date', 'operatory', 'assistant', 'stand_in',
];
