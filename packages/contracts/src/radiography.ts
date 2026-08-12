/**
 * CLN-004 — a scan may not be justified by the person who took it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The gap this closes
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `CLN-004 · Pre-treatment scan · Doer Assistant · Checker Doctor · C`
 *
 * KuBi already required the justification — *the clinical question the
 * exposure answers, written before the exposure* — and it recorded who wrote
 * it. What it did not do was refuse a justification written by the person who
 * pressed the button. The Doer and the Checker were two columns in a document
 * and one person in the software.
 *
 * That is the same rule sterilisation has had since it was built: *an operator
 * may not release their own batch.* This is that rule applied to a dose.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * And the rule the matrix does not state, which matters more
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A justification written **after** the exposure is not a justification. It is
 * a rationalisation, and radiation law is unusually clear that the order
 * matters: you decide the exposure is warranted, and *then* you take it.
 *
 * So this engine checks two things, and the second is the one that will catch
 * a real clinic out:
 *
 *   1. **Two people.** Whoever justified is not whoever exposed.
 *   2. **In that order.** The justification is timestamped before the dose.
 *
 * Both are evaluated strictly as of the minute of exposure, exactly as consent
 * is. A justification typed at four o'clock does not make a two o'clock
 * exposure justified — it makes a record that says it was, which is worse than
 * nothing because it looks like compliance.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why the doctor, and not merely somebody else
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The matrix names the Checker as *Doctor*. Justification is a clinical
 * judgement about whether a dose is warranted for this patient, and an
 * assistant checking another assistant's exposure satisfies the letter of
 * "two people" while answering none of the question. So the role is checked as
 * well as the identity.
 */
import { RoleCode } from './enums.js';
import { ClinicEvent } from './operating-model.js';
import { ControlPriority } from './housekeeping.js';
import type { ReadinessEvent } from './readiness.js';

/* -------------------------------------------------------------------------
 * What happened
 * ---------------------------------------------------------------------- */

/**
 * One exposure, as the log records it.
 *
 * `employeeCode` is the person who pressed the button. Not the role — a role
 * cannot press a button, and the whole point of this control is that two
 * *people* were involved.
 */
export interface Exposure {
  /** The booking this exposure belongs to. */
  bookingId: string;
  /** What was taken — "Cone-beam CT", "Periapical, lower right". */
  what: string;
  at: number;
  byEmployeeCode: string;
  byRole: RoleCode;
}

/** The clinical question the exposure answers, written down. */
export interface Justification {
  bookingId: string;
  /** The question, in the doctor's own words. Blank is not a justification. */
  question: string;
  at: number;
  byEmployeeCode: string;
  byRole: RoleCode;
}

/* -------------------------------------------------------------------------
 * What the engine says
 * ---------------------------------------------------------------------- */

export const ExposureVerdict = {
  /** Justified by a doctor, before the dose, and not the person who took it. */
  JUSTIFIED: 'JUSTIFIED',
  /**
   * Nothing written at all.
   *
   * Not the same as a bad justification: one is a gap in the record, the other
   * is a record that is wrong. Different people fix them.
   */
  UNJUSTIFIED: 'UNJUSTIFIED',
  /** Written by the person who took it. CLN-004's Doer and Checker collapsed. */
  SELF_JUSTIFIED: 'SELF_JUSTIFIED',
  /** Written by somebody who is not a doctor. */
  NOT_A_DOCTOR: 'NOT_A_DOCTOR',
  /** Written after the dose. A rationalisation, not a justification. */
  JUSTIFIED_AFTER: 'JUSTIFIED_AFTER',
  /** Written, and it says nothing. */
  NO_QUESTION: 'NO_QUESTION',
} as const;
export type ExposureVerdict = (typeof ExposureVerdict)[keyof typeof ExposureVerdict];

/** Verdicts where a dose was given and the record does not stand up. */
const FAILED: readonly ExposureVerdict[] = [
  ExposureVerdict.UNJUSTIFIED, ExposureVerdict.SELF_JUSTIFIED,
  ExposureVerdict.NOT_A_DOCTOR, ExposureVerdict.JUSTIFIED_AFTER,
  ExposureVerdict.NO_QUESTION,
];

