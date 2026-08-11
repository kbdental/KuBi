/**
 * APT-001 to APT-012 and PAT-001 to PAT-009 — the appointment book.
 *
 * The owner called this the missing link, and it is more than that. Every
 * engine KuBi already has starts from `firstPatientAt` — the morning's start
 * time, the readiness target, the sterilisation long pole, the horizon. That
 * number was handed to the engine and nothing produced it. This is what
 * produces it.
 *
 * *"This area should be highly automated."* Five of the twelve appointment
 * controls give the Doer as **System**, and the tests below check that each of
 * those is a calculation rather than a task on somebody's list.
 */
import { describe, it, expect } from 'vitest';
import {
  RoleCode, ClinicEvent, ControlPriority,
  Confirmation, SlotState,
  reception, REGISTRATION_FORM, CHECK_IN_SCRIPT, HOSPITALITY_STANDARDS,
  RECEPTION_QUESTIONS, APPOINTMENT_SHEET_COLUMNS,
  LATE_CALL_MINUTES, NO_SHOW_MINUTES, REVIEW_MINUTES_BEFORE_FIRST,
  RETRY_HOURS, WAIT_ALERT_MINUTES, CONSULTATION_FEE,
  type Appointment, type ReceptionInputs, type ReadinessEvent,
} from '@kubi/contracts';

const T = (h: number, m = 0) => h * 60 + m;
const NOW = T(9, 15);

const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1', patientId: 'p1', patientLabel: 'Anita Rao',
  contact: '9820000001', alternateContact: null,
  chiefComplaint: 'Pain, lower right', referredBy: null,
  treatmentCode: 'RCT-POST', at: T(10, 0), minutes: null, bufferMinutes: 0,
  sitting: 1, operatoryId: 'op-1',
  doctorEmployeeCode: 'e7', assistantEmployeeCode: 'e1',
  isNewPatient: false, special: false, specialBecause: null,
  confirmation: Confirmation.CONFIRMED, contactedAt: T(8, 30), attempts: 1,
  cancellationReason: null, ...over,
});

/** Everything the other engines say is fine. */
const ok = (over: Partial<ReceptionInputs> = {}): ReceptionInputs => ({
  present: new Set(['e1', 'e7']),
  onLeave: new Set<string>(),
  roomsWithdrawn: new Set<string>(),
  knownRooms: new Set(['op-1', 'op-2', 'op-3', 'op-4']),
  notReadyBookings: new Set<string>(),
  historyMissing: new Set<string>(),
  risks: new Map(),
  ...over,
});

const chairMinutes = () => 60;

const view = (
  appointments: Appointment[], events: ReadinessEvent[] = [],
  inputs = ok(), now = NOW,
) => reception(appointments, events, chairMinutes, inputs, now);

const at = (type: ClinicEvent, subjectId: string, minute: number): ReadinessEvent =>
  ({ type, subjectId, at: minute });

/* ═══════════════════════════════════════════════════════════════════════ */

describe('APT-001 · the book is the thing the morning was assuming', () => {
  it('produces the first-patient minute, rather than being handed it', () => {
    // The whole reason this is the missing link. Every other engine computes
    // backwards from this number and nothing in KuBi produced it.
    const v = view([appt({ at: T(10, 30) }), appt({ id: 'a2', at: T(9, 45) })]);
    expect(v.firstAppointmentAt).toBe(T(9, 45));
  });

  it('has no first patient when nothing is booked, and does not invent one', () => {
    // The design principle, verbatim: absent appointment data is not a guessed
    // first-patient time.
    const v = view([]);
    expect(v.firstAppointmentAt).toBeNull();
    expect(v.reviewBy).toBeNull();
    expect(v.headline).toBe('Nothing is booked today.');
  });

  it('ignores a cancelled slot when working out when the day starts', () => {
    // Opening the clinic an hour early for somebody who cancelled is exactly
    // the kind of quiet waste a derived number should prevent.
    const v = view([
      appt({ id: 'a1', at: T(9, 0), confirmation: Confirmation.CANCELLED,
        cancellationReason: 'Unwell' }),
      appt({ id: 'a2', at: T(11, 0) }),
    ]);
    expect(v.firstAppointmentAt).toBe(T(11, 0));
  });

  it('gives reception thirty minutes to review it, from the clinic’s own words', () => {
    expect(REVIEW_MINUTES_BEFORE_FIRST).toBe(30);
    expect(view([appt({ at: T(10, 0) })]).reviewBy).toBe(T(9, 30));
  });
});

