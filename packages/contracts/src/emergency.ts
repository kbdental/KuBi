/**
 * OPEN-012 — morning emergency readiness.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The one uncovered control that was never about the light switches
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Seven opening controls had no block. Six of them were one thing wearing six
 * matrix rows — unlocking the building, the lights, the ACs, the diffuser, the
 * water, the pump. This was the seventh, and it never belonged in that group:
 *
 *   `OPEN-012 · Morning emergency readiness · Required emergency resources
 *   accessible · Daily · Assistant · Doctor · Checklist · PS ·
 *   Clinic safety alert`
 *
 * Priority **PS**. Checker **Doctor**. The failure mode is not an inconvenient
 * morning; it is a person in the chair going into anaphylaxis while somebody
 * looks for a key. Everything below follows from taking that seriously.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What was there before, and why it was not enough
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The compliance engine already had an `EMERGENCY_READY` gate, and it was fed
 * by a proxy: *are the two assets `EMERGENCY-01` and `OXYGEN-01` neither down
 * nor overdue?* That is a statement about a register, not about a kit. It
 * cannot tell you the adrenaline expired in June, that there are no
 * paediatric masks, or that the cupboard is locked and the key went home in
 * somebody's pocket. The matrix asks for a **checklist**, and a checklist is a
 * list of things, each of which is separately true or not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Three rules that make this different from a tick sheet
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **1. An unasked question fails.** Constitution rule 1. An item nobody
 * counted this morning is `UNCHECKED`, and `UNCHECKED` does not pass. A daily
 * check that quietly inherits yesterday's answer is the exact failure this
 * control exists to prevent — the kit was fine yesterday is what everybody
 * says afterwards.
 *
 * **2. Expiry is a date, not an opinion.** A drug past its date is as absent
 * as one that was never bought, and no amount of "we checked it" changes that.
 * Expiry is computed against `now` on every read, so a kit that passes on the
 * 30th fails on the 1st with nobody doing anything.
 *
 * **3. The person who checks it may not be the person who signs it off.** The
 * matrix names two roles, Doer and Checker, and they are different for a
 * reason — the same reason a sterilisation operator may not release their own
 * batch. `verify()` refuses a verification by the person who reported it, and
 * refuses one by anybody who is not a doctor.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What KuBi will not do
 * ─────────────────────────────────────────────────────────────────────────
 *
 * It will not tell you your emergency kit is complete against a list this file
 * invented. The contents below are drawn from ordinary dental practice — the
 * drugs and equipment a clinic is expected to be able to reach in the first
 * five minutes of a collapse — but *which* kit this clinic carries is a
 * clinical and statutory decision belonging to the owner and the treating
 * doctors, not to software. `UNRATIFIED_EMERGENCY_KIT` says so until they sign
 * it, and the screen says so too.
 */
import { RoleCode } from './enums.js';
import { ClinicEvent } from './operating-model.js';
import type { ReadinessEvent } from './readiness.js';

/* -------------------------------------------------------------------------
 * The contents list
 * ---------------------------------------------------------------------- */

/** What kind of thing it is, which decides how it can fail. */
export const EmergencyKind = {
  /** Carries an expiry date, and expires whether anybody looks or not. */
  DRUG: 'DRUG',
  /** A device. Fails by being broken, flat, or absent. */
  DEVICE: 'DEVICE',
  /** Single-use, and runs out. */
  CONSUMABLE: 'CONSUMABLE',
  /** A number on a wall. Fails by being wrong or missing, never by expiring. */
  INFORMATION: 'INFORMATION',
} as const;
export type EmergencyKind = (typeof EmergencyKind)[keyof typeof EmergencyKind];