export interface ExposureResult {
  exposure: Exposure;
  verdict: ExposureVerdict;
  justification: Justification | null;
  /**
   * True where a dose was given and the justification does not stand up.
   *
   * Permanent, like a consent breach. Nothing written afterwards clears it,
   * because the patient has already had the dose.
   */
  failed: boolean;
  /** Minutes between the justification and the exposure. Negative when after. */
  leadMinutes: number | null;
  because: string;
}

/**
 * Whether an exposure may be taken *now*, before anybody takes it.
 *
 * The half of this engine that prevents rather than records. `refuseExposure`
 * is what a screen asks before offering the button; `exposures()` is what the
 * register reports afterwards.
 */
export interface ExposureRefusal {
  reason: ExposureVerdict;
  because: string;
  /** Who could fix it, so the sentence ends somewhere useful. */
  ownerRole: RoleCode;
}

export interface RadiographyView {
  results: readonly ExposureResult[];
  /** Doses given whose justification does not stand up. Never empties. */
  failures: readonly ExposureResult[];
  /** Bookings with a justification and no exposure yet — the normal state. */
  justifiedNotTaken: readonly Justification[];
  /** True only when every dose given today stands up. */
  met: boolean;
  headline: string;
}

/* -------------------------------------------------------------------------
 * The calculation
 * ---------------------------------------------------------------------- */

/** Who may justify an exposure. The matrix says Doctor; so does the law. */
const MAY_JUSTIFY: readonly RoleCode[] = [
  RoleCode.TREATING_DOCTOR, RoleCode.CLINICAL_DIRECTOR,
];

/**
 * Where every exposure today stands.
 *
 * Pure. Each exposure is judged against the justifications that existed for
 * its booking, and — the important part — against the ones that existed
 * *before it*. A justification is matched to an exposure only if it was
 * written first, so a late one cannot retro-fit an early dose.
 */
export function radiography(
  exposures: readonly Exposure[],
  justifications: readonly Justification[],
): RadiographyView {
  const results: ExposureResult[] = [...exposures]
    .sort((a, b) => a.at - b.at)
    .map((e) => judge(e, justifications));

  const failures = results.filter((r) => r.failed);
  const usedFor = new Set(results
    .filter((r) => r.justification !== null)
    .map((r) => `${r.justification!.bookingId}#${r.justification!.at}`));

  return {
    results,
    failures,
    justifiedNotTaken: justifications.filter(
      (j) => !usedFor.has(`${j.bookingId}#${j.at}`)),
    met: failures.length === 0,
    headline: headlineFor(results, failures),
  };
}

