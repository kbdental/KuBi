/**
 * APT-001 to APT-012 and PAT-001 to PAT-009 — the appointment book and the
 * front desk.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The owner called this "the missing link", and it is more than that
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Everything KuBi has built so far starts from a booking that already exists.
 * The morning works backwards from `firstPatientAt`; the readiness target, the
 * fifty-minute start time, the sterilisation long pole and the horizon that
 * warns before a patient reaches the chair are all computed from it. That
 * number has been **handed to the engine**. Nothing produced it.
 *
 * This is the file that produces it. The appointment book is not another
 * module beside readiness — it is the input readiness has been assuming.
 *
 * The second thing it produces is quieter and matters as much. The compliance
 * engine has been reporting *"MEDICAL HISTORY NOT TAKEN"* against patient
 * facts that came from a synthetic table, because there was nowhere in the
 * software a patient's history could be entered. The registration form's
 * section VIII — systemic diseases, current medications, allergies — **is**
 * `PatientFacts`. PAT-004 is where those facts enter the system, and it is
 * marked PS with the failure *"clinical gate"* for exactly that reason.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What the book has to carry that a `Booking` did not
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A `Booking` was an id, a treatment, a name, a minute and a sitting. Three of
 * the owner's controls cannot be evaluated against that:
 *
 *   APT-001.b  *"Confirm the availability of the assigned doctor and dental
 *              assistant for each appointment slot"* — needs the slot to name
 *              a doctor and an assistant.
 *   APT-001.c  *"ensure the corresponding operatory is prepared and
 *              equipped"* — needs the slot to name a room.
 *   APT-001.d  *"identify long procedures and allocate sufficient buffer"* —
 *              needs a duration and a buffer.
 *
 * So an `Appointment` names all four. That is what lets the attendance engine
 * answer *"is this slot's assistant in the building"* instead of the weaker
 * *"is any assistant in the building"*, and what lets a withdrawn operatory
 * name the patients it just displaced.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Highly automated, in the way the owner asked
 * ─────────────────────────────────────────────────────────────────────────
 *
 * *"This area should be highly automated."* Five of the twelve appointment
 * controls give the Doer as **System**, and every one of those is a
 * calculation here rather than a task on somebody's list: today's book,
 * special patients, gaps in the chair, the no-show, and the morning review
 * score. None of them is a thing a person reports having done.
 *
 * The clock does the rest. *"If patient does not arrive within 15 minutes of
 * appointment time, call the patient immediately"* and *"mark the slot as
 * No-Show or Late after 20 minutes"* are two derived states off one number,
 * and neither needs anybody to press anything.
 *
 * And the KPI the owner named:
 *
 *   **Waiting time = chair seating time − check-in time**
 *
 * *"This gives you a genuine operational KPI rather than staff opinion."*
 * `PATIENT_ARRIVED` and `PATIENT_SEATED` were already in the log, so the
 * measurement costs nothing and cannot be argued with.
 */
import { RoleCode } from './enums.js';
import { ClinicEvent } from './operating-model.js';
import { ControlPriority } from './housekeeping.js';
import type { ReadinessEvent } from './readiness.js';

/* -------------------------------------------------------------------------
 * The clinic's own numbers
 * ---------------------------------------------------------------------- */

/** *"Review the complete appointment schedule… at least 30 minutes before the first appointment."* */
export const REVIEW_MINUTES_BEFORE_FIRST = 30;

/** *"If patient does not arrive within 15 minutes of appointment time, call the patient immediately."* */
export const LATE_CALL_MINUTES = 15;

/** *"Mark the slot as 'No-Show' or 'Late' in the software after 20 minutes."* */
export const NO_SHOW_MINUTES = 20;

/** *"Send a WhatsApp/SMS reminder 24 hours before the appointment."* */
export const REMINDER_HOURS_BEFORE = 24;

/** *"Call the patient if no response to the message within 2 hours of sending."* */
export const RETRY_HOURS = 2;

/** *"For high-value or surgical appointments, call the patient 48 hours prior as well."* */
export const HIGH_VALUE_HOURS_BEFORE = 48;

/** *"Patient calls to be answered within 3 rings; if unanswered, call back within 15 minutes."* */
export const CALLBACK_MINUTES = 15;

/** *"Charge Rs. 500 as consultation."* Held as data, because prices move. */
export const CONSULTATION_FEE = 500;