describe('APT-001.b and .c · the checks a booking could not carry', () => {
  it('names the assistant who is missing, not just "an assistant"', () => {
    // The check the book could not do before, because a booking named nobody.
    // "Is any assistant in the building" was the best the system could manage.
    const v = view([appt()], [], ok({ present: new Set(['e7']) }));
    const problem = v.problems.find((p) => p.what.includes('assistant'))!;
    expect(problem.control).toBe('APT-001.b');
    expect(problem.priority).toBe(ControlPriority.C);
    expect(problem.what).toContain('not in the building');
  });

  it('says on leave rather than absent, when that is what it is', () => {
    // Two different sentences for a manager: one means find her, the other
    // means find somebody else.
    const v = view([appt()], [],
      ok({ present: new Set(['e1']), onLeave: new Set(['e7']) }));
    expect(v.problems.some((p) => p.what.includes('on approved leave'))).toBe(true);
  });

  it('reports a slot with nobody assigned at all', () => {
    const v = view([appt({ doctorEmployeeCode: null })]);
    expect(v.problems.some((p) => p.what.includes('has no doctor assigned'))).toBe(true);
  });

  it('says nothing about staffing when the attendance sheet has not been read', () => {
    // UNKNOWN is never a pass — and it is also not a failure to shout about.
    // A book loaded before attendance must not report every slot as unstaffed.
    const v = view([appt()], [], ok({ present: undefined }));
    expect(v.problems.filter((p) => p.control === 'APT-001.b')).toEqual([]);
  });

  it('turns a withdrawn operatory into a patient who needs moving', () => {
    // OPEN-004 reaching the appointment book. A down chair was a maintenance
    // ticket; this is the sentence that says who it displaced.
    const v = view([appt()], [], ok({ roomsWithdrawn: new Set(['op-1']) }));
    const problem = v.problems.find((p) => p.control === 'APT-001.c')!;
    expect(problem.what).toContain('may not take a patient');
    expect(problem.ownerRole).toBe(RoleCode.CLINIC_MANAGER);
  });

  it('catches a booking into a room the clinic does not have', () => {
    const v = view([appt({ operatoryId: 'op-9' })]);
    expect(v.problems.some((p) => p.what.includes('which this clinic does not have')))
      .toBe(true);
  });

  it('counts the buffer as chair time, so a long procedure blocks the diary', () => {
    // APT-001.d. Sixty minutes plus a thirty-minute buffer is ninety minutes
    // of chair, and a diary that only knew about sixty would book over it.
    const v = view([appt({ at: T(10, 0), minutes: 60, bufferMinutes: 30 })]);
    expect(v.slots[0]!.endsAt).toBe(T(11, 30));
  });
});

describe('the clock does the work — 15 minutes, then 20', () => {
  it('says call them at fifteen minutes past', () => {
    expect(LATE_CALL_MINUTES).toBe(15);
    const v = view([appt({ at: T(9, 0) })], [], ok(), T(9, 15));
    expect(v.slots[0]!.state).toBe(SlotState.LATE);
    expect(v.callNow).toHaveLength(1);
    expect(v.slots[0]!.because).toContain('Call them now');
  });

  it('marks the no-show at twenty, and owes a follow-up', () => {
    expect(NO_SHOW_MINUTES).toBe(20);
    const v = view([appt({ at: T(9, 0) })], [], ok(), T(9, 20));
    expect(v.slots[0]!.state).toBe(SlotState.NO_SHOW);
    expect(v.noShows).toHaveLength(1);
    // APT-010's automation: the follow-up is generated, not remembered.
    expect(v.problems.some((p) => p.control === 'APT-010')).toBe(true);
  });

  it('is a calculation, not a status somebody sets', () => {
    // The property that makes it automated. Same book, same events, one
    // minute later — and no event named NO_SHOW exists to be recorded.
    const book = [appt({ at: T(9, 0) })];
    expect(view(book, [], ok(), T(9, 14)).slots[0]!.state).toBe(SlotState.CONFIRMED);
    expect(view(book, [], ok(), T(9, 19)).slots[0]!.state).toBe(SlotState.LATE);
    expect(Object.keys(ClinicEvent).filter((n) => /NO_SHOW|MARK_LATE/.test(n)))
      .toEqual([]);
  });

  it('stops the clock the moment they walk in', () => {
    const v = view([appt({ at: T(9, 0) })],
      [at(ClinicEvent.PATIENT_ARRIVED, 'a1', T(9, 25))], ok(), T(9, 30));
    expect(v.slots[0]!.state).toBe(SlotState.ARRIVED);
    expect(v.noShows).toEqual([]);
  });
});