function judge(e: Exposure, all: readonly Justification[]): ExposureResult {
  const mine = all.filter((j) => j.bookingId === e.bookingId);

  // Written before the dose, and the latest such. A justification that arrived
  // afterwards is not a candidate at all — matching it would be the engine
  // doing the retro-fitting it exists to prevent.
  const before = mine.filter((j) => j.at <= e.at).sort((a, b) => b.at - a.at);
  const chosen = before[0] ?? null;

  const fail = (verdict: ExposureVerdict, because: string,
    justification: Justification | null = chosen): ExposureResult => ({
    exposure: e, verdict, justification, failed: FAILED.includes(verdict),
    leadMinutes: justification === null ? null : e.at - justification.at,
    because,
  });

  if (chosen === null) {
    // Say which of the two it is. "Nothing written" and "written afterwards"
    // are the same verdict to a regulator and completely different
    // conversations inside a clinic.
    const late = mine.filter((j) => j.at > e.at).sort((a, b) => a.at - b.at)[0];
    if (late !== undefined) {
      return {
        exposure: e, verdict: ExposureVerdict.JUSTIFIED_AFTER,
        justification: late, failed: true,
        leadMinutes: e.at - late.at,
        because: `${e.what} was taken at ${clock(e.at)} and justified at `
          + `${clock(late.at)} — ${late.at - e.at} minutes afterwards. `
          + 'A justification written after the dose is a rationalisation.',
      };
    }
    return fail(ExposureVerdict.UNJUSTIFIED,
      `${e.what} was taken at ${clock(e.at)} with nothing written about why.`,
      null);
  }

  if (chosen.question.trim() === '') {
    return fail(ExposureVerdict.NO_QUESTION,
      `${e.what} has a justification with no clinical question in it.`);
  }

  // CLN-004's Doer and Checker, collapsed into one person. The same rule
  // sterilisation applies to a batch, applied to a dose.
  if (chosen.byEmployeeCode === e.byEmployeeCode) {
    return fail(ExposureVerdict.SELF_JUSTIFIED,
      `${e.what} was justified by the person who took it. CLN-004 names the `
      + 'assistant as Doer and the doctor as Checker, and one person cannot '
      + 'be both.');
  }

  // Two people is not enough. Justification is a clinical judgement about
  // whether this dose is warranted for this patient, and an assistant checking
  // another assistant answers none of that question.
  if (!MAY_JUSTIFY.includes(chosen.byRole)) {
    return fail(ExposureVerdict.NOT_A_DOCTOR,
      `${e.what} was justified by a ${roleWord(chosen.byRole)}. CLN-004 names `
      + 'the doctor as Checker — deciding a dose is warranted is a clinical '
      + 'judgement.');
  }

  return {
    exposure: e, verdict: ExposureVerdict.JUSTIFIED, justification: chosen,
    failed: false, leadMinutes: e.at - chosen.at,
    because: `Justified at ${clock(chosen.at)}, ${e.at - chosen.at} minutes `
      + `before the exposure — “${chosen.question}”`,
  };
}

/**
 * May this exposure be taken, by this person, right now?
 *
 * The preventive half. A screen asks this before offering the button, so the
 * refusal happens at the moment somebody could still fetch the doctor rather
 * than in a report a week later.
 *
 * Returns null when the exposure may go ahead.
 */
export function refuseExposure(
  bookingId: string,
  byEmployeeCode: string,
  now: number,
  justifications: readonly Justification[],
): ExposureRefusal | null {
  const before = justifications
    .filter((j) => j.bookingId === bookingId && j.at <= now)
    .sort((a, b) => b.at - a.at);
  const chosen = before[0];

  if (chosen === undefined) {
    return {
      reason: ExposureVerdict.UNJUSTIFIED,
      because: 'Nothing has been written about why this exposure is needed. '
        + 'The justification comes first — that is the order the law puts it '
        + 'in, and writing it afterwards does not count.',
      ownerRole: RoleCode.TREATING_DOCTOR,
    };
  }
  if (chosen.question.trim() === '') {
    return {
      reason: ExposureVerdict.NO_QUESTION,
      because: 'The justification on this booking has no clinical question in '
        + 'it. “Routine” is not a question.',
      ownerRole: RoleCode.TREATING_DOCTOR,
    };
  }
  if (chosen.byEmployeeCode === byEmployeeCode) {
    return {
      reason: ExposureVerdict.SELF_JUSTIFIED,
      because: 'You wrote the justification for this exposure, so you may not '
        + 'also take it. CLN-004 names the assistant as Doer and the doctor as '
        + 'Checker, and one person cannot be both.',
      ownerRole: RoleCode.TREATING_DOCTOR,
    };
  }
  if (!MAY_JUSTIFY.includes(chosen.byRole)) {
    return {
      reason: ExposureVerdict.NOT_A_DOCTOR,
      because: `This exposure was justified by a ${roleWord(chosen.byRole)}. `
        + 'Deciding a dose is warranted is a clinical judgement and CLN-004 '
        + 'names the doctor.',
      ownerRole: RoleCode.TREATING_DOCTOR,
    };
  }
  return null;
}

/** The failing exposures, as findings the dashboard can carry. */
export interface RadiographyFinding {
  control: string;
  priority: ControlPriority;
  what: string;
  ownerRole: RoleCode;
}