/**
 * A waiting time nobody should have to explain away.
 *
 * Not in the owner's matrix, and the KPI is meaningless without one — *"track
 * automatically"* tells you what to measure and not what is acceptable. Named
 * here as KuBi's working assumption so that changing it is one edit and one
 * conversation, rather than a threshold buried in a screen.
 */
export const WAIT_TARGET_MINUTES = 15;
export const WAIT_ALERT_MINUTES = 30;

/* -------------------------------------------------------------------------
 * The appointment
 * ---------------------------------------------------------------------- */

/**
 * How the booking was confirmed, or was not.
 *
 * APT-003's failure line is the whole design: *"Cannot remain blank."* So
 * there is no empty state — a slot nobody has contacted is `NOT_CONTACTED`,
 * which is a positive statement about the clinic rather than a missing field,
 * and it is what the unconfirmed queue is built from.
 */
export const Confirmation = {
  /** Nobody has tried yet. Not blank — a state, and a chaseable one. */
  NOT_CONTACTED: 'NOT_CONTACTED',
  /** Contacted, and they said yes. */
  CONFIRMED: 'CONFIRMED',
  /** Contacted, and nothing came back. APT-004's retry protocol applies. */
  NO_RESPONSE: 'NO_RESPONSE',
  CANCELLED: 'CANCELLED',
  RESCHEDULED: 'RESCHEDULED',
} as const;
export type Confirmation = (typeof Confirmation)[keyof typeof Confirmation];

export interface Appointment {
  id: string;
  /** Null until the patient is registered — which is itself a finding. */
  patientId: string | null;
  patientLabel: string;
  /** APT booking protocol 2.a. */
  contact: string | null;
  alternateContact: string | null;
  chiefComplaint: string | null;
  referredBy: string | null;

  treatmentCode: string;
  /** The minute the appointment starts. */
  at: number;
  /** Chair time. Null falls back to the treatment catalogue's own figure. */
  minutes: number | null;
  /** APT-001.d. Extra time allocated for a long procedure. */
  bufferMinutes: number;
  sitting: number;

  /** APT-001.c. The room this slot needs. Null is a finding, not a default. */
  operatoryId: string | null;
  /** APT-001.b. The two people the slot names. */
  doctorEmployeeCode: string | null;
  assistantEmployeeCode: string | null;

  /** New patients need registration before anything clinical. */
  isNewPatient: boolean;
  /** APT-007. Surgery, high-risk or a lab case — needs preparation. */
  special: boolean;
  /** Why it is special, so the flag is actionable rather than a colour. */
  specialBecause: string | null;

  confirmation: Confirmation;
  /** The minute the confirmation attempt was made. Drives APT-004's retry. */
  contactedAt: number | null;
  /** How many times reception has tried. */
  attempts: number;
  /** APT-009. A cancellation with no reason is the finding. */
  cancellationReason: string | null;
}

/* -------------------------------------------------------------------------
 * Where a slot has got to today
 * ---------------------------------------------------------------------- */

export const SlotState = {
  /** Booked, and nobody has contacted them. */
  UNCONFIRMED: 'UNCONFIRMED',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  /** Checked in. The waiting clock is running. */
  ARRIVED: 'ARRIVED',
  /** In the chair. The waiting clock has stopped. */
  SEATED: 'SEATED',
  /** Past the appointment by 15 minutes. Call them now. */
  LATE: 'LATE',
  /** Past it by 20. APT-010 generates the follow-up. */
  NO_SHOW: 'NO_SHOW',
} as const;
export type SlotState = (typeof SlotState)[keyof typeof SlotState];

/**
 * One thing wrong with one slot, said to the person who can fix it.
 *
 * A slot can be short of several things at once — no room, no assistant, an
 * unconfirmed patient — and collapsing them into a single "not ready" would
 * lose the one that is actually fixable before ten o'clock.
 */
export interface SlotProblem {
  control: string;
  /** PS · C · I · R, from the matrix. */
  priority: ControlPriority;
  what: string;
  ownerRole: RoleCode;
}

