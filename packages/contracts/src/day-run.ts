/**
 * The day, running.
 *
 * The owner said: *"I am getting confused with the app as I see no systemized
 * running."* That is a fair reading of what was there. KuBi had a standard, a
 * control matrix, an escalation ladder and a screen for each — and nowhere you
 * could watch them act on one another. A person cannot decide whether a missed
 * washroom round should escalate until they have seen a missed washroom round
 * escalate.
 *
 * So this is the loop, as one pure function of the clock:
 *
 *   STANDARD → falls due at a time → nobody does it → it goes late →
 *   it climbs the ladder → it reaches a named person → and until it is done,
 *   the clinic cannot open, or cannot lock.
 *
 * Two things make it worth having rather than being a toy:
 *
 * 1. **The escalation is the real one.** Rungs come from the frozen matrix's
 *    own escalation column for the control that governs each standard, through
 *    the same `ladder()` and `rungAt()` the rest of the product uses.
 * 2. **Where there is no control, there is no rung, and it says so.** Seven
 *    housekeeping standards escalate to nobody. That is not a bug in this
 *    file — it is the finding, made visible. A run that quietly escalated them
 *    to a plausible-looking manager would hide the exact thing the owner needs
 *    to decide about.
 *
 * Pure and total: same clock and same completed set in, same day out. No
 * `Date.now()`, so a test can stand at 11:20 and stay there.
 */
import { ACTIVITY_LIBRARY } from './activity-library.js';
import { ladder, rungAt, type EscalationRung, type Responsibility } from './work-model.js';
import type { RoleCode } from './enums.js';
import {
  DAILY_STANDARD, Rhythm, RHYTHM_LABEL, type DailyStandard, type Proof,
} from './daily-standard.js';

/* -------------------------------------------------------------------------
 * The clock
 *
 * Minutes from midnight throughout. A clinic day is small enough that a
 * single integer beats a date library, and it makes every test in this file
 * readable: 08:45 is 525.
 * ---------------------------------------------------------------------- */

export const CLINIC_DAY = {
  /** Staff arrive. The opening work becomes visible. */
  staffArrive: 8 * 60,
  /** Everything in the opening gate is due by here. */
  readyBy: 8 * 60 + 45,
  /** Doors open — if the gate is clear. */
  opens: 9 * 60,
  lunch: 14 * 60,
  /** The last patient leaves; the final sterilisation cycle starts. */
  lastPatient: 19 * 60 + 30,
  /** Everything in the closing gate is due by here. */
  closeBy: 20 * 60,
  /** Nobody should still be in the building. */
  locked: 20 * 60 + 30,
} as const;

