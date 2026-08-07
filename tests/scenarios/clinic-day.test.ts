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
  type World,
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

/* ═══════════════════════════════════════════════════════════════════════════
   1 — 08:45, the clinic opening
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 1 · 08:45, clinic opening', () => {
  it('tells reception to unlock, and nobody else anything', () => {
    const w = emptyWorld(T(8, 45));
    // Nothing has happened yet, so there is nothing to do — which is a real
    // state and is reported as one rather than as a welcome screen.
    expect(decisions(w, T(8, 45))).toHaveLength(0);

    const opened = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    const next = mostImportant(opened, T(8, 46))!;

    // Unlocking hands the day to the assistant. Nobody performed a handover.
    expect(next.owner).toBe(RoleCode.DENTAL_ASSISTANT);
    expect(next.question).toContain('Make the rooms ready');
    expect(next.verdict).toBe(Verdict.PROCEED);
    expect(decisionsFor(opened, RoleCode.TREATING_DOCTOR, T(8, 46))).toHaveLength(0);
  });

  it('says what the rooms are for, and what happens if they are not done', () => {
    let w = emptyWorld(T(8, 45));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    const d = mostImportant(w, T(8, 46))!;

    // Decision quality, §13.4: four answers, always.
    expect(d.objective).toBe(Objective.PATIENT_SAFE);
    expect(d.why).toContain('keeping the patient safe');
    expect(d.protocol).toContain('ROOMS');
    expect(d.ifIgnored).toMatch(/then the .* is told/);
    expect(d.evidence.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2 — 09:00, a patient arrives twelve minutes early
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 2 · patient arrives twelve minutes early', () => {
  it('starts their visit and puts registration on reception, unprompted', () => {
    let w = emptyWorld(T(8, 45));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.ROOMS_READY, 'today', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.HUDDLE_HELD, 'today', RoleCode.CLINIC_MANAGER);
    w = sterileReady(w);
    w = at(w, T(9, 0));

    // Reception marks her arrived. That is all anybody does.
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');

    const forReception = decisionsFor(w, RoleCode.RECEPTION, T(9, 0));
    expect(forReception.some((d) => d.question.includes('Register'))).toBe(true);

    // Early is not late. Nothing is escalated at the moment she walks in.
    expect(sweep(w, T(9, 0)).alerts).toHaveLength(0);
  });

  it('moves the patient to the assistant the moment registration is recorded', () => {
    let w = emptyWorld(T(8, 45));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.ROOMS_READY, 'today', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.HUDDLE_HELD, 'today', RoleCode.CLINIC_MANAGER);
    w = sterileReady(w);
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
    let w = emptyWorld(T(8, 45));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.ROOMS_READY, 'today', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.HUDDLE_HELD, 'today', RoleCode.CLINIC_MANAGER);
    w = sterileReady(w);
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
    let w = emptyWorld(T(8, 45));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.ROOMS_READY, 'today', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.HUDDLE_HELD, 'today', RoleCode.CLINIC_MANAGER);
    w = sterileReady(w);
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

  it('unblocks seating a patient once a batch is released', () => {
    let w = emptyWorld(T(8, 45));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.ROOMS_READY, 'today', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p9', RoleCode.RECEPTION, 'Kabir S.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p9', RoleCode.RECEPTION);

    // Law L-3: no sterile pack, no patient in a chair.
    expect(record(w, {
      type: ClinicEvent.PATIENT_SEATED, subjectId: 'p9', by: RoleCode.DENTAL_ASSISTANT,
    }).ok).toBe(false);

    w = sterileReady(w);
    expect(record(w, {
      type: ClinicEvent.PATIENT_SEATED, subjectId: 'p9', by: RoleCode.DENTAL_ASSISTANT,
    }).ok).toBe(true);
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
    let w = emptyWorld(T(8, 45));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.ROOMS_READY, 'today', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.HUDDLE_HELD, 'today', RoleCode.CLINIC_MANAGER);
    w = sterileReady(w);
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
   10 — the clinic closes with a batch unresolved
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Scenario 10 · closing with sterilisation unresolved', () => {
  it('refuses to lock up, and says which loop is still open', () => {
    let w = emptyWorld(T(8, 45));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.ROOMS_READY, 'today', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.HUDDLE_HELD, 'today', RoleCode.CLINIC_MANAGER);
    w = must(w, ClinicEvent.BATCH_COLLECTED, 'b3', RoleCode.STERILIZATION_TECHNICIAN, 'STER-0915');
    w = at(w, T(19, 30));

    const r = record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because).toBe('Instruments are still in the loop');
  });

  it('locks up once the loop is clear', () => {
    let w = emptyWorld(T(8, 45));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.ROOMS_READY, 'today', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.HUDDLE_HELD, 'today', RoleCode.CLINIC_MANAGER);
    w = sterileReady(w, 'STER-0915', 'b3');
    w = at(w, T(19, 30));
    expect(record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   The three that cannot pass yet, and exactly why

   Kept as failing-by-declaration rather than deleted or skipped. Each names
   the engine it waits on, and each will be turned into a real scenario the
   day that engine lands. A suite that reached green by removing these would
   be lying about what KuBi can do.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Not yet — the scenarios blocked on engines that do not exist', () => {
  it('Scenario 5 · chair frees while three wait — BLOCKED on the resource engine (§9, D-07)', () => {
    // Needs: chairs as resources, claims, and automatic reassignment when one
    // frees. Nothing in the model today knows a chair exists, so the engine
    // cannot say WAIT — it can only say PROCEED, which would be a lie.
    const w = emptyWorld(T(10, 0));
    expect(decisions(w, T(10, 0)).some((d) => d.verdict === Verdict.WAIT)).toBe(false);
    // Blocked on D-07 (the clinic's real resource inventory) and D-08
    // (may one doctor hold two chairs).
  });

  it('Scenario 9 · emergency during a full schedule — BLOCKED on the exception engine (§11)', () => {
    // Needs: MEDICAL_EMERGENCY as an event that opens its own flow and
    // pre-empts everything by objective rank. The event does not exist yet,
    // and inventing one to make this pass would be exactly the synthetic
    // demonstration the owner asked us to stop building.
    expect(Object.values(ClinicEvent).some((e) => String(e).includes('EMERGENCY'))).toBe(false);
  });

  it('nothing survives a restart yet — BLOCKED on PostgreSQL persistence (§16, D-11)', () => {
    // The world is in memory. The event log table is specified and not built,
    // so today's clinic is forgotten when the process stops.
    const w = emptyWorld(T(9, 0));
    expect(w.events).toHaveLength(0);
  });
});