export function radiographyFindings(v: RadiographyView): RadiographyFinding[] {
  return v.failures.map((r) => ({
    control: 'CLN-004',
    // C in the matrix, and it stays C: the dose has been given and the harm,
    // if any, is done. What is at stake now is the record and the licence.
    priority: ControlPriority.C,
    what: `${r.exposure.what} — ${r.because}`,
    ownerRole: RoleCode.QUALITY_COMPLIANCE,
  }));
}

function headlineFor(
  results: readonly ExposureResult[], failures: readonly ExposureResult[],
): string {
  if (results.length === 0) return 'No exposure has been taken today.';
  if (failures.length === 0) {
    return `${results.length} exposure${results.length === 1 ? '' : 's'} today, `
      + 'each justified by a doctor before it was taken.';
  }
  return `${failures.length} of ${results.length} exposure`
    + `${results.length === 1 ? '' : 's'} today ${failures.length === 1 ? 'does' : 'do'} `
    + 'not have a justification that stands up.';
}

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const roleWord = (r: RoleCode) => String(r).toLowerCase().replace(/_/g, ' ');

/* -------------------------------------------------------------------------
 * Reading the log
 * ---------------------------------------------------------------------- */

/**
 * The two events, and why the question travels beside them.
 *
 * `ReadinessEvent` carries no payload, so the subject holds the compound
 * `bookingId#employeeCode#ROLE` this codebase already uses for `SKU#qty` and
 * `tag#cycle`. The clinical question is prose and belongs in a record, not in
 * a subject string — so it travels alongside, keyed by the same minute, the
 * same way the emergency checklist's rows do.
 */
export const EXPOSURE_TAKEN = ClinicEvent.EXPOSURE_TAKEN;
export const EXPOSURE_JUSTIFIED = ClinicEvent.EXPOSURE_JUSTIFIED;

export function exposuresFrom(
  events: readonly ReadinessEvent[],
  whatByMinute: ReadonlyMap<number, string>,
): Exposure[] {
  return events
    .filter((e) => e.type === ClinicEvent.EXPOSURE_TAKEN)
    .map((e) => {
      const [bookingId = '', employeeCode = '', role = ''] = e.subjectId.split('#');
      return {
        bookingId,
        what: whatByMinute.get(e.at) ?? 'Radiograph',
        at: e.at,
        byEmployeeCode: employeeCode,
        byRole: role as RoleCode,
      };
    });
}

export function justificationsFrom(
  events: readonly ReadinessEvent[],
  questionByMinute: ReadonlyMap<number, string>,
): Justification[] {
  return events
    .filter((e) => e.type === ClinicEvent.EXPOSURE_JUSTIFIED)
    .map((e) => {
      const [bookingId = '', employeeCode = '', role = ''] = e.subjectId.split('#');
      return {
        bookingId,
        question: questionByMinute.get(e.at) ?? '',
        at: e.at,
        byEmployeeCode: employeeCode,
        byRole: role as RoleCode,
      };
    });
}

/** The columns the radiography register must carry. */
export const RADIOGRAPHY_SHEET_COLUMNS: readonly string[] = [
  'date', 'booking_id', 'what', 'justified_at', 'justified_by',
  'clinical_question', 'exposed_at', 'exposed_by',
];

/**
 * What this control still does not settle.
 *
 * Constitution rule 4.
 */
export const RADIOGRAPHY_QUESTIONS: readonly string[] = [
  'How long may a justification stand before the exposure? A question written '
  + 'at Monday’s consultation is a reasonable basis for Tuesday’s radiograph '
  + 'and probably not for one in six weeks. KuBi does not expire them.',
  'May one justification cover a series — four bitewings, or a trauma '
  + 'follow-up sequence? KuBi matches each exposure to the most recent '
  + 'justification before it, so one covers many, and nobody has said whether '
  + 'that is right.',
  'Who justifies when the doctor taking the radiograph is the only clinician '
  + 'in the building? CLN-004 assumes two people are available, and a '
  + 'single-handed session is the case where the rule bites hardest.',
];