export function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const am = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${am}`;
}

/**
 * When a standard falls due today — possibly several times.
 *
 * EVERY_PATIENT returns nothing on purpose. Those thirteen are raised by a
 * patient arriving, not by the clock, and putting them on a timeline would
 * claim a schedule that does not exist. The run says so rather than hiding
 * them.
 */
export function dueTimes(s: DailyStandard): number[] {
  switch (s.rhythm) {
    case Rhythm.BEFORE_OPENING:
      return [CLINIC_DAY.readyBy];
    case Rhythm.EVERY_PATIENT:
      return [];
    case Rhythm.HOURLY:
      return every(60, CLINIC_DAY.opens + 60, CLINIC_DAY.lastPatient);
    case Rhythm.TWO_HOURLY:
      return every(120, CLINIC_DAY.opens + 120, CLINIC_DAY.lastPatient);
    case Rhythm.LUNCH:
      return [CLINIC_DAY.lunch];
    case Rhythm.LAST_PATIENT:
      return [CLINIC_DAY.lastPatient];
    case Rhythm.CLOSING:
      return [CLINIC_DAY.closeBy];
    default:
      return [];
  }
}

function every(step: number, from: number, until: number): number[] {
  const out: number[] = [];
  for (let t = from; t <= until; t += step) out.push(t);
  return out;
}

/* -------------------------------------------------------------------------
 * Who hears about it
 * ---------------------------------------------------------------------- */

/**
 * The escalation ladder for a standard, out of the frozen matrix.
 *
 * Null when nothing governs it. Deliberately not defaulted: a plausible
 * fallback would make seventeen ungoverned standards look supervised, and the
 * whole point of running the day is to show that they are not.
 */
export function ladderFor(s: DailyStandard): EscalationRung[] | null {
  if (!s.covers) return null;
  const control = ACTIVITY_LIBRARY.find((a) => a.id === s.covers);
  if (!control || control.escalation.length === 0) return null;

  // The matrix writes these as prose — "Employee", "Manager", "Clinic Head".
  // Kept as written rather than mapped onto RoleCode: a wrong mapping would
  // name the wrong person, which is worse than naming a job title.
  const [l1, l2, l3] = control.escalation;
  const r: Responsibility = {
    doer: (l1 ?? 'Employee') as RoleCode,
    checker: (l2 ?? null) as RoleCode | null,
    owner: (l2 ?? l3 ?? 'Clinic Head') as RoleCode,
    escalation: (l3 ?? l2 ?? 'Clinic Head') as RoleCode,
  };
  return ladder(r);
}

/* -------------------------------------------------------------------------
 * The run
 * ---------------------------------------------------------------------- */

export type ItemState = 'NOT_DUE' | 'DUE' | 'LATE' | 'DONE';

export interface RunItem {
  /** Unique per occurrence: the two-hourly round is a different item at 11:00 and 13:00. */
  key: string;
  standard: DailyStandard;
  dueAt: number;
  state: ItemState;
  minutesLate: number;
  /** Where it has climbed to, in the matrix's own words. Null until it is late. */
  escalatedTo: string | null;
  level: 1 | 2 | 3 | null;
  /** Nothing governs this, so there is nobody for it to reach. */
  unsupervised: boolean;
}

export type ClinicState = 'LOCKED' | 'PREPARING' | 'OPEN' | 'CLOSING' | 'CLOSED';

export interface DayRun {
  now: number;
  nowLabel: string;
  clinic: ClinicState;
  /** Why the clinic is in that state, in one sentence a person would say. */
  why: string;
  /** Outstanding items that hold the doors shut, or hold the keys. */
  blocking: RunItem[];
  items: RunItem[];
  late: RunItem[];
  /** Late, and reaching nobody. The finding, counted. */
  unsupervised: RunItem[];
  /** Raised by a patient arriving, never by the clock. */
  patientDriven: DailyStandard[];
}

/**
 * The whole day at one instant.
 *
 * `done` holds occurrence keys, not standard ids — ticking the 11:00 washroom
 * round must not tick the 13:00 one.
 */
export function runDay(now: number, done: ReadonlySet<string> = new Set()): DayRun {
  const items: RunItem[] = [];

  for (const s of DAILY_STANDARD) {
    const rungs = ladderFor(s);
    for (const dueAt of dueTimes(s)) {
      const key = `${s.id}@${dueAt}`;
      const minutesLate = Math.max(0, now - dueAt);
      const state: ItemState = done.has(key)
        ? 'DONE'
        : now < dueAt - 60 ? 'NOT_DUE'
          : now < dueAt ? 'DUE'
            : 'LATE';

      const rung = state === 'LATE' && rungs ? rungAt(rungs, minutesLate) : null;
      items.push({
        key,
        standard: s,
        dueAt,
        state,
        minutesLate: state === 'LATE' ? minutesLate : 0,
        escalatedTo: rung ? String(rung.to) : null,
        level: rung ? rung.level : null,
        unsupervised: rungs === null,
      });
    }
  }

  items.sort((a, b) => a.dueAt - b.dueAt);

  const late = items.filter((i) => i.state === 'LATE');
  const openingOutstanding = items.filter(
    (i) => i.standard.rhythm === Rhythm.BEFORE_OPENING && i.state !== 'DONE',
  );
  const closingOutstanding = items.filter(
    (i) => i.standard.rhythm === Rhythm.CLOSING && i.state !== 'DONE',
  );

  const { clinic, why, blocking } = stateOf(now, openingOutstanding, closingOutstanding);

  return {
    now,
    nowLabel: clockLabel(now),
    clinic,
    why,
    blocking,
    items,
    late,
    unsupervised: late.filter((i) => i.unsupervised),
    patientDriven: DAILY_STANDARD.filter((s) => s.rhythm === Rhythm.EVERY_PATIENT),
  };
}

/**
 * Where the clinic is, and why.
 *
 * The gates are the point. A clinic whose opening set is incomplete is not
 * open at 09:00 because the clock said so — it is late, and the reason has
 * names on it. Same at the other end: the keys do not turn on a schedule.
 */
function stateOf(
  now: number, openingOutstanding: RunItem[], closingOutstanding: RunItem[],
): { clinic: ClinicState; why: string; blocking: RunItem[] } {
  if (now < CLINIC_DAY.staffArrive) {
    return { clinic: 'LOCKED', why: 'Nobody is in yet.', blocking: [] };
  }

  if (now < CLINIC_DAY.opens || openingOutstanding.length > 0) {
    const n = openingOutstanding.length;
    if (n === 0) {
      return {
        clinic: 'PREPARING',
        why: `Everything is ready. Doors open at ${clockLabel(CLINIC_DAY.opens)}.`,
        blocking: [],
      };
    }
    const late = now >= CLINIC_DAY.opens;
    return {
      clinic: 'PREPARING',
      why: late
        ? `${n} opening ${n === 1 ? 'thing is' : 'things are'} outstanding. `
          + `The clinic is ${now - CLINIC_DAY.opens} minutes late opening.`
        : `${n} of the opening set still to do before ${clockLabel(CLINIC_DAY.opens)}.`,
      blocking: openingOutstanding,
    };
  }

  if (now >= CLINIC_DAY.locked && closingOutstanding.length === 0) {
    return { clinic: 'CLOSED', why: 'Locked, with nothing left behind.', blocking: [] };
  }

  if (now >= CLINIC_DAY.lastPatient) {
    const n = closingOutstanding.length;
    return {
      clinic: 'CLOSING',
      why: n === 0
        ? 'Everything on the closing list is done. The keys can turn.'
        : `${n} closing ${n === 1 ? 'thing' : 'things'} outstanding. `
          + 'Nobody locks up until they are done.',
      blocking: closingOutstanding,
    };
  }

  return { clinic: 'OPEN', why: 'Open and running.', blocking: [] };
}

/* -------------------------------------------------------------------------
 * Provenance
 *
 * Where a task came from, in the words a person would use.
 *
 * The owner's point, and the thing no competitor can show: every piece of work
 * in KuBi traces to a standard somebody wrote down. So any task can answer
 * three questions without leaving the screen —
 *
 *   Why am I doing this?     the standard, in the clinic's own wording
 *   What governs it?         the control, or nothing, said out loud
 *   Who hears if I don't?    the rung, or nobody, said out loud
 *
 * Derived rather than stored on each task. Copying provenance onto every
 * instance is how the copies drift apart, and a task claiming a standard it
 * no longer matches is worse than a task with no provenance at all.
 * ---------------------------------------------------------------------- */

export interface WorkProvenance {
  /** DOS-nn. The row in the daily operating standard. */
  standardId: string;
  /** The owner's KPI for it, verbatim. */
  standard: string;
  /** When in the day it belongs, in words. */
  when: string;
  /** The frozen matrix control that governs it, or null. */
  covers: string | null;
  /** How KuBi would know it happened, in words. */
  proof: string;
  /** Why nothing governs it, or why it cannot be proved. Null when neither. */
  gap: string | null;
  /** Who hears about it first if it is late. Null when nothing governs it. */
  escalatesTo: string | null;
  /** True when there is no ladder at all — nobody hears, ever. */
  unsupervised: boolean;
}

const PROOF_WORD: Record<Proof, string> = {
  SYSTEM: 'KuBi knows on its own',
  READING: 'a reading is recorded',
  CONFIRMATION: 'somebody says so',
  NOT_YET: 'KuBi cannot prove this',
};

export function provenanceOf(s: DailyStandard): WorkProvenance {
  const rungs = ladderFor(s);
  return {
    standardId: s.id,
    standard: s.standard,
    when: RHYTHM_LABEL[s.rhythm].toLowerCase(),
    covers: s.covers,
    proof: PROOF_WORD[s.proof],
    gap: s.gap ?? null,
    escalatesTo: rungs && rungs[0] ? String(rungs[0].to) : null,
    unsupervised: rungs === null,
  };
}

/** The standard behind an id, or null. Used to trace a task back. */
export function standardById(id: string): DailyStandard | null {
  return DAILY_STANDARD.find((s) => s.id === id) ?? null;
}

/**
 * When a role's non-negotiable falls due, as minutes from the clinic opening.
 *
 * The demo's task seed measures everything that way, so this is the one place
 * the rhythm is translated into it. EVERY_PATIENT returns null: those are
 * raised by a patient arriving and putting them on the opening clock would
 * claim a schedule that does not exist.
 */
export function minutesFromOpening(s: DailyStandard): number | null {
  switch (s.rhythm) {
    case Rhythm.BEFORE_OPENING: return CLINIC_DAY.readyBy - CLINIC_DAY.opens;
    case Rhythm.EVERY_PATIENT: return null;
    case Rhythm.HOURLY: return 60;
    case Rhythm.TWO_HOURLY: return 120;
    case Rhythm.LUNCH: return CLINIC_DAY.lunch - CLINIC_DAY.opens;
    case Rhythm.LAST_PATIENT: return CLINIC_DAY.lastPatient - CLINIC_DAY.opens;
    case Rhythm.CLOSING: return CLINIC_DAY.closeBy - CLINIC_DAY.opens;
    default: return null;
  }
}