export interface EmergencyItem {
  id: string;
  name: string;
  kind: EmergencyKind;
  /** How many the contents list says. */
  required: number;
  /**
   * Whether its absence stops treatment.
   *
   * The distinction is not "important" versus "unimportant" — everything on
   * this list is here because somebody could die without it. It is whether
   * this clinic can safely see patients *this morning* while it is missing.
   * No adrenaline and no oxygen: no patients. A missing spacer is serious and
   * the day continues while somebody fetches one.
   */
  critical: boolean;
  /** The emergency it is for, so the list reads as scenarios, not stores. */
  forWhat: string;
  /** Said to whoever finds it missing, in the words that make them act. */
  ifMissing: string;
  /**
   * How many days before expiry it should be replaced.
   *
   * Not a nicety. Ordering adrenaline takes days, and a kit that only tells
   * you on the morning it expires has told you too late.
   */
  replaceDaysBefore: number;
}

const drug = (
  id: string, name: string, required: number, forWhat: string,
  ifMissing: string, critical = true, replaceDaysBefore = 30,
): EmergencyItem =>
  ({ id, name, kind: EmergencyKind.DRUG, required, critical, forWhat, ifMissing, replaceDaysBefore });

const device = (
  id: string, name: string, required: number, forWhat: string,
  ifMissing: string, critical = true, replaceDaysBefore = 0,
): EmergencyItem =>
  ({ id, name, kind: EmergencyKind.DEVICE, required, critical, forWhat, ifMissing, replaceDaysBefore });

const consumable = (
  id: string, name: string, required: number, forWhat: string,
  ifMissing: string, critical = true, replaceDaysBefore = 30,
): EmergencyItem =>
  ({ id, name, kind: EmergencyKind.CONSUMABLE, required, critical, forWhat, ifMissing, replaceDaysBefore });

const info = (
  id: string, name: string, forWhat: string, ifMissing: string,
): EmergencyItem =>
  ({ id, name, kind: EmergencyKind.INFORMATION, required: 1, critical: true, forWhat, ifMissing, replaceDaysBefore: 0 });

/**
 * What the clinic must be able to reach in the first five minutes.
 *
 * Ordered by the emergency rather than by the shelf, because that is how it
 * will be read at the moment it matters — nobody looks up "drugs, injectable"
 * while a patient is on the floor. Anaphylaxis first: it is the one that kills
 * fastest and the one a dental clinic is most likely to cause.
 */