export interface Slot {
  appointment: Appointment;
  state: SlotState;
  /** Chair time plus buffer — what the diary actually consumes. */
  endsAt: number;
  arrivedAt: number | null;
  seatedAt: number | null;
  /**
   * The owner's KPI: seating minus check-in.
   *
   * Null before they arrive. Once they have arrived and not been seated it is
   * the wait **so far**, which is the number that matters while somebody is
   * sitting there — a KPI that only exists after the fact cannot prompt
   * anybody to go and apologise.
   */
  waitingMinutes: number | null;
  /** Still waiting, so the figure above is climbing. */
  stillWaiting: boolean;
  /** Everything short about this slot, worst first. */
  problems: readonly SlotProblem[];
  /** The one sentence for whoever is looking at the book. */
  because: string;
}

/* -------------------------------------------------------------------------
 * What reception is standing on
 * ---------------------------------------------------------------------- */

/**
 * The facts other engines own, borrowed rather than recomputed.
 *
 * Reception does not decide whether a room is usable or whether an assistant
 * is in the building. It asks, and the asking is what turns *"confirm the
 * availability of the assigned doctor and dental assistant"* from a phrase in
 * a document into something a computer can check at 09:05.
 *
 * Every field is optional and absent means UNKNOWN, never a pass. A book
 * loaded before the attendance sheet must not report every slot as staffed.
 */
export interface ReceptionInputs {
  /** Employee codes of everybody in the building, from the attendance engine. */
  present?: ReadonlySet<string>;
  /** Employee codes on approved leave — a different sentence from "not here". */
  onLeave?: ReadonlySet<string>;
  /** Operatory ids that may not take a patient, from `roomAvailability`. */
  roomsWithdrawn?: ReadonlySet<string>;
  /** Operatory ids the clinic actually has, so a typo is a finding. */
  knownRooms?: ReadonlySet<string>;
  /** Bookings whose mandatory gates are not met, from the compliance engine. */
  notReadyBookings?: ReadonlySet<string>;
  /** Patients whose medical history has never been recorded. PAT-004. */
  historyMissing?: ReadonlySet<string>;
  /** Patient ids carrying a risk the clinical team must see. PAT-005. */
  risks?: ReadonlyMap<string, readonly string[]>;
}

/* -------------------------------------------------------------------------
 * The view
 * ---------------------------------------------------------------------- */

export interface WaitingKpi {
  /** Mean minutes from check-in to chair, over everybody seated today. */
  averageMinutes: number | null;
  longestMinutes: number | null;
  seated: number;
  /** Waiting now, and past the alert threshold. Somebody should go and speak. */
  overdue: number;
}

export interface ReceptionView {
  slots: readonly Slot[];
  /** APT-001. The book, in time order. Null when nothing is booked. */
  firstAppointmentAt: number | null;
  /** APT-001.a. The minute reception has to have reviewed the book by. */
  reviewBy: number | null;
  /** APT-002, APT-003. Contacted or not — never blank. */
  unconfirmed: readonly Slot[];
  /** APT-004. Contacted, no response, and the retry window has passed. */
  retryDue: readonly Slot[];
  /** APT-007. Surgery, high-risk and lab cases, flagged before the day starts. */
  special: readonly Slot[];
  /** APT-008. Chair time nobody is using. */
  gaps: readonly Gap[];
  /** APT-009. A cancellation with no reason recorded. */
  cancellationsWithoutReason: readonly Slot[];
  /** The 15-minute call. */
  callNow: readonly Slot[];
  /** APT-010. Past 20 minutes, and a follow-up is owed. */
  noShows: readonly Slot[];
  /** Anything short about any slot, across the whole book. */
  problems: readonly SlotProblem[];
  /** PAT-006, and the owner's KPI. */
  waiting: WaitingKpi;
  /**
   * APT-012, and the reason this engine has a cutoff at all.
   *
   * *"Morning appointment review complete · No unresolved critical issue ·
   * Defined cutoff · System · Manager · Auto score."* Derived, like clinic
   * readiness — nobody ticks it, and it goes back to false if a slot breaks
   * after it went true.
   */
  reviewComplete: boolean;
  reviewScore: number;
  /** What is stopping the review being complete. */
  reviewBlockers: readonly SlotProblem[];
  headline: string;
}

/** APT-008. A hole in the day, and how big it is. */
export interface Gap {
  from: number;
  to: number;
  minutes: number;
  /** Why the chair is free — a cancellation, a no-show, or never booked. */
  because: string;
}

/* -------------------------------------------------------------------------
 * The calculation
 * ---------------------------------------------------------------------- */