describe('the owner’s KPI · waiting = seated − checked in', () => {
  it('measures it from two events that were already in the log', () => {
    // *"This gives you a genuine operational KPI rather than staff opinion."*
    const v = view([appt()], [
      at(ClinicEvent.PATIENT_ARRIVED, 'a1', T(9, 50)),
      at(ClinicEvent.PATIENT_SEATED, 'a1', T(10, 8)),
    ], ok(), T(10, 30));
    expect(v.slots[0]!.waitingMinutes).toBe(18);
    expect(v.waiting.averageMinutes).toBe(18);
    expect(v.waiting.seated).toBe(1);
  });

  it('reports the wait so far while somebody is still sitting there', () => {
    // A KPI that only exists after the fact cannot send anybody out to
    // apologise to a person who is still waiting.
    const v = view([appt()],
      [at(ClinicEvent.PATIENT_ARRIVED, 'a1', T(9, 40))], ok(), T(10, 5));
    expect(v.slots[0]!.stillWaiting).toBe(true);
    expect(v.slots[0]!.waitingMinutes).toBe(25);
  });

  it('raises PAT-006 once the wait passes the alert, and names the standard', () => {
    const v = view([appt()],
      [at(ClinicEvent.PATIENT_ARRIVED, 'a1', T(9, 20))], ok(), T(10, 0));
    const problem = v.problems.find((p) => p.control === 'PAT-006')!;
    expect(problem.what).toContain('40 minutes');
    expect(problem.what).toContain('communicate a delay, not to hope');
    expect(v.waiting.overdue).toBe(1);
    expect(WAIT_ALERT_MINUTES).toBe(30);
  });

  it('reports nothing to measure as null rather than as nought minutes', () => {
    const v = view([appt()]);
    expect(v.waiting.averageMinutes).toBeNull();
    expect(v.waiting.longestMinutes).toBeNull();
  });

  it('takes the first arrival, because a person arrives once', () => {
    const v = view([appt()], [
      at(ClinicEvent.PATIENT_ARRIVED, 'a1', T(9, 40)),
      at(ClinicEvent.PATIENT_ARRIVED, 'a1', T(9, 55)),
      at(ClinicEvent.PATIENT_SEATED, 'a1', T(10, 0)),
    ], ok(), T(10, 30));
    expect(v.slots[0]!.waitingMinutes).toBe(20);
  });
});

describe('APT-003 · the confirmation cannot remain blank', () => {
  it('has a state for nobody having tried, rather than an empty field', () => {
    // The failure line is the whole design. "Not contacted" is a positive
    // statement about the clinic, and it is what the queue is built from.
    const v = view([appt({ confirmation: Confirmation.NOT_CONTACTED })]);
    expect(v.unconfirmed).toHaveLength(1);
    expect(v.problems.some((p) => p.control === 'APT-002')).toBe(true);
  });

  it('retries after two hours, from the clinic’s own protocol', () => {
    expect(RETRY_HOURS).toBe(2);
    const early = view([appt({
      confirmation: Confirmation.NO_RESPONSE, contactedAt: T(8, 0),
    })], [], ok(), T(9, 0));
    expect(early.retryDue).toEqual([]);

    const due = view([appt({
      confirmation: Confirmation.NO_RESPONSE, contactedAt: T(7, 0),
    })], [], ok(), T(9, 15));
    expect(due.retryDue).toHaveLength(1);
    expect(due.problems.some((p) => p.control === 'APT-004')).toBe(true);
  });

  it('will not let a cancellation pass without a reason', () => {
    // APT-009. A cancellation with no reason cannot be counted in the monthly
    // pattern analysis the SOP asks for, so the absence is the finding.
    const v = view([appt({
      confirmation: Confirmation.CANCELLED, cancellationReason: null,
    })]);
    expect(v.cancellationsWithoutReason).toHaveLength(1);
    expect(v.problems.some((p) => p.control === 'APT-009')).toBe(true);
  });

  it('says nothing about a cancellation that has one', () => {
    const v = view([appt({
      confirmation: Confirmation.CANCELLED, cancellationReason: 'Out of town',
    })]);
    expect(v.cancellationsWithoutReason).toEqual([]);
    expect(v.slots[0]!.because).toBe('Cancelled — Out of town');
  });
});