export const EMERGENCY_KIT: readonly EmergencyItem[] = [
  /* ── Anaphylaxis ─────────────────────────────────────────────────── */
  drug('ADRENALINE', 'Adrenaline 1:1000 ampoules (1 mg/mL)', 3, 'Anaphylaxis',
    'Anaphylaxis is survivable with adrenaline in the first minutes and very '
    + 'often is not without it. No treatment may start.'),
  drug('HYDROCORTISONE', 'Hydrocortisone injection 100 mg', 2, 'Anaphylaxis, adrenal crisis',
    'The second-line drug after adrenaline, and the one that stops the '
    + 'rebound hours later.'),
  drug('ANTIHISTAMINE', 'Chlorpheniramine injection 10 mg', 2, 'Allergic reaction',
    'A reaction that is not yet anaphylaxis still has to be treated, and '
    + 'without this it is watched instead.'),

  /* ── Airway and breathing ────────────────────────────────────────── */
  device('OXYGEN', 'Oxygen cylinder with regulator, in date and not empty', 1,
    'Every emergency',
    'Oxygen is the one thing wanted in almost every emergency on this list.'),
  device('MASKS', 'Oxygen masks — adult and paediatric, with tubing', 2, 'Every emergency',
    'A cylinder nobody can connect a mask to delivers nothing.'),
  device('BVM', 'Bag-valve-mask with adult and paediatric masks', 1,
    'Respiratory or cardiac arrest',
    'Without it a patient who stops breathing cannot be ventilated at all.'),
  device('AIRWAYS', 'Oropharyngeal airways — sizes 2, 3 and 4', 3,
    'Unconscious patient',
    'An unconscious patient obstructs on their own tongue within seconds.'),
  device('SUCTION_PORTABLE', 'Suction available for emergency use, with wide-bore tip', 1,
    'Vomiting, bleeding, obstruction',
    'The chairside suction is no use to a patient on the floor.'),
  drug('SALBUTAMOL', 'Salbutamol inhaler 100 mcg', 1, 'Asthma, bronchospasm',
    'Asthma is common, it is provoked by anxiety, and this is the treatment.'),
  device('SPACER', 'Large-volume spacer for the inhaler', 1, 'Asthma',
    'A distressed patient cannot coordinate an inhaler without one.', false),

  /* ── Circulation ─────────────────────────────────────────────────── */
  drug('GTN', 'Glyceryl trinitrate spray 400 mcg', 1, 'Angina',
    'Chest pain in the chair is angina until proved otherwise, and this is '
    + 'what settles it or does not.'),
  drug('ASPIRIN', 'Aspirin 300 mg dispersible', 2, 'Suspected heart attack',
    'One tablet, chewed, in the first minutes. It is the single most useful '
    + 'thing a dental clinic can do for a myocardial infarction.'),
  // A device with a date on it. The pads dry out and the battery flattens,
  // and both are ordered rather than found in a drawer — so it carries a
  // replacement window even though it is not a drug.
  device('AED', 'Defibrillator with pads in date and battery charged', 1,
    'Cardiac arrest',
    'Survival falls by around ten per cent for every minute without it.',
    true, 30),

  /* ── Glucose and seizures ────────────────────────────────────────── */
  drug('GLUCOSE_ORAL', 'Oral glucose gel or 20 g glucose powder', 2, 'Hypoglycaemia',
    'A hypoglycaemic diabetic looks like a faint and is treated completely '
    + 'differently.'),
  device('GLUCOMETER', 'Glucometer with in-date strips and lancets', 1, 'Hypoglycaemia',
    'Guessing at blood glucose is how a hypo is treated as a faint.',
    true, 30),
  drug('MIDAZOLAM', 'Midazolam 10 mg — buccal or intramuscular', 1, 'Prolonged seizure',
    'A seizure past five minutes needs treating and there is nothing else '
    + 'in the clinic that will do it.'),

  /* ── Giving the drugs ────────────────────────────────────────────── */
  consumable('SYRINGES', 'Sterile syringes and needles for intramuscular use', 5,
    'Every injectable above',
    'Injectable drugs with nothing to draw them up with are decoration.'),
  device('MONITOR', 'Blood pressure monitor and pulse oximeter', 1,
    'Assessing any collapse',
    'Without numbers, a collapse is described rather than assessed.'),

  /* ── Getting help ────────────────────────────────────────────────── */
  info('CONTACTS', 'Ambulance number and nearest A&E, displayed by the telephone',
    'Every emergency',
    'The number has to be readable by somebody who is frightened, not '
    + 'remembered by somebody who is calm.'),
  info('DOSAGE_CHART', 'Emergency drug dosage chart, adult and paediatric',
    'Every drug above',
    'Paediatric doses are weight-based and nobody calculates well during '
    + 'an arrest.'),
];

export const KIT_BY_ID: ReadonlyMap<string, EmergencyItem> =
  new Map(EMERGENCY_KIT.map((i) => [i.id, i]));

/**
 * The list above is not the clinic's until the clinic says it is.
 *
 * Same rule as the treatment catalogue and the asset register, and it matters
 * more here than in either: an emergency kit's contents are a clinical and
 * statutory decision. KuBi will run the control against this list so that the
 * machinery is real and testable, and it will keep saying, on every screen
 * that shows it, that nobody has signed it off.
 */
export const UNRATIFIED_EMERGENCY_KIT = true;

/**
 * Owner decisions this control cannot make for itself.
 *
 * Named rather than guessed, per constitution rule 4. Each one changes what
 * the engine reports, and each has more than one defensible answer.
 */