/**
 * Where the appointment book stands, as of `now`.
 *
 * Pure, like every other engine here. `chairMinutes` resolves a treatment code
 * to its catalogue duration; passed in rather than imported so this file does
 * not depend on the treatment catalogue and can be tested against two slots
 * instead of five hundred items.
 */
export function reception(
  appointments: readonly Appointment[],
  events: readonly ReadinessEvent[],
  chairMinutes: (treatmentCode: string) => number,
  inputs: ReceptionInputs,
  now: number,
): ReceptionView {
  const arrivedAt = firstMinuteBySubject(events, ClinicEvent.PATIENT_ARRIVED);
  const seatedAt = firstMinuteBySubject(events, ClinicEvent.PATIENT_SEATED);

  const slots: Slot[] = [...appointments]
    .sort((a, b) => a.at - b.at)
    .map((a) => judge(a, arrivedAt.get(a.id) ?? null, seatedAt.get(a.id) ?? null,
      chairMinutes, inputs, now));

  const live = slots.filter((s) => s.state !== SlotState.CANCELLED);
  const booked = live.map((s) => s.appointment.at);
  const firstAppointmentAt = booked.length === 0 ? null : Math.min(...booked);

  const waits = slots
    .filter((s) => s.seatedAt !== null && s.waitingMinutes !== null)
    .map((s) => s.waitingMinutes!);

  const problems = slots.flatMap((s) => s.problems)
    .sort((x, y) => RANK[x.priority] - RANK[y.priority]);
  // APT-012 is about *critical* issues, not about every I on the board. A
  // review that could never complete while a reminder was outstanding is a
  // score nobody would look at twice.
  const reviewBlockers = problems.filter(
    (p) => p.priority === ControlPriority.PS || p.priority === ControlPriority.C);

  const noShows = slots.filter((s) => s.state === SlotState.NO_SHOW);
  const unconfirmed = live.filter(
    (s) => s.appointment.confirmation === Confirmation.NOT_CONTACTED
      || s.appointment.confirmation === Confirmation.NO_RESPONSE);

  return {
    slots,
    firstAppointmentAt,
    reviewBy: firstAppointmentAt === null
      ? null : firstAppointmentAt - REVIEW_MINUTES_BEFORE_FIRST,
    unconfirmed,
    retryDue: unconfirmed.filter(
      (s) => s.appointment.confirmation === Confirmation.NO_RESPONSE
        && s.appointment.contactedAt !== null
        && now - s.appointment.contactedAt >= RETRY_HOURS * 60),
    special: live.filter((s) => s.appointment.special),
    gaps: gapsIn(slots, now),
    cancellationsWithoutReason: slots.filter(
      (s) => s.state === SlotState.CANCELLED
        && (s.appointment.cancellationReason ?? '').trim() === ''),
    callNow: slots.filter((s) => s.state === SlotState.LATE),
    noShows,
    problems,
    waiting: {
      averageMinutes: waits.length === 0 ? null
        : Math.round(waits.reduce((n, m) => n + m, 0) / waits.length),
      longestMinutes: waits.length === 0 ? null : Math.max(...waits),
      seated: waits.length,
      overdue: slots.filter(
        (s) => s.stillWaiting && (s.waitingMinutes ?? 0) >= WAIT_ALERT_MINUTES).length,
    },
    reviewComplete: reviewBlockers.length === 0 && live.length > 0,
    reviewScore: live.length === 0 ? 0
      : Math.round(((live.length - new Set(
        reviewBlockers.map((p) => p.control)).size) / live.length) * 100),
    reviewBlockers,
    headline: headlineFor(slots, reviewBlockers, noShows, unconfirmed, now),
  };
}

const RANK: Record<ControlPriority, number> = { PS: 0, C: 1, I: 2, R: 3 };

function judge(
  a: Appointment, arrived: number | null, seated: number | null,
  chairMinutes: (code: string) => number,
  inputs: ReceptionInputs, now: number,
): Slot {
  const minutes = a.minutes ?? chairMinutes(a.treatmentCode);
  const endsAt = a.at + minutes + a.bufferMinutes;

  const state: SlotState =
    a.confirmation === Confirmation.CANCELLED ? SlotState.CANCELLED
      : seated !== null ? SlotState.SEATED
        : arrived !== null ? SlotState.ARRIVED
          : now >= a.at + NO_SHOW_MINUTES ? SlotState.NO_SHOW
            : now >= a.at + LATE_CALL_MINUTES ? SlotState.LATE
              : a.confirmation === Confirmation.CONFIRMED ? SlotState.CONFIRMED
                : SlotState.UNCONFIRMED;

  // The owner's formula. While they are still waiting it is the wait so far,
  // because a KPI that only exists after the fact cannot send anybody out to
  // apologise to somebody who is still sitting there.
  const waitingMinutes = arrived === null ? null
    : (seated ?? now) - arrived;

  return {
    appointment: a,
    state,
    endsAt,
    arrivedAt: arrived,
    seatedAt: seated,
    waitingMinutes,
    stillWaiting: arrived !== null && seated === null,
    problems: problemsWith(a, state, waitingMinutes, seated, inputs),
    because: becauseFor(a, state, waitingMinutes, seated),
  };
}