describe('PAT-002 and PAT-004 · the two patient-safety controls', () => {
  it('treats an unregistered patient as an identity failure, not a paperwork one', () => {
    // PAT-002's automation line is "prevent wrong record". No record is the
    // limiting case of the wrong one, and there is nowhere to write a history.
    const v = view([appt({ patientId: null, isNewPatient: true })]);
    const problem = v.problems[0]!;
    expect(problem.control).toBe('PAT-002');
    expect(problem.priority).toBe(ControlPriority.PS);
  });

  it('makes a missing medical history a clinical gate, as the matrix says', () => {
    // The reason this file is the missing link twice over: the compliance
    // engine has been asking for these facts since it was built, and there was
    // nowhere a patient could supply them.
    const v = view([appt()], [], ok({ historyMissing: new Set(['p1']) }));
    const problem = v.problems.find((p) => p.control === 'PAT-004')!;
    expect(problem.priority).toBe(ControlPriority.PS);
    expect(problem.what).toContain('systemic disease, medication and allergy');
  });

  it('puts a medical risk in front of the clinical team, not reception', () => {
    // PAT-005 — "risk visible to clinical team", automation "doctor
    // notification". Telling the receptionist about a warfarin patient is
    // filing, not safety.
    const v = view([appt()], [], ok({
      risks: new Map([['p1', ['on warfarin, INR not seen this week']]]),
    }));
    const problem = v.problems.find((p) => p.control === 'PAT-005')!;
    expect(problem.ownerRole).toBe(RoleCode.TREATING_DOCTOR);
    expect(problem.what).toContain('warfarin');
  });

  it('sorts patient safety above everything else on the board', () => {
    const v = view([appt({
      patientId: null, confirmation: Confirmation.NOT_CONTACTED,
    })]);
    expect(v.problems[0]!.priority).toBe(ControlPriority.PS);
  });
});

describe('APT-008 · the gaps, computed rather than reported', () => {
  it('turns a cancellation into chair time somebody could have', () => {
    // A gap is the absence of something, and nobody reports an absence.
    const v = view([appt({
      at: T(11, 0), minutes: 60,
      confirmation: Confirmation.CANCELLED, cancellationReason: 'Unwell',
    })]);
    expect(v.gaps).toHaveLength(1);
    expect(v.gaps[0]!.minutes).toBe(60);
    expect(v.gaps[0]!.because).toContain('cancelled');
  });

  it('turns a no-show into the same thing', () => {
    const v = view([appt({ at: T(9, 0), minutes: 30 })], [], ok(), T(9, 25));
    expect(v.gaps[0]!.because).toContain('did not arrive');
  });

  it('finds a hole between two appointments, if it is still ahead', () => {
    const v = view([
      appt({ id: 'a1', at: T(10, 0), minutes: 30 }),
      appt({ id: 'a2', at: T(12, 0), minutes: 30 }),
    ], [], ok(), T(9, 15));
    expect(v.gaps.map((g) => g.minutes)).toEqual([90]);
  });

  it('does not offer a gap that has already passed', () => {
    // Nobody can sell eight o'clock at half past nine — and that holds for a
    // hole between two slots and for a slot somebody failed to turn up to,
    // which is how this was found.
    const v = view([
      appt({ id: 'a1', at: T(8, 0), minutes: 30 }),
      appt({ id: 'a2', at: T(9, 0), minutes: 30 }),
    ], [], ok(), T(9, 15));
    expect(v.gaps).toEqual([]);
  });

  it('stops offering a no-show’s slot once the slot itself has run out', () => {
    const missed = appt({ at: T(9, 0), minutes: 30 });
    expect(view([missed], [], ok(), T(9, 25)).gaps).toHaveLength(1);
    expect(view([missed], [], ok(), T(9, 40)).gaps).toEqual([]);
  });
});

describe('APT-012 · the morning review scores itself', () => {
  it('is complete when nothing critical is unresolved', () => {
    const v = view([appt()]);
    expect(v.reviewComplete).toBe(true);
    expect(v.reviewScore).toBe(100);
    expect(v.reviewBlockers).toEqual([]);
  });

  it('is held by a PS or a C, and not by an unsent reminder', () => {
    // A review that could never complete while an I was outstanding is a
    // score nobody would look at twice.
    const withI = view([appt({ confirmation: Confirmation.NOT_CONTACTED })]);
    expect(withI.reviewComplete).toBe(true);
    expect(withI.problems.some((p) => p.priority === ControlPriority.I)).toBe(true);

    const withC = view([appt()], [], ok({ roomsWithdrawn: new Set(['op-1']) }));
    expect(withC.reviewComplete).toBe(false);
    expect(withC.reviewBlockers).toHaveLength(1);
  });

  it('goes back to incomplete if a slot breaks after it went true', () => {
    // Derived, like clinic readiness. Nobody ticks it, so nobody has to un-tick
    // it when the chair fails at half past ten.
    const book = [appt()];
    expect(view(book).reviewComplete).toBe(true);
    expect(view(book, [], ok({ present: new Set(['e7']) })).reviewComplete).toBe(false);
  });

  it('does not score an empty book as a perfect morning', () => {
    // Nothing to review is not a review that went well.
    const v = view([]);
    expect(v.reviewComplete).toBe(false);
    expect(v.reviewScore).toBe(0);
  });
});