export const EMERGENCY_QUESTIONS: readonly string[] = [
  'Which contents list does this clinic hold? The list here is ordinary '
  + 'practice, not this clinic’s — it needs a doctor’s signature before '
  + 'KuBi may report a kit as complete against it.',
  'Does the clinic hold a defibrillator? If not, that is a decision to '
  + 'record rather than an item to fail every morning.',
  'Must the doctor’s verification happen before the first patient, or by '
  + 'the end of the day? The matrix names the Doctor as Checker and does not '
  + 'say when.',
  'Is currency of staff resuscitation training part of this control or its '
  + 'own? A kit nobody can use is a different failure from a kit that is not '
  + 'there.',
];

/* -------------------------------------------------------------------------
 * What the assistant reports
 * ---------------------------------------------------------------------- */

/**
 * One line of this morning's checklist.
 *
 * Deliberately three separate facts rather than one tick. "I checked the
 * adrenaline" is not a finding; *how many, in date until when, and could I
 * actually reach it* are three findings, and each of them fails differently.
 */
export interface EmergencyCheckRow {
  itemId: string;
  /** How many were counted. Null means nobody counted — never zero. */
  found: number | null;
  /**
   * The earliest expiry among the ones present, as a day number.
   *
   * Earliest rather than latest: a box of five with one expiring next week is
   * a box that needs attention next week, and reporting the furthest date
   * would hide exactly the ampoule somebody reaches for first.
   *
   * Null for items that do not expire, and null when nobody read the label —
   * which are different, and told apart by the item's `kind`.
   */
  earliestExpiryDay: number | null;
  /**
   * Reachable, unlocked, and not behind anything.
   *
   * The standard says *accessible*, and this is that word made checkable.
   * Tri-state on purpose: an unanswered question is not a yes.
   */
  accessible: boolean | null;
  /** Anything the person wants on the record. */
  note: string | null;
}

/** The whole checklist, reported once, by one person. */
export interface EmergencyCheck {
  at: number;
  /** The employee who did it. A person, because somebody signed it. */
  byEmployeeCode: string;
  byRole: RoleCode;
  rows: readonly EmergencyCheckRow[];
}

/** The doctor's countersignature. */
export interface EmergencyVerification {
  at: number;
  byEmployeeCode: string;
  byRole: RoleCode;
}

/* -------------------------------------------------------------------------
 * What the engine says
 * ---------------------------------------------------------------------- */

export const ItemVerdict = {
  /** Present, in date, reachable. */
  READY: 'READY',
  /** Nothing there at all. */
  MISSING: 'MISSING',
  /** Some there, fewer than the list says. */
  SHORT: 'SHORT',
  /** Present and past its date, which is the same as absent. */
  EXPIRED: 'EXPIRED',
  /** In date, and inside its replacement window. Order it now. */
  EXPIRING: 'EXPIRING',
  /** There, and somebody could not get to it. */
  INACCESSIBLE: 'INACCESSIBLE',
  /** Nobody looked this morning. Never a pass. */
  UNCHECKED: 'UNCHECKED',
} as const;
export type ItemVerdict = (typeof ItemVerdict)[keyof typeof ItemVerdict];

/** Verdicts that stop a critical item from counting as present. */
const FAILING: readonly ItemVerdict[] = [
  ItemVerdict.MISSING, ItemVerdict.SHORT, ItemVerdict.EXPIRED,
  ItemVerdict.INACCESSIBLE, ItemVerdict.UNCHECKED,
];

export interface ItemResult {
  item: EmergencyItem;
  verdict: ItemVerdict;
  found: number | null;
  /** Days until the earliest one expires. Negative once it has. */
  daysToExpiry: number | null;
  /** True when this verdict stops the clinic. */
  stops: boolean;
  /** Said to whoever has to do something about it. */
  because: string;
}

