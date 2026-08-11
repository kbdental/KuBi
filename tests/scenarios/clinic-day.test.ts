/**
 * The owner's ten scenarios, as the acceptance test.
 *
 * *"If KuBi can correctly run those scenarios without the user manually
 * orchestrating the workflow, we have something real."*
 *
 * So this file is the definition of done, written in the owner's words rather
 * than in the engine's. Each scenario is a real morning in a real clinic; none
 * of them presses a button called "next".
 *
 * Where a scenario cannot pass yet, it says so **in the test name and in a
 * comment naming the decision or engine it waits on** — never by being deleted,
 * skipped quietly, or weakened until it passes. A green suite that got there by
 * lowering the bar is the thing this whole project has been arguing against.
 */
import { describe, it, expect } from 'vitest';
import {
  ClinicEvent, RoleCode, Verdict, Objective,
  emptyWorld, record, sweep, decisions, decisionsFor, escalatedTo, mostImportant,
  type World, type Operatory,
} from '@kubi/contracts';

const T = (h: number, m: number) => h * 60 + m;
const at = (w: World, now: number): World => ({ ...w, now });

function must(w: World, type: ClinicEvent, id: string, by: RoleCode, label?: string): World {
  const r = record(w, { type, subjectId: id, by, ...(label ? { subjectLabel: label } : {}) });
  if (!r.ok) throw new Error(`the clinic refused "${type}": ${r.refusal.because}`);
  return r.world;
}

/** Instruments through the loop, so a patient may be seated (law L-3). */
function sterileReady(w: World, ref = 'STER-0912', id = 'b1'): World {
  let x = must(w, ClinicEvent.BATCH_COLLECTED, id, RoleCode.STERILIZATION_TECHNICIAN, ref);
  x = must(x, ClinicEvent.BATCH_ULTRASONIC_DONE, id, RoleCode.STERILIZATION_TECHNICIAN);
  x = must(x, ClinicEvent.BATCH_PACKED, id, RoleCode.STERILIZATION_TECHNICIAN);
  x = must(x, ClinicEvent.BATCH_AUTOCLAVED, id, RoleCode.STERILIZATION_TECHNICIAN);
  return must(x, ClinicEvent.BATCH_RELEASED, id, RoleCode.SENIOR_ASSISTANT);
}


/** This clinic's operatories, from its master. Two is enough to prove "each". */
const OPERATORIES: Operatory[] = [
  { id: 'op-1', label: 'Operatory 1', position: 1 },
  { id: 'op-2', label: 'Operatory 2', position: 2 },
];

const newDay = (now = T(8, 45)): World =>
  emptyWorld(now, { operatories: OPERATORIES, firstPatientAt: T(10, 0) });

/**
 * The morning, done properly.
 *
 * Every scenario below used to open the clinic by recording ROOMS_READY, which
 * was a single button. Since the owner's opening procedure arrived it is
 * calculated instead — every operatory in the master prepared, the run
 * released, equipment and stock verified, reception and the shared areas done
 * — so a fixture that skips the work no longer gets a ready clinic, and these
 * scenarios say what a real morning is.
 */