describe('the registration form is where patient facts enter KuBi', () => {
  it('holds all ten of the owner’s fields', () => {
    expect(REGISTRATION_FORM).toHaveLength(10);
    expect(REGISTRATION_FORM.map((f) => f.numeral)).toEqual([
      'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    ]);
  });

  it('marks the medical history as the clinical gate it is', () => {
    // Section VIII is not one field. It is the eight tri-state facts the
    // compliance engine has been asking for since it was built.
    const viii = REGISTRATION_FORM.find((f) => f.numeral === 'VIII')!;
    expect(viii.priority).toBe(ControlPriority.PS);
    expect(viii.why).toContain('mandatory gates');
    expect(viii.why).toContain('Unanswered is not "no"');
  });

  it('gives every field a reason, so none is collected out of habit', () => {
    for (const f of REGISTRATION_FORM) {
      expect(f.why.length, `${f.numeral} has no reason`).toBeGreaterThan(15);
    }
  });

  it('does not require the one field no control depends on', () => {
    // Email. Useful, and making it mandatory would stop a registration for
    // nothing — which is how forms teach people to type rubbish.
    expect(REGISTRATION_FORM.find((f) => f.numeral === 'V')!.required).toBe(false);
  });

  it('holds the consultation fee as data rather than in a sentence', () => {
    expect(CONSULTATION_FEE).toBe(500);
  });
});

describe('the script is shown, and never ticked', () => {
  it('carries both columns, because the clinic has two scripts', () => {
    // A returning patient is not asked their name, and that difference is the
    // whole point of the owner writing it in two columns.
    expect(CHECK_IN_SCRIPT.length).toBeGreaterThanOrEqual(5);
    expect(CHECK_IN_SCRIPT[2]!.newPatient).toContain('Can I have your name');
    expect(CHECK_IN_SCRIPT[2]!.returningPatient).toContain('How are you');
  });

  it('leaves the one enforceable line to the engine that already enforces it', () => {
    // "Get consent signed as per the treatment to be done" is a mandatory gate
    // on the treatment. It is in the script because reception says it; it is
    // not a second place where consent is recorded.
    expect(CHECK_IN_SCRIPT.at(-1)!.returningPatient).toContain('consent signed');
  });

  it('keeps hospitality as standards to read, not boxes to tick', () => {
    // "Was the atmosphere calming" as a daily tick produces a column of ticks
    // and no calm.
    expect(HOSPITALITY_STANDARDS.length).toBeGreaterThanOrEqual(5);
    expect(HOSPITALITY_STANDARDS.join(' ')).toContain('soothing music');
  });
});

describe('what these matrices do not settle', () => {
  it('names the retry protocol as undefined rather than inventing one', () => {
    // APT-004 says "defined retry protocol" and "escalate after attempts".
    // KuBi retries after two hours because the SOP says so, and cannot
    // escalate without knowing how many attempts or to whom.
    //
    // These strings are rendered on a screen, so they are plain sentences —
    // doc-comment asterisks were showing up as litter on the wall.
    expect(RECEPTION_QUESTIONS.join(' ')).not.toContain('*');
    expect(RECEPTION_QUESTIONS.join(' ')).toContain('How many attempts');
  });

  it('names the missing cutoff, so the score cannot pretend to be late', () => {
    expect(RECEPTION_QUESTIONS.join(' ')).toContain('defined cutoff');
  });

  it('refuses to guess what "high-value" means', () => {
    expect(RECEPTION_QUESTIONS.join(' ')).toContain('fee threshold');
  });

  it('names the operatory assignment nobody has made', () => {
    // PAT-001.a assumes assistants have assigned operatories. Two assistants,
    // four rooms, and no assignment exists.
    expect(RECEPTION_QUESTIONS.join(' ')).toContain('two assistants and four rooms');
  });

  it('names the columns the clinic’s sheet must carry', () => {
    for (const c of ['operatory', 'doctor', 'assistant', 'confirmation',
      'cancellation_reason', 'buffer_minutes']) {
      expect(APPOINTMENT_SHEET_COLUMNS).toContain(c);
    }
  });
});