/**
 * Everything short about one slot.
 *
 * Each one names the control it comes from, so a person reading the board can
 * go back to the standard, and its priority, so APT-012 can tell a missing
 * consent from an unsent reminder.
 */
function problemsWith(
  a: Appointment, state: SlotState, waiting: number | null,
  seated: number | null, inputs: ReceptionInputs,
): SlotProblem[] {
  const out: SlotProblem[] = [];
  const p = (control: string, priority: ControlPriority, what: string,
    ownerRole: RoleCode = RoleCode.RECEPTION) =>
    out.push({ control, priority, what, ownerRole });

  if (state === SlotState.CANCELLED) {
    if ((a.cancellationReason ?? '').trim() === '') {
      p('APT-009', ControlPriority.I,
        `${a.patientLabel} cancelled and no reason was recorded — `
        + 'a cancellation with no reason cannot be counted in a pattern');
    }
    return out;
  }

  /* ── PAT-002 and PAT-004 · patient safety ─────────────────────────── */
  //
  // Both are PS, and the second's failure line in the matrix is the word
  // "clinical gate". A patient whose history nobody holds is not somebody to
  // chase later; it is a treatment that may not start.
  if (a.patientId === null) {
    p('PAT-002', ControlPriority.PS,
      `${a.patientLabel} has no patient record — the identity cannot be `
      + 'verified, and there is nowhere to write the medical history');
  } else if (inputs.historyMissing?.has(a.patientId)) {
    p('PAT-004', ControlPriority.PS,
      `${a.patientLabel} has no medical history recorded — systemic disease, `
      + 'medication and allergy are all unknown');
  }

  for (const risk of inputs.risks?.get(a.patientId ?? '') ?? []) {
    p('PAT-005', ControlPriority.PS,
      `${a.patientLabel} — ${risk}. The clinical team must see this before `
      + 'the chair', RoleCode.TREATING_DOCTOR);
  }

  /* ── APT-001.b · the two people this slot names ───────────────────── */
  //
  // The check the book could not do before, because a booking named nobody.
  // "Is any assistant in the building" was the best the system could manage;
  // this is "is *her* assistant in the building".
  const away = (code: string | null, who: string, control: string) => {
    if (code === null) {
      p(control, ControlPriority.C,
        `${a.patientLabel} at ${clock(a.at)} has no ${who} assigned`);
      return;
    }
    if (inputs.present === undefined) return; // UNKNOWN is never a pass, and
    // it is also not a failure to report — say nothing rather than guess.
    if (inputs.present.has(code)) return;
    p(control, ControlPriority.C,
      `${a.patientLabel} at ${clock(a.at)} — the assigned ${who} is `
      + (inputs.onLeave?.has(code) ? 'on approved leave' : 'not in the building'));
  };
  away(a.doctorEmployeeCode, 'doctor', 'APT-001.b');
  away(a.assistantEmployeeCode, 'assistant', 'APT-001.b');

  /* ── APT-001.c · the room ─────────────────────────────────────────── */
  if (a.operatoryId === null) {
    p('APT-001.c', ControlPriority.C,
      `${a.patientLabel} at ${clock(a.at)} has no operatory assigned`);
  } else if (inputs.knownRooms !== undefined && !inputs.knownRooms.has(a.operatoryId)) {
    p('APT-001.c', ControlPriority.C,
      `${a.patientLabel} is booked into "${a.operatoryId}", which this clinic `
      + 'does not have');
  } else if (inputs.roomsWithdrawn?.has(a.operatoryId)) {
    // The consequence of OPEN-004 reaching the appointment book: a withdrawn
    // room is not a maintenance ticket, it is a patient who needs moving.
    p('APT-001.c', ControlPriority.C,
      `${a.patientLabel} at ${clock(a.at)} is booked into a room that may not `
      + 'take a patient — they need moving or rescheduling', RoleCode.CLINIC_MANAGER);
  }

  /* ── APT-007 · special patients ───────────────────────────────────── */
  if (a.special && inputs.notReadyBookings?.has(a.id)) {
    p('APT-007', ControlPriority.C,
      `${a.patientLabel} — ${a.specialBecause ?? 'needs preparation'}, and the `
      + 'preparation is not complete');
  }

  /* ── APT-002 and APT-003 · the confirmation ───────────────────────── */
  if (a.confirmation === Confirmation.NOT_CONTACTED) {
    p('APT-002', ControlPriority.I,
      `${a.patientLabel} at ${clock(a.at)} has not been contacted`);
  } else if (a.confirmation === Confirmation.NO_RESPONSE) {
    p('APT-004', ControlPriority.I,
      `${a.patientLabel} was contacted ${a.attempts} time`
      + `${a.attempts === 1 ? '' : 's'} with no response`);
  }

  /* ── APT-010 · the no-show ────────────────────────────────────────── */
  if (state === SlotState.NO_SHOW) {
    p('APT-010', ControlPriority.I,
      `${a.patientLabel} did not arrive. A follow-up is owed, and the slot is `
      + 'free chair time somebody else could have');
  }

  /* ── PAT-006 · the wait ───────────────────────────────────────────── */
  if (seated === null && waiting !== null && waiting >= WAIT_ALERT_MINUTES) {
    p('PAT-006', ControlPriority.I,
      `${a.patientLabel} has been waiting ${waiting} minutes. Somebody should `
      + 'go and say so — the standard is to communicate a delay, not to hope');
  }

  return out.sort((x, y) => RANK[x.priority] - RANK[y.priority]);
}