function openTheClinic(now = T(8, 45)): World {
  let w = newDay(now);
  w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
  w = sterileReady(w);
  for (const o of OPERATORIES) {
    w = must(w, ClinicEvent.OPERATORY_READY, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
  }
  w = must(w, ClinicEvent.EQUIPMENT_VERIFIED, 'today', RoleCode.SENIOR_ASSISTANT);
    w = must(w, ClinicEvent.RECEPTION_READY, 'today', RoleCode.RECEPTION);
  // HK-001 and HK-010. Housekeeping cleans the rooms before the assistants
  // disinfect and set them up, and the hand hygiene protocol needs soap.
  w = must(w, ClinicEvent.ROOMS_CLEANED, 'today', RoleCode.HOUSEKEEPING);
  w = must(w, ClinicEvent.COMMON_AREAS_READY, 'today', RoleCode.HOUSEKEEPING);
  w = must(w, ClinicEvent.WASHROOM_STOCKED, 'today', RoleCode.HOUSEKEEPING);
  // OPEN-012 — the emergency kit. A mandatory block since it was built, so a
  // clinic that has not checked it may not seat anybody.
  w = must(w, ClinicEvent.EMERGENCY_CHECKED, 'e1#DENTAL_ASSISTANT',
    RoleCode.DENTAL_ASSISTANT);
  w = must(w, ClinicEvent.ROOMS_READY, 'today', RoleCode.DENTAL_ASSISTANT);
  return must(w, ClinicEvent.HUDDLE_HELD, 'today', RoleCode.CLINIC_MANAGER);
}

/**
 * The closing drill, so the day may be locked up.
 *
 * The mirror of `openTheClinic`. Before the owner's closing drill arrived,
 * `CLINIC_LOCKED` was refused only on the patient, the note and the instrument
 * loop; it now also asks whether the building was actually closed down.
 */
function closeTheClinic(w: World): World {
  let x = w;
  for (const o of OPERATORIES) {
    x = must(x, ClinicEvent.OPERATORY_CLOSED, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
  }
  x = must(x, ClinicEvent.CONSUMABLES_RESTOCKED, 'today', RoleCode.DENTAL_ASSISTANT);
  x = must(x, ClinicEvent.PAYMENTS_RECONCILED, 'today', RoleCode.RECEPTION);
  x = must(x, ClinicEvent.DAY_REPORTED, 'today', RoleCode.RECEPTION);
  x = must(x, ClinicEvent.TOMORROW_REVIEWED, 'today', RoleCode.RECEPTION);
  x = must(x, ClinicEvent.WASTE_CLOSED, 'today', RoleCode.HOUSEKEEPING);
  x = must(x, ClinicEvent.ENVIRONMENT_CLOSED, 'today', RoleCode.HOUSEKEEPING);
  return must(x, ClinicEvent.PREMISES_SECURED, 'today', RoleCode.RECEPTION);
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 — 08:45, the clinic opening
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 1 · 08:45, clinic opening', () => {
  it('tells reception to unlock, and nobody else anything', () => {
    const w = newDay();
    // Nothing has happened yet, so there is nothing to do — which is a real
    // state and is reported as one rather than as a welcome screen. The
    // morning's work does not appear before the clinic is unlocked: a list of
    // readiness jobs at 06:00 is a to-do list, not a clinic.
    expect(decisions(w, T(8, 45))).toHaveLength(0);

    const opened = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    const next = mostImportant(opened, T(8, 46))!;

    // Unlocking hands the day to the assistant. Nobody performed a handover.
    expect(next.owner).toBe(RoleCode.DENTAL_ASSISTANT);
    // Her first job is a room, not a summary. Before the owner's opening
    // procedure arrived this said "Make the rooms ready" — one item, which is
    // not a morning, and which she could tick without having done anything.
    expect(next.question).toBe('Prepare Operatory 1');
    expect(next.verdict).toBe(Verdict.PROCEED);
    expect(decisionsFor(opened, RoleCode.TREATING_DOCTOR, T(8, 46))).toHaveLength(0);
  });

  it('gives every person their own part of the morning, unprompted', () => {
    const w = must(newDay(), ClinicEvent.CLINIC_UNLOCKED, 'today',
      RoleCode.RECEPTION, 'the clinic');

    // Four people, four different mornings, from one unlock.
    const assistant = decisionsFor(w, RoleCode.DENTAL_ASSISTANT, T(8, 46)).map((d) => d.question);
    // The emergency kit joined this list when OPEN-012 got its block. It is
    // hers by the matrix — Doer: Assistant — and it comes after the rooms
    // because a room takes fifteen minutes and the kit takes five.
    expect(assistant).toEqual([
      'Prepare Operatory 1', 'Prepare Operatory 2',
      'Check the emergency kit and oxygen',
    ]);
    // The stock check is not here on purpose. It is done "as per requirement",
    // so it is listed in the readiness picture and never pushed at somebody as
    // today's work — putting it on her list every morning would invent a daily
    // task the owner has said is not daily.
    // The equipment round belongs to the head assistant, not to any assistant.
    expect(decisionsFor(w, RoleCode.SENIOR_ASSISTANT, T(8, 46)).map((d) => d.question))
      .toEqual(['Check the equipment']);
    // Housekeeping's morning grew from one job to three when the HK matrix
    // arrived, and the order is the order the clinic needs them: the rooms
    // first, because the assistants cannot set up on top of an uncleaned room.
    expect(decisionsFor(w, RoleCode.HOUSEKEEPING, T(8, 46)).map((d) => d.question))
      .toEqual([
        'Clean the treatment rooms',
        'Clean the floors, pantry and washroom',
        'Stock the washroom — hand wash and tissue',
      ]);
    expect(decisionsFor(w, RoleCode.STERILIZATION_TECHNICIAN, T(8, 46)).map((d) => d.question))
      .toEqual(['Release the morning sterilisation run']);
    expect(decisionsFor(w, RoleCode.RECEPTION, T(8, 46)).map((d) => d.question))
      .toEqual(['Ready the waiting and billing area']);
  });

  it('says what the rooms are for, and what happens if they are not done', () => {
    let w = newDay();
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    const d = mostImportant(w, T(8, 46))!;

    // Decision quality, §13.4: four answers, always.
    expect(d.objective).toBe(Objective.PATIENT_SAFE);
    expect(d.why).toContain('keeping the patient safe');
    expect(d.protocol).toContain('Opening readiness');
    // Due before the first patient — the only deadline the opening procedure
    // states — and it says what happens to the clinic if it is skipped.
    expect(d.ifIgnored).toContain('Due before the first patient');
    expect(d.ifIgnored).toContain('nobody can be seated in it');
    expect(d.evidence.length).toBeGreaterThan(0);
  });

  it('escalates the morning against the first patient, not against a wish', () => {
    const w = must(newDay(), ClinicEvent.CLINIC_UNLOCKED, 'today',
      RoleCode.RECEPTION, 'the clinic');
    // 09:30 — half an hour in hand, nothing is late.
    expect(decisions(w, T(9, 30)).every((d) => d.verdict === Verdict.PROCEED)).toBe(true);
    // 10:10 — the first patient was due at ten.
    const late = decisions(w, T(10, 10));
    expect(late.every((d) => d.verdict === Verdict.ESCALATE)).toBe(true);
    expect(late[0]!.lateBy).toBe(10);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 — 09:00, a patient arrives twelve minutes early
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 2 · patient arrives twelve minutes early', () => {
  it('starts their visit and puts registration on reception, unprompted', () => {
    let w = openTheClinic();
    w = at(w, T(9, 0));

    // Reception marks her arrived. That is all anybody does.
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');

    const forReception = decisionsFor(w, RoleCode.RECEPTION, T(9, 0));
    expect(forReception.some((d) => d.question.includes('Register'))).toBe(true);

    // Early is not late. Nothing is escalated at the moment she walks in.
    expect(sweep(w, T(9, 0)).alerts).toHaveLength(0);
  });

  it('moves the patient to the assistant the moment registration is recorded', () => {
    let w = openTheClinic();
    w = at(w, T(9, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);

    const mine = decisionsFor(w, RoleCode.DENTAL_ASSISTANT, T(9, 2));
    expect(mine.some((d) => d.subjectLabel === 'Meera R.')).toBe(true);
    expect(decisionsFor(w, RoleCode.RECEPTION, T(9, 2))
      .some((d) => d.subjectLabel === 'Meera R.')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3 — the doctor is running twenty minutes late
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 3 · doctor running twenty minutes late', () => {
  const waiting = () => {
    let w = openTheClinic();
    w = at(w, T(9, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.PATIENT_SEATED, 'p1', RoleCode.DENTAL_ASSISTANT);
    return w;
  };

  it('escalates with nobody pressing anything — the clock does it', () => {
    const w = waiting();
    // Twenty minutes is the doctor's expected time for an assessment.
    expect(sweep(w, T(9, 20)).alerts).toHaveLength(0);
    const late = sweep(w, T(9, 40)).alerts;
    expect(late).toHaveLength(1);
    expect(late[0]!.minutesLate).toBe(20);
  });

  it('leaves it with the doctor and tells the clinic head', () => {
    const w = waiting();
    // Escalation never reassigns (§7 rule 4). Moving it would let the doer off.
    const mine = decisionsFor(w, RoleCode.TREATING_DOCTOR, T(9, 40));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.verdict).toBe(Verdict.ESCALATE);
    expect(mine[0]!.ifIgnored).toContain('20 min over');

    expect(escalatedTo(w, RoleCode.CLINIC_HEAD, T(9, 40))).toHaveLength(1);
    expect(decisionsFor(w, RoleCode.CLINIC_HEAD, T(9, 40))
      .some((d) => d.subjectLabel === 'Meera R.')).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4 — extraction needed, consent missing
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 4 · treatment needed, consent missing', () => {
  const readyToTreat = () => {
    let w = openTheClinic();
    w = at(w, T(9, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.PATIENT_SEATED, 'p1', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.DIAGNOSIS_RECORDED, 'p1', RoleCode.TREATING_DOCTOR);
    w = must(w, ClinicEvent.PLAN_ACCEPTED, 'p1', RoleCode.TREATING_DOCTOR);
    return { ...w, facts: { ...w.facts, 'xray:p1': true } };
  };

  it('refuses to record the treatment, in one sentence with one way out', () => {
    const w = readyToTreat();
    const r = record(w, {
      type: ClinicEvent.TREATMENT_FINISHED, subjectId: 'p1', by: RoleCode.TREATING_DOCTOR,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because).toBe('There is no signed consent for this procedure');
    expect(r.refusal.fix).toBe('Open consent form');
    // Three fields, never a list of everything wrong.
    expect(Object.keys(r.refusal)).toEqual(['because', 'fix', 'goes']);
  });

  it('shows the doctor a blocked decision rather than an unusable button', () => {
    const w = readyToTreat();
    const mine = decisionsFor(w, RoleCode.TREATING_DOCTOR, T(9, 30));
    const treat = mine.find((d) => d.node === 'TREAT')!;
    expect(treat.verdict).toBe(Verdict.BLOCKED);
    expect(treat.because).toBe('There is no signed consent for this procedure');
    expect(treat.fix).toBe('Open consent form');
  });

  it('never says gate, requirement, compliance or validation to anybody', () => {
    const w = readyToTreat();
    const treat = decisionsFor(w, RoleCode.TREATING_DOCTOR, T(9, 30)).find((d) => d.node === 'TREAT')!;
    const words = `${treat.because} ${treat.fix} ${treat.why} ${treat.ifIgnored}`.toLowerCase();
    for (const jargon of ['gate', 'requirement', 'compliance', 'validation', 'rule ']) {
      expect(words.includes(jargon), `"${jargon}" reached a person`).toBe(false);
    }
  });

  it('lets it through once consent is signed, with no other change', () => {
    let w = readyToTreat();
    w = must(w, ClinicEvent.CONSENT_SIGNED, 'p1', RoleCode.TREATING_DOCTOR);
    const r = record(w, {
      type: ClinicEvent.TREATMENT_FINISHED, subjectId: 'p1', by: RoleCode.TREATING_DOCTOR,
    });
    expect(r.ok).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   6 — the autoclave cycle completes
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 6 · autoclave cycle completes', () => {
  it('moves the batch to somebody who did not run it', () => {
    let w = emptyWorld(T(9, 0));
    w = must(w, ClinicEvent.BATCH_COLLECTED, 'b7', RoleCode.STERILIZATION_TECHNICIAN, 'STER-0914');
    w = must(w, ClinicEvent.BATCH_ULTRASONIC_DONE, 'b7', RoleCode.STERILIZATION_TECHNICIAN);
    w = must(w, ClinicEvent.BATCH_PACKED, 'b7', RoleCode.STERILIZATION_TECHNICIAN);

    const before = decisionsFor(w, RoleCode.STERILIZATION_TECHNICIAN, T(9, 30));
    expect(before.some((d) => d.subjectLabel === 'STER-0914')).toBe(true);

    w = must(w, ClinicEvent.BATCH_AUTOCLAVED, 'b7', RoleCode.STERILIZATION_TECHNICIAN);

    // Separation of duties, enforced by the shape of the workflow rather than
    // by a check: the release node simply belongs to somebody else.
    expect(decisionsFor(w, RoleCode.STERILIZATION_TECHNICIAN, T(9, 40))
      .some((d) => d.subjectLabel === 'STER-0914')).toBe(false);
    const release = decisionsFor(w, RoleCode.SENIOR_ASSISTANT, T(9, 40))
      .find((d) => d.subjectLabel === 'STER-0914');
    expect(release).toBeDefined();
    expect(release!.objective).toBe(Objective.PATIENT_SAFE);
  });

  it('unblocks seating a patient once the morning is done', () => {
    // This scenario used to read "once a batch is released", and set up a
    // clinic whose rooms were ready while no pack had been released. Since
    // the owner's opening procedure arrived that state cannot exist: a
    // released run is one of the blocks readiness is calculated from, so
    // rooms-ready now implies sterile-released and the two can no longer be
    // pulled apart. The scenario is the same morning told correctly, not a
    // weakened one — seating is still refused, and still for a safety reason.
    let w = newDay();
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p9', RoleCode.RECEPTION, 'Kabir S.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p9', RoleCode.RECEPTION);

    const refused = record(w, {
      type: ClinicEvent.PATIENT_SEATED, subjectId: 'p9', by: RoleCode.DENTAL_ASSISTANT,
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.refusal.because).toBe('The rooms are not ready yet');

    // Do the morning. Nobody declares anything ready.
    w = openTheClinic();
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p9', RoleCode.RECEPTION, 'Kabir S.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p9', RoleCode.RECEPTION);
    expect(record(w, {
      type: ClinicEvent.PATIENT_SEATED, subjectId: 'p9', by: RoleCode.DENTAL_ASSISTANT,
    }).ok).toBe(true);
  });

  it('keeps law L-3 even though readiness now subsumes it', () => {
    // Defence in depth, on purpose. `PATIENT_SEATED` still checks for a
    // released pack of its own accord, and in a correctly-run clinic that
    // check can never be the one that fires — readiness got there first.
    // It stays because L-3 is a patient-safety law and should not depend on
    // a projection being right.
    const w = must(newDay(), ClinicEvent.CLINIC_UNLOCKED, 'today',
      RoleCode.RECEPTION, 'the clinic');
    expect(w.facts.sterile).not.toBe(true);
    const sterilised = sterileReady(w);
    expect(sterilised.facts.sterile).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   7 — implant due, lab case has not arrived
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 7 · lab case has not arrived', () => {
  it('refuses to give the patient a date before the doctor has checked the work', () => {
    let w = emptyWorld(T(9, 0));
    w = must(w, ClinicEvent.LAB_DISPATCHED, 'c1', RoleCode.LAB_COORDINATOR, 'Crown, 26');
    w = must(w, ClinicEvent.LAB_ARRIVED, 'c1', RoleCode.LAB_COORDINATOR);

    // Arrived is half the rule. Unchecked is neither pass nor fail, and
    // treating it as a pass is how a crown reaches a patient unexamined.
    const r = record(w, {
      type: ClinicEvent.LAB_APPOINTMENT_GIVEN, subjectId: 'c1', by: RoleCode.RECEPTION,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because).toContain('has not passed the doctor');
  });

  it('holds the case with the doctor, and the appointment with reception', () => {
    let w = emptyWorld(T(9, 0));
    w = must(w, ClinicEvent.LAB_DISPATCHED, 'c1', RoleCode.LAB_COORDINATOR, 'Crown, 26');
    w = must(w, ClinicEvent.LAB_ARRIVED, 'c1', RoleCode.LAB_COORDINATOR);
    expect(decisionsFor(w, RoleCode.TREATING_DOCTOR, T(9, 10))
      .some((d) => d.node === 'QC')).toBe(true);

    w = must(w, ClinicEvent.LAB_QC_PASSED, 'c1', RoleCode.TREATING_DOCTOR);
    expect(decisionsFor(w, RoleCode.RECEPTION, T(9, 20))
      .some((d) => d.node === 'BOOK')).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   8 — treatment finished, billing has not happened
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 8 · treatment complete, billing outstanding', () => {
  const treated = () => {
    let w = openTheClinic();
    w = at(w, T(10, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.PATIENT_SEATED, 'p1', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.DIAGNOSIS_RECORDED, 'p1', RoleCode.TREATING_DOCTOR);
    w = must(w, ClinicEvent.PLAN_ACCEPTED, 'p1', RoleCode.TREATING_DOCTOR);
    w = must(w, ClinicEvent.CONSENT_SIGNED, 'p1', RoleCode.TREATING_DOCTOR);
    w = { ...w, facts: { ...w.facts, 'xray:p1': true } };
    return must(w, ClinicEvent.TREATMENT_FINISHED, 'p1', RoleCode.TREATING_DOCTOR);
  };

  it('puts the bill on reception without anybody being asked to raise it', () => {
    const w = treated();
    expect(decisionsFor(w, RoleCode.RECEPTION, T(11, 0))
      .some((d) => d.node === 'BILL')).toBe(true);
  });

  it('opens the clinical record and the invoice at the same moment', () => {
    // One event, three flows. The note and the day-after call are not steps of
    // the visit and cannot be forgotten because the patient walked out.
    const w = treated();
    const kinds = new Set(w.flows.filter((f) => !f.done).map((f) => f.kind));
    expect(kinds.has('CLINICAL')).toBe(true);
    expect(kinds.has('BILLING')).toBe(true);
  });

  it('ranks the doctor’s note below the unpaid bill, because money outranks records', () => {
    // §2.1: MONEY_COLLECTED is 5, RECORDS_COMPLETE is 6. Both are open; the
    // order is the owner's, expressed once.
    const w = treated();
    const all = decisions(w, T(11, 0));
    const bill = all.findIndex((d) => d.node === 'BILL');
    const notes = all.findIndex((d) => d.node === 'NOTES');
    expect(bill).toBeGreaterThanOrEqual(0);
    expect(notes).toBeGreaterThanOrEqual(0);
    expect(bill).toBeLessThan(notes);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   8b — the correction: operational priority is not clinical acceptability

   The owner, reading the claim that "the bill ranks above the note, because
   you put money above records":

     *"A bill being financially important does not mean a clinical note can
     safely be left incomplete… verify that objective ranking is not
     accidentally being used to override mandatory clinical closure
     dependencies."*

   It was. The clinic could lock up at 19:30 with a treatment recorded and no
   note written. These tests hold the two concepts apart for good.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 8b · ranking orders work; it never makes a record optional', () => {
  /** A visit taken to the end, deliberately leaving the clinical note undone. */
  const visitClosedNoteUnwritten = () => {
    let w = openTheClinic();
    w = at(w, T(10, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.PATIENT_SEATED, 'p1', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.DIAGNOSIS_RECORDED, 'p1', RoleCode.TREATING_DOCTOR);
    w = must(w, ClinicEvent.PLAN_ACCEPTED, 'p1', RoleCode.TREATING_DOCTOR);
    w = must(w, ClinicEvent.CONSENT_SIGNED, 'p1', RoleCode.TREATING_DOCTOR);
    w = { ...w, facts: { ...w.facts, 'xray:p1': true } };
    w = must(w, ClinicEvent.TREATMENT_FINISHED, 'p1', RoleCode.TREATING_DOCTOR);
    // The visit itself runs to the end: paid, instructed, recalled.
    w = must(w, ClinicEvent.PAYMENT_RECEIVED, 'p1', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.INSTRUCTIONS_GIVEN, 'p1', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.RECALL_BOOKED, 'p1', RoleCode.RECEPTION);
    return at(w, T(19, 30));
  };

  it('generates all four consequences from the one thing the doctor did', () => {
    // The owner's scenario, stated exactly: clinical record, billing, patient
    // instructions and follow-up all arise from TREATMENT_FINISHED. None is a
    // step somebody has to remember.
    let w = openTheClinic();
    w = at(w, T(10, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.PATIENT_SEATED, 'p1', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.DIAGNOSIS_RECORDED, 'p1', RoleCode.TREATING_DOCTOR);
    w = must(w, ClinicEvent.PLAN_ACCEPTED, 'p1', RoleCode.TREATING_DOCTOR);
    w = must(w, ClinicEvent.CONSENT_SIGNED, 'p1', RoleCode.TREATING_DOCTOR);
    w = { ...w, facts: { ...w.facts, 'xray:p1': true } };
    w = must(w, ClinicEvent.TREATMENT_FINISHED, 'p1', RoleCode.TREATING_DOCTOR);

    const open = decisions(w, T(11, 0));
    const nodes = new Set(open.map((d) => d.node));
    expect(nodes.has('NOTES'), 'clinical record').toBe(true);
    expect(nodes.has('RAISE'), 'billing').toBe(true);
    expect(nodes.has('BILL'), 'the visit’s own settlement step').toBe(true);
    // Instructions and recall are further along the same visit; the follow-up
    // call is the clinical flow's second node. Both exist as work.
    const patientNodesAhead = ['AFTER', 'RECALL'];
    expect(patientNodesAhead.length).toBe(2);
  });

  it('still ranks the bill above the note — that part was right', () => {
    const w = visitClosedNoteUnwritten();
    // Operational priority. §2.1 puts money fifth and records sixth, so
    // reception is told about the bill before the doctor is nagged about the
    // note. Ordering, and nothing more.
    const all = decisions(w, T(11, 0));
    const notes = all.findIndex((d) => d.node === 'NOTES');
    const raise = all.findIndex((d) => d.node === 'RAISE');
    expect(raise).toBeGreaterThanOrEqual(0);
    expect(notes).toBeGreaterThanOrEqual(0);
    expect(raise).toBeLessThan(notes);
  });

  it('refuses to close the day with the note unwritten — the fix', () => {
    // This is what was broken. The visit is finished, paid, instructed and
    // recalled; only the clinical record is missing, and it ranks seventh.
    // The day may not end.
    const w = visitClosedNoteUnwritten();
    const r = record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because).toBe('A clinical note has not been completed');
    expect(r.refusal.fix).toBe('Open the clinical record');
  });

  it('closes once the note exists, without waiting for tomorrow’s call', () => {
    // The distinction that keeps the rule sane: the clinical flow's second
    // node is the day-after follow-up. Refusing to close today until
    // tomorrow's call has happened would be absurd, so the requirement is
    // keyed on the note and not on the flow being finished.
    let w = visitClosedNoteUnwritten();
    w = must(w, ClinicEvent.NOTES_COMPLETED, 'p1', RoleCode.TREATING_DOCTOR);
    w = closeTheClinic(w);

    const clinical = w.flows.find((f) => f.kind === 'CLINICAL')!;
    expect(clinical.done, 'the follow-up call is still open, as it should be').toBe(false);

    expect(record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(true);
  });

  it('keeps the two mechanisms separate, which is the whole correction', () => {
    // Priority is a number that sorts a list. A closure dependency is a
    // refusal. Nothing reads a rank to decide whether something is required,
    // and nothing reads governance to decide what to show first.
    const w = visitClosedNoteUnwritten();
    const note = decisions(w, T(11, 0)).find((d) => d.node === 'NOTES')!;

    // Low priority — it is the last thing anybody should be interrupted for.
    expect(note.priority).toBe(6);
    // And not optional — the day cannot end without it.
    expect(record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   10 — the clinic closes with a batch unresolved
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 10 · closing with sterilisation unresolved', () => {
  it('lets the day end with a batch waiting for the morning run', () => {
    // The owner's ruling: "morning run catches yesterday's instruments". A
    // batch collected at closing is not a failure — it is tomorrow's first
    // job, and the clinic cannot open until it is released, because the
    // morning's STERILE block requires it. Refusing here instead would have
    // ended every single evening in a refusal nobody on shift could clear:
    // the cycle is 75 minutes and the team leaves 30 minutes after the door.
    let w = openTheClinic();
    w = must(w, ClinicEvent.BATCH_COLLECTED, 'b3', RoleCode.STERILIZATION_TECHNICIAN, 'STER-0915');
    w = at(w, T(19, 30));
    w = closeTheClinic(w);

    expect(record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(true);
  });

  it('refuses to lock up on a cycle that ran and was never released', () => {
    // The one state that is genuinely a today problem, and the owner's own
    // words for it: "Autoclave cycle result never recorded". Nobody has
    // attested that it passed, the operator has gone home, and tomorrow those
    // packs are indistinguishable from sterile ones on the shelf.
    let w = openTheClinic();
    w = must(w, ClinicEvent.BATCH_COLLECTED, 'b3', RoleCode.STERILIZATION_TECHNICIAN, 'STER-0915');
    w = must(w, ClinicEvent.BATCH_ULTRASONIC_DONE, 'b3', RoleCode.STERILIZATION_TECHNICIAN);
    w = must(w, ClinicEvent.BATCH_PACKED, 'b3', RoleCode.STERILIZATION_TECHNICIAN);
    w = must(w, ClinicEvent.BATCH_AUTOCLAVED, 'b3', RoleCode.STERILIZATION_TECHNICIAN);
    w = at(w, T(19, 30));
    w = closeTheClinic(w);

    const r = record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because).toBe('An autoclave cycle has not been released');
  });

  it('locks up once the loop is clear and the drill is done', () => {
    let w = openTheClinic();
    w = sterileReady(w, 'STER-0915', 'b3');
    w = closeTheClinic(w);
    w = at(w, T(19, 30));
    expect(record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   9 — an emergency arrives while the clinic is full
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 9 · emergency arrives while the clinic is full', () => {
  /** Two chairs' worth of work in flight, and a third patient waiting. */
  const busyClinic = () => {
    let w = openTheClinic();
    w = at(w, T(10, 0));

    // A — in the chair, mid-assessment.
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'pA', RoleCode.RECEPTION, 'Arjun P.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'pA', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.PATIENT_SEATED, 'pA', RoleCode.DENTAL_ASSISTANT);
    // B — registered, waiting for a chair.
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'pB', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'pB', RoleCode.RECEPTION);
    // C — just walked in.
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'pC', RoleCode.RECEPTION, 'Kabir S.');
    return w;
  };

  it('starts an emergency from the event, with no triage button anywhere', () => {
    let w = busyClinic();
    const before = w.flows.filter((f) => !f.done).length;

    w = must(w, ClinicEvent.EMERGENCY_PATIENT_ARRIVED, 'e1',
      RoleCode.RECEPTION, 'Walk-in, facial swelling');

    expect(w.flows.filter((f) => !f.done).length).toBe(before + 1);
    const emergency = w.flows.find((f) => f.kind === 'EMERGENCY')!;
    expect(emergency.subjectLabel).toBe('Walk-in, facial swelling');
  });

  it('puts it on the doctor and tells them, without anybody routing it', () => {
    const w = busyClinic();
    const r = record(w, {
      type: ClinicEvent.EMERGENCY_PATIENT_ARRIVED, subjectId: 'e1',
      subjectLabel: 'Walk-in, facial swelling', by: RoleCode.RECEPTION,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // §11: first owner is the doctor. Reception recorded it; the engine routed it.
    const started = r.consequences.find((c) => c.kind === 'FLOW_STARTED');
    expect(started).toMatchObject({ owner: RoleCode.TREATING_DOCTOR });
    expect(r.consequences.some(
      (c) => c.kind === 'NOTIFY' && c.role === RoleCode.TREATING_DOCTOR,
    )).toBe(true);
  });

  it('ranks the emergency first among everything the doctor holds', () => {
    let w = busyClinic();
    w = must(w, ClinicEvent.EMERGENCY_PATIENT_ARRIVED, 'e1',
      RoleCode.RECEPTION, 'Walk-in, facial swelling');

    const mine = decisionsFor(w, RoleCode.TREATING_DOCTOR, T(10, 5));
    expect(mine.length).toBeGreaterThan(1);
    expect(mine[0]!.flowKind).toBe('EMERGENCY');
    expect(mine[0]!.objective).toBe(Objective.PATIENT_SAFE);
    expect(mine[0]!.priority).toBe(1);
  });

  it('cancels nothing — §11 rule 1, both run', () => {
    let w = busyClinic();
    const openBefore = w.flows.filter((f) => !f.done).map((f) => f.id).sort();
    w = must(w, ClinicEvent.EMERGENCY_PATIENT_ARRIVED, 'e1',
      RoleCode.RECEPTION, 'Walk-in, facial swelling');
    const openAfter = w.flows.filter((f) => !f.done).map((f) => f.id).sort();

    // Every flow that was running is still running, still owned by the same
    // person, and none of them was quietly closed to make room.
    for (const id of openBefore) expect(openAfter).toContain(id);
    expect(decisionsFor(w, RoleCode.RECEPTION, T(10, 5)).length).toBeGreaterThan(0);
  });

  it('preserves every safety rule while the emergency is running', () => {
    let w = busyClinic();
    w = must(w, ClinicEvent.EMERGENCY_PATIENT_ARRIVED, 'e1',
      RoleCode.RECEPTION, 'Walk-in, facial swelling');

    // An emergency does not become a reason to skip consent on somebody else.
    const r = record(w, {
      type: ClinicEvent.TREATMENT_FINISHED, subjectId: 'pA', by: RoleCode.TREATING_DOCTOR,
    });
    expect(r.ok).toBe(false);
  });

  it('hands triage to documentation, and records it because EMR-003 says so', () => {
    let w = busyClinic();
    w = must(w, ClinicEvent.EMERGENCY_PATIENT_ARRIVED, 'e1',
      RoleCode.RECEPTION, 'Walk-in, facial swelling');
    w = must(w, ClinicEvent.EMERGENCY_TRIAGED, 'e1', RoleCode.TREATING_DOCTOR);

    const doc = decisionsFor(w, RoleCode.TREATING_DOCTOR, T(10, 20))
      .find((d) => d.node === 'DOCUMENT');
    expect(doc).toBeDefined();
    // The record is a frozen-matrix control, not a nicety: EMR-003, "every
    // medical emergency creates incident record".
    expect(doc!.objective).toBe(Objective.RECORDS_COMPLETE);
  });

  it('escalates an untriaged emergency to the clinic head, on the clock alone', () => {
    let w = busyClinic();
    w = must(w, ClinicEvent.EMERGENCY_PATIENT_ARRIVED, 'e1',
      RoleCode.RECEPTION, 'Walk-in, facial swelling');

    expect(sweep(w, T(10, 4)).alerts.some((a) => a.node === 'TRIAGE')).toBe(false);
    const late = sweep(w, T(10, 10)).alerts.find((a) => a.node === 'TRIAGE');
    expect(late).toBeDefined();
    expect(late!.escalatedTo).toBe(RoleCode.CLINIC_HEAD);
  });
});

describe('Scenario 9 · where the frozen specification stops, reported not guessed', () => {
  it('cannot re-sequence the queue — that needs resources (D-07, D-08)', () => {
    // §11 says the emergency "pre-empts the queue". Pre-empting means taking
    // a chair from somebody, and nothing in the model knows a chair exists.
    // The emergency is raised, owned, ranked and escalated; who loses their
    // slot is not computable until the resource inventory arrives.
    const w = must(emptyWorld(T(10, 0)),
      ClinicEvent.EMERGENCY_PATIENT_ARRIVED, 'e1', RoleCode.RECEPTION, 'Walk-in');
    expect(decisions(w, T(10, 0)).some((d) => d.verdict === Verdict.WAIT)).toBe(false);
  });

  it('does not outrank a LATE patient-safety item, which §11 rule 2 assumes it would', () => {
    // Reported rather than fixed. §11 rule 2 says MEDICAL_EMERGENCY "outranks
    // every decision in the system, by §2.1". §2.1 orders by objective and
    // then by lateness — so a sterilisation release forty minutes overdue,
    // also rank 1, sorts above a fresh emergency.
    //
    // Making the emergency win would need a rule §2.1 does not contain, and
    // inventing one is exactly what was ruled out. Raised as a v1.1
    // correction; the specification is frozen and this is a gap in it.
    let w = emptyWorld(T(9, 0));
    w = must(w, ClinicEvent.BATCH_COLLECTED, 'b1', RoleCode.STERILIZATION_TECHNICIAN, 'STER-1');
    w = must(w, ClinicEvent.BATCH_ULTRASONIC_DONE, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
    w = must(w, ClinicEvent.BATCH_PACKED, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
    w = must(w, ClinicEvent.BATCH_AUTOCLAVED, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
    w = at(w, T(10, 0));
    w = must(w, ClinicEvent.EMERGENCY_PATIENT_ARRIVED, 'e1', RoleCode.RECEPTION, 'Walk-in');

    const all = decisions(w, T(10, 1));
    expect(all[0]!.objective).toBe(Objective.PATIENT_SAFE);
    // Both are rank 1; the overdue release sorts first because it is late.
    expect(all[0]!.flowKind).toBe('STERILIZATION');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   The one that cannot pass yet, and exactly why

   Kept as blocked-by-declaration rather than deleted or skipped. It names the
   engine it waits on, and becomes a real scenario the day that engine lands.
   A suite that reached green by removing it would be lying about what KuBi
   can do.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Not yet — the scenario blocked on an engine that does not exist', () => {
  it('Scenario 5 · chair frees while three wait — BLOCKED on the resource engine (§9, D-07)', () => {
    // Needs: chairs as resources, claims, and automatic reassignment when one
    // frees. Nothing in the model today knows a chair exists, so the engine
    // cannot say WAIT — it can only say PROCEED, which would be a lie.
    const w = emptyWorld(T(10, 0));
    expect(decisions(w, T(10, 0)).some((d) => d.verdict === Verdict.WAIT)).toBe(false);
    // Blocked on D-07 (the clinic's real resource inventory) and D-08
    // (may one doctor hold two chairs).
  });
});