export const EmergencyState = {
  /** Checked this morning, everything critical present, and countersigned. */
  READY: 'READY',
  /**
   * Checked, everything critical present, and no doctor has signed it.
   *
   * The clinic is safe. The control is not finished. Those are different
   * sentences and collapsing them would either block a safe clinic or let an
   * unsigned control disappear — and the matrix names a Checker for a reason.
   */
  AWAITING_VERIFICATION: 'AWAITING_VERIFICATION',
  /** Something critical is missing, expired or unreachable. */
  NOT_READY: 'NOT_READY',
  /** Nobody has done it today. Not a pass, and not the same as a failure. */
  NOT_CHECKED: 'NOT_CHECKED',
} as const;
export type EmergencyState = (typeof EmergencyState)[keyof typeof EmergencyState];

export interface EmergencyReadiness {
  state: EmergencyState;
  /**
   * May the clinic treat patients?
   *
   * Calculated. There is no field that holds it and no event that sets it —
   * the same rule as clinic readiness, for the same reason.
   */
  safe: boolean;
  /** Is the control itself finished, signature and all? */
  complete: boolean;
  items: readonly ItemResult[];
  /** Everything that stops the clinic, worst first. */
  stopping: readonly ItemResult[];
  /**
   * Real, and the day continues around it.
   *
   * Two different things live here and the screen must not blur them: an item
   * running out of date, and a non-critical item that is genuinely absent. One
   * is a reorder, the other is a walk to the store cupboard.
   */
  watch: readonly ItemResult[];
  checkedAt: number | null;
  checkedBy: string | null;
  verifiedAt: number | null;
  verifiedBy: string | null;
  /** Why a verification was refused, where one was offered and rejected. */
  verificationRefusedBecause: string | null;
  /** The one sentence for whoever is about to seat a patient. */
  headline: string;
}

/* -------------------------------------------------------------------------
 * The calculation
 * ---------------------------------------------------------------------- */

/**
 * Where emergency readiness stands, as of `now`.
 *
 * Pure. `today` is a day number so expiry can be measured without a calendar
 * library, on the same footing as leave and asset cycles elsewhere.
 *
 * `check` is null when nobody has done it this morning, and that is a state
 * the function reports rather than a reason to fall back on yesterday's. A
 * daily check that inherits is not a daily check.
 */
export function emergencyReadiness(
  items: readonly EmergencyItem[],
  check: EmergencyCheck | null,
  verification: EmergencyVerification | null,
  today: number,
  now: number,
): EmergencyReadiness {
  const rows = new Map((check?.rows ?? []).map((r) => [r.itemId, r]));

  const results: ItemResult[] = items.map((item) => judge(item, rows.get(item.id), today));
  const stopping = results.filter((r) => r.stops)
    .sort((a, b) => RANK[a.verdict] - RANK[b.verdict]);
  const watch = results.filter((r) => !r.stops && r.verdict !== ItemVerdict.READY);

  const refusal = verification === null ? null
    : refuseVerification(verification, check);
  const verified = verification !== null && refusal === null;

  const state: EmergencyState =
    check === null ? EmergencyState.NOT_CHECKED
      : stopping.length > 0 ? EmergencyState.NOT_READY
        : verified ? EmergencyState.READY
          : EmergencyState.AWAITING_VERIFICATION;

  return {
    state,
    safe: state === EmergencyState.READY || state === EmergencyState.AWAITING_VERIFICATION,
    complete: state === EmergencyState.READY,
    items: results,
    stopping,
    watch,
    checkedAt: check?.at ?? null,
    checkedBy: check?.byEmployeeCode ?? null,
    verifiedAt: verified ? verification!.at : null,
    verifiedBy: verified ? verification!.byEmployeeCode : null,
    verificationRefusedBecause: refusal,
    headline: headlineFor(state, stopping, watch, refusal, now),
  };
}

/** Worst first, and "worst" is what a person would reach for and not find. */
const RANK: Record<ItemVerdict, number> = {
  MISSING: 0, EXPIRED: 1, INACCESSIBLE: 2, SHORT: 3, UNCHECKED: 4,
  EXPIRING: 5, READY: 6,
};