function becauseFor(
  a: Appointment, state: SlotState, waiting: number | null, seated: number | null,
): string {
  switch (state) {
    case SlotState.CANCELLED:
      return a.cancellationReason
        ? `Cancelled — ${a.cancellationReason}`
        : 'Cancelled, and no reason was recorded.';
    case SlotState.NO_SHOW:
      return `Did not arrive. Past ${NO_SHOW_MINUTES} minutes, so the slot is `
        + 'free and a follow-up is owed.';
    case SlotState.LATE:
      return `${LATE_CALL_MINUTES} minutes past their appointment. Call them now.`;
    case SlotState.SEATED:
      return `In the chair. Waited ${waiting} minutes.`;
    case SlotState.ARRIVED:
      return seated === null && waiting !== null
        ? `Checked in, waiting ${waiting} minutes.`
        : 'Checked in.';
    case SlotState.CONFIRMED:
      return `Confirmed for ${clock(a.at)}.`;
    default:
      return `Booked for ${clock(a.at)}, and not confirmed.`;
  }
}

/**
 * APT-008 — chair time nobody is using.
 *
 * Computed from the book rather than reported, because a gap is the absence of
 * something and nobody reports an absence. A cancellation at nine o'clock
 * becomes an hour somebody on the waiting list could have, and it becomes that
 * the moment the cancellation is recorded rather than when a person notices.
 */
function gapsIn(slots: readonly Slot[], now: number): Gap[] {
  const live = slots
    .filter((s) => s.state !== SlotState.CANCELLED && s.state !== SlotState.NO_SHOW)
    .sort((a, b) => a.appointment.at - b.appointment.at);

  const freed = slots.filter(
    (s) => s.state === SlotState.CANCELLED || s.state === SlotState.NO_SHOW);

  // Only slots that have not run out. A no-show at eight o'clock frees an
  // hour that no longer exists by half past nine, and offering it to the
  // waiting list is how a queue fills up with calls nobody can honour.
  const out: Gap[] = freed
    .filter((s) => s.endsAt > now)
    .map((s) => ({
      from: s.appointment.at,
      to: s.endsAt,
      minutes: s.endsAt - s.appointment.at,
      because: s.state === SlotState.CANCELLED
        ? `${s.appointment.patientLabel} cancelled`
        : `${s.appointment.patientLabel} did not arrive`,
    }));

  // Holes between consecutive appointments, but only the ones still ahead —
  // a gap at eight o'clock is history and nobody can sell it.
  for (let i = 0; i < live.length - 1; i += 1) {
    const end = live[i]!.endsAt;
    const next = live[i + 1]!.appointment.at;
    if (next - end >= 30 && next > now) {
      out.push({
        from: end, to: next, minutes: next - end,
        because: 'Free chair time between two appointments',
      });
    }
  }

  return out.sort((a, b) => a.from - b.from);
}

function headlineFor(
  slots: readonly Slot[], blockers: readonly SlotProblem[],
  noShows: readonly Slot[], unconfirmed: readonly Slot[], now: number,
): string {
  void now;
  if (slots.length === 0) return 'Nothing is booked today.';
  if (blockers.length > 0) return blockers[0]!.what + '.';
  const waiting = slots.filter((s) => s.stillWaiting).length;
  if (noShows.length > 0) {
    return `${noShows.length} did not arrive. `
      + `${noShows.length === 1 ? 'That slot is' : 'Those slots are'} free chair time.`;
  }
  if (unconfirmed.length > 0) {
    return `${unconfirmed.length} of ${slots.length} still to confirm.`;
  }
  if (waiting > 0) return `${waiting} waiting to be seated.`;
  return 'The book is confirmed and nothing is outstanding.';
}

/* -------------------------------------------------------------------------
 * Reading the log
 * ---------------------------------------------------------------------- */

/** The first minute each subject saw this event. First, not last: you arrive once. */
function firstMinuteBySubject(
  events: readonly ReadinessEvent[], type: ClinicEvent,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.type !== type) continue;
    const prev = out.get(e.subjectId);
    if (prev === undefined || e.at < prev) out.set(e.subjectId, e.at);
  }
  return out;
}

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/* -------------------------------------------------------------------------
 * The registration form
 * ---------------------------------------------------------------------- */

/**
 * The ten fields of the owner's registration form.
 *
 * Held as data rather than as a form component, for the reason every register
 * in KuBi is: a field that exists only in JSX cannot be checked for
 * completeness, cannot be exported to a sheet, and cannot be told apart from a
 * field somebody deleted.
 *
 * `factKey` is the interesting column. Section VIII — *"Medical History
 * (systemic diseases, current medications, allergies)"* — is not one field. It
 * is the eight tri-state facts the compliance engine has been asking for since
 * it was built, and this is the first place in KuBi where a patient can
 * actually supply them.
 */
export interface RegistrationField {
  numeral: string;
  label: string;
  required: boolean;
  /** PS where getting it wrong is a clinical risk rather than an inconvenience. */
  priority: ControlPriority;
  why: string;
}

export const REGISTRATION_FORM: readonly RegistrationField[] = [
  { numeral: 'I', label: 'Full name', required: true, priority: ControlPriority.PS,
    why: 'PAT-002 — the wrong record is the failure this field exists to prevent' },
  { numeral: 'II', label: 'Date of birth / age', required: true, priority: ControlPriority.PS,
    why: 'Consent belongs to a guardian under 18, and paediatric drug doses are by weight' },
  { numeral: 'III', label: 'Gender', required: true, priority: ControlPriority.I,
    why: 'Record completeness' },
  { numeral: 'IV', label: 'Contact number and alternate', required: true, priority: ControlPriority.C,
    why: 'Reminders, the 15-minute call, and reaching somebody after a procedure' },
  { numeral: 'V', label: 'Email address', required: false, priority: ControlPriority.R,
    why: 'Useful, and no control depends on it' },
  { numeral: 'VI', label: 'Full address', required: true, priority: ControlPriority.I,
    why: 'Record completeness and recall' },
  { numeral: 'VII', label: 'Emergency contact name and number', required: true, priority: ControlPriority.PS,
    why: 'The number somebody dials during the emergency OPEN-012 prepares for' },
  { numeral: 'VIII', label: 'Medical history — systemic disease, medication, allergy',
    required: true, priority: ControlPriority.PS,
    why: 'PAT-004, and the source of every patient fact the mandatory gates read. '
      + 'Unanswered is not "no"' },
  { numeral: 'IX', label: 'Previous dental history', required: true, priority: ControlPriority.I,
    why: 'Trauma, sensitivity and past treatment change what is planned' },
  { numeral: 'X', label: 'Chief complaint', required: true, priority: ControlPriority.C,
    why: 'The reason they came, in their words, before anybody interprets it' },
];