function judge(
  item: EmergencyItem, row: EmergencyCheckRow | undefined, today: number,
): ItemResult {
  const fail = (verdict: ItemVerdict, because: string, found: number | null = null,
    daysToExpiry: number | null = null): ItemResult =>
    ({ item, verdict, found, daysToExpiry, stops: item.critical && FAILING.includes(verdict), because });

  // Nobody looked. Rule 1: this is not a pass, and it is not the same thing
  // as the item being absent — one is a fact about the kit, the other about
  // the morning, and they are fixed by different people.
  if (row === undefined || row.found === null) {
    return fail(ItemVerdict.UNCHECKED,
      `Nobody counted the ${item.name.toLowerCase()} this morning.`);
  }

  if (row.found === 0) {
    return fail(ItemVerdict.MISSING, item.ifMissing, 0);
  }

  // Accessible is asked because the standard says *accessible*. An unanswered
  // question stays unanswered rather than becoming a yes.
  if (row.accessible === null) {
    return fail(ItemVerdict.UNCHECKED,
      `Nobody said whether the ${item.name.toLowerCase()} can actually be reached.`,
      row.found);
  }
  if (row.accessible === false) {
    return fail(ItemVerdict.INACCESSIBLE,
      `Present and not reachable${row.note ? ` — ${row.note}` : ''}. `
      + 'In an emergency that is the same as absent.',
      row.found);
  }

  const expires = row.earliestExpiryDay;
  const days = expires === null ? null : expires - today;

  // A drug past its date is as absent as one never bought, and this is
  // computed on every read — a kit that passes on the 30th fails on the 1st
  // with nobody touching anything.
  if (days !== null && days < 0) {
    return fail(ItemVerdict.EXPIRED,
      `Expired ${-days} day${days === -1 ? '' : 's'} ago. `
      + 'An expired drug is not a drug.',
      row.found, days);
  }

  if (row.found < item.required) {
    return fail(ItemVerdict.SHORT,
      `${row.found} of ${item.required}. ${item.ifMissing}`,
      row.found, days);
  }

  // Warned early on purpose. Ordering takes days, and a kit that tells you on
  // the morning it expires has told you too late.
  if (days !== null && days <= item.replaceDaysBefore) {
    return {
      item, verdict: ItemVerdict.EXPIRING, found: row.found, daysToExpiry: days,
      stops: false,
      because: `Expires in ${days} day${days === 1 ? '' : 's'}. `
        + `Replace it now — this one needs ${item.replaceDaysBefore} days' notice.`,
    };
  }

  return {
    item, verdict: ItemVerdict.READY, found: row.found, daysToExpiry: days,
    stops: false,
    because: days === null
      ? `${row.found} present and reachable.`
      : `${row.found} present, reachable, in date for ${days} days.`,
  };
}

/**
 * Why a countersignature was refused.
 *
 * Two rules, and the first is the one that gives the control its value.
 *
 * The matrix names the Doer as Assistant and the Checker as Doctor, and a
 * check somebody signs off themselves is not a check — it is the same person
 * saying the same thing twice. This is the identical rule the sterilisation
 * engine applies to batch release, and it is worth stating in both places
 * rather than sharing a helper: the reasons happen to coincide and are not
 * the same reason.
 */
export function refuseVerification(
  v: EmergencyVerification, check: EmergencyCheck | null,
): string | null {
  if (check === null) {
    return 'There is no check to verify — nobody has done the kit this morning.';
  }
  if (v.byEmployeeCode === check.byEmployeeCode) {
    return 'The person who checked the kit may not also sign it off. '
      + 'OPEN-012 names the Doer and the Checker separately.';
  }
  if (v.byRole !== RoleCode.TREATING_DOCTOR && v.byRole !== RoleCode.CLINICAL_DIRECTOR) {
    return 'OPEN-012 names the Checker as the doctor. '
      + 'Nobody else may sign the emergency kit off.';
  }
  return null;
}