/**
 * The check-in script, as the owner wrote it.
 *
 * Two columns, because the clinic has two scripts and the difference is the
 * point: a returning patient is not asked their name.
 *
 * Deliberately **not** a checklist. "Did you smile?" as a tick is the fastest
 * way to make a whole system feel like surveillance, and it measures nothing.
 * The script is shown to reception at the moment it is needed and nobody is
 * asked to report having said it. One line inside it *is* enforceable —
 * *"Get consent signed as per the treatment to be done"* — and that line is
 * already a mandatory gate on the treatment, where it belongs.
 */
export interface ScriptLine {
  newPatient: string;
  returningPatient: string;
}

export const CHECK_IN_SCRIPT: readonly ScriptLine[] = [
  { newPatient: 'My name is ⟨your name⟩', returningPatient: 'Hello ⟨name⟩, madam / sir' },
  { newPatient: 'Please have a seat', returningPatient: 'Please have a seat' },
  { newPatient: 'Can I have your name please?', returningPatient: 'How are you?' },
  { newPatient: 'Offer water', returningPatient: 'Offer water' },
  { newPatient: 'How can I help you?', returningPatient: 'Your today’s procedure is ⟨treatment⟩' },
  { newPatient: 'Listen to the answer', returningPatient: 'Get consent signed for the treatment to be done' },
];

/** The greeting the script opens with, which is the same for everybody. */
export const GREETING =
  'Greet the patient by name with folded hands, say Good morning / afternoon / '
  + 'evening, and smile.';

/**
 * The hospitality standards, and why they are not controls.
 *
 * *"Make sure of playing soothing music"*, *"engage the patient in a friendly
 * conversation"*, *"create a calming and welcoming atmosphere"*. These are
 * real and they are how the clinic wants to feel. They are also unmeasurable,
 * and a daily tick against "was the atmosphere calming" produces a column of
 * ticks and no calm.
 *
 * So they are shown as standards to be read, not reported. Two of the owner's
 * list are different and are controls elsewhere: communicating an estimated
 * waiting time, and apologising for a delay — both have a number behind them
 * (`waitingMinutes`) and both are already covered by PAT-006.
 */
export const HOSPITALITY_STANDARDS: readonly string[] = [
  'Make the patient comfortable in the waiting area and offer tea or coffee.',
  'Create a calming and welcoming atmosphere.',
  'Play soothing music — it diverts attention and anxiety.',
  'Engage the patient in friendly conversation to build rapport.',
  'Listen actively, and say plainly that the clinic protects their privacy.',
  'Escort the patient to the consultation room and hand over to the assistant.',
];

/**
 * The questions this pair of matrices does not answer.
 *
 * Constitution rule 4. Each changes what the engine reports, and each has more
 * than one defensible answer.
 */
export const RECEPTION_QUESTIONS: readonly string[] = [
  // Plain sentences, not doc-comment markdown: these are rendered on a screen,
  // and asterisks that were emphasis in a source file are litter on a wall.
  'APT-004 says “defined retry protocol” and “escalate after attempts”. How '
  + 'many attempts, how far apart, and to whom? KuBi retries after two hours '
  + 'because the SOP says so, and cannot escalate without the rest.',
  'APT-012 says “defined cutoff”, and the morning review has no hour. KuBi '
  + 'scores it continuously and cannot say it is late.',
  '"High-value" appointments get a 48-hour call. Is that a fee threshold or a '
  + 'named list of treatments? Guessing would either over-call or miss the '
  + 'ones that matter.',
  'Which assistant is assigned to which operatory? PAT-001.a says assistants '
  + 'must be aware of all appointments in their assigned operatory, and no '
  + 'assignment exists — two assistants and four rooms.',
  'Is the Rs. 500 consultation charged to every new patient, or waived when '
  + 'treatment proceeds the same day?',
  'PAT-003 asks for contact details to be re-checked at a “defined interval”. '
  + 'Every visit, or every six months?',
];

/** The columns the appointment sheet must carry. */
export const APPOINTMENT_SHEET_COLUMNS: readonly string[] = [
  'appointment_id', 'patient_id', 'patient_name', 'contact', 'alternate_contact',
  'chief_complaint', 'referred_by', 'treatment_code', 'date', 'time', 'minutes',
  'buffer_minutes', 'operatory', 'doctor', 'assistant', 'new_patient',
  'confirmation', 'contacted_at', 'attempts', 'cancellation_reason',
];