function headlineFor(
  state: EmergencyState, stopping: readonly ItemResult[],
  watch: readonly ItemResult[], refusal: string | null, now: number,
): string {
  void now;
  if (state === EmergencyState.NOT_CHECKED) {
    return 'The emergency kit has not been checked this morning. '
      + 'Until it is, KuBi cannot say the clinic is safe to treat.';
  }
  if (state === EmergencyState.NOT_READY) {
    const worst = stopping[0]!;
    return `EMERGENCY KIT NOT READY — ${worst.item.name}. ${worst.because}`;
  }
  if (state === EmergencyState.AWAITING_VERIFICATION) {
    return refusal
      ?? 'Kit checked and complete. Waiting on a doctor to countersign it.';
  }
  return watch.length === 0
    ? 'Emergency kit checked, complete and countersigned.'
    : `Emergency kit ready. ${watch.length} item${watch.length === 1 ? '' : 's'} `
      + 'to reorder before they expire.';
}

/* -------------------------------------------------------------------------
 * Reading it out of the log
 * ---------------------------------------------------------------------- */

/**
 * The events, and why the detail travels alongside rather than inside them.
 *
 * `ReadinessEvent` carries a type, a subject and a minute — no payload — and
 * that constraint has been useful everywhere else in KuBi. A checklist of
 * twenty rows with counts and expiry dates does not fit in a subject string,
 * and the honest thing is to say so rather than to encode it into one with
 * separators until it breaks.
 *
 * So the log records **that the check happened and who did it**, which is what
 * makes it append-only and auditable, and the rows live in their own table
 * keyed by the same minute. `checkFrom` reassembles them.
 */
export const EMERGENCY_CHECKED = ClinicEvent.EMERGENCY_CHECKED;
export const EMERGENCY_VERIFIED = ClinicEvent.EMERGENCY_VERIFIED;

/**
 * Today's check, from the log and the rows.
 *
 * Returns null when there is no check event since `sinceMinute`, which is what
 * makes the daily cadence real: yesterday's event is in the log for ever and
 * is not this morning's answer.
 */
export function checkFrom(
  events: readonly ReadinessEvent[],
  rowsByMinute: ReadonlyMap<number, readonly EmergencyCheckRow[]>,
  sinceMinute: number,
): EmergencyCheck | null {
  const ev = [...events]
    .filter((e) => e.type === ClinicEvent.EMERGENCY_CHECKED && e.at >= sinceMinute)
    .sort((a, b) => b.at - a.at)[0];
  if (ev === undefined) return null;

  // `employeeCode#ROLE`, the compound-subject convention this codebase already
  // uses for `SKU#qty` and `tag#cycle`.
  const [employeeCode = '', role = ''] = ev.subjectId.split('#');
  return {
    at: ev.at,
    byEmployeeCode: employeeCode,
    byRole: role as RoleCode,
    rows: rowsByMinute.get(ev.at) ?? [],
  };
}

/** Today's countersignature, on the same rule. */
export function verificationFrom(
  events: readonly ReadinessEvent[], sinceMinute: number,
): EmergencyVerification | null {
  const ev = [...events]
    .filter((e) => e.type === ClinicEvent.EMERGENCY_VERIFIED && e.at >= sinceMinute)
    .sort((a, b) => b.at - a.at)[0];
  if (ev === undefined) return null;
  const [employeeCode = '', role = ''] = ev.subjectId.split('#');
  return { at: ev.at, byEmployeeCode: employeeCode, byRole: role as RoleCode };
}

/** The columns the emergency-kit sheet must carry, for the same reason as the others. */
export const EMERGENCY_SHEET_COLUMNS: readonly string[] = [
  'date', 'item_id', 'found', 'earliest_expiry', 'accessible', 'note',
  'checked_by', 'verified_by',
];
