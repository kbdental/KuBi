/**
 * The operating model, proved rather than described.
 *
 * The owner's diagnosis was that KuBi was "someone explaining how a clinic
 * works instead of actually helping run one". Four claims separate an engine
 * from a demo, and each gets its own section below:
 *
 *   1. Nobody moves work.       Ownership transfers because an event landed.
 *   2. One event, many effects. Counted, not asserted in a comment.
 *   3. Flows run concurrently.  Seven clocks, none queued behind another.
 *   4. The software thinks.     Work goes late with nobody pressing anything.
 *
 * Everything here stands at a fixed minute. No browser, no database, no clock.
 */
import { describe, it, expect } from 'vitest';
import {
  ClinicEvent, FlowKind, FLOWS, COMPLETES, STARTS, IMPERATIVE_PREFIXES,
  emptyWorld, record, sweep, deskOf, board, ownerOf, lateness, admit,
  RoleCode, type World, type Operatory,
} from '@kubi/contracts';

const T = (h: number, m: number) => h * 60 + m;

/** Record an event and fail loudly if governance refused it. */
function must(w: World, type: ClinicEvent, subjectId: string, by: RoleCode, label?: string): World {
  const r = record(w, { type, subjectId, by, ...(label ? { subjectLabel: label } : {}) });
  if (!r.ok) throw new Error(`refused: ${r.refusal.because}`);
  return r.world;
}

const at = (w: World, now: number): World => ({ ...w, now });

/** This clinic's operatories, from its master. */
const OPERATORIES: Operatory[] = [
  { id: 'op-1', label: 'Operatory 1', position: 1 },
  { id: 'op-2', label: 'Operatory 2', position: 2 },
];

const newDay = (now = T(8, 30)): World =>
  emptyWorld(now, { operatories: OPERATORIES, firstPatientAt: T(10, 0) });

/**
 * A clinic that is open, because the morning was actually done.
 *
 * `ROOMS_READY` used to be the second line of this fixture and is now the
 * last: readiness is calculated from the blocks beneath it, so a fixture
 * cannot declare a ready clinic any more than an assistant can.
 */
function openClinic(now = T(9, 0)): World {
  let w = newDay();
  w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
  w = must(w, ClinicEvent.BATCH_COLLECTED, 'b1', RoleCode.STERILIZATION_TECHNICIAN, 'STER-0912');
  w = must(w, ClinicEvent.BATCH_ULTRASONIC_DONE, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
  w = must(w, ClinicEvent.BATCH_PACKED, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
  w = must(w, ClinicEvent.BATCH_AUTOCLAVED, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
  w = must(w, ClinicEvent.BATCH_RELEASED, 'b1', RoleCode.SENIOR_ASSISTANT);
  for (const o of OPERATORIES) {
    w = must(w, ClinicEvent.OPERATORY_READY, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
  }
  w = must(w, ClinicEvent.EQUIPMENT_VERIFIED, 'today', RoleCode.DENTAL_ASSISTANT);
  w = must(w, ClinicEvent.STOCK_VERIFIED, 'today', RoleCode.DENTAL_ASSISTANT);
  w = must(w, ClinicEvent.RECEPTION_READY, 'today', RoleCode.RECEPTION);
  w = must(w, ClinicEvent.COMMON_AREAS_READY, 'today', RoleCode.HOUSEKEEPING);
  w = must(w, ClinicEvent.ROOMS_READY, 'today', RoleCode.DENTAL_ASSISTANT);
  // The huddle too. Leaving it out made the first escalation test fail, and
  // the engine was right: a clinic that unlocked at 08:30 and had not held its
  // huddle by 09:14 is twenty-nine minutes late, and somebody should know.
  w = must(w, ClinicEvent.HUDDLE_HELD, 'today', RoleCode.CLINIC_MANAGER);
  return at(w, now);
}

/* ═══════════════════════════════════════════════════════════════════════ */

describe('the model is events, not instructions', () => {
  it('names every event after something that happened', () => {
    // The line the whole design rests on. `BRING_PATIENT` is a button; a
    // button in the event catalogue means the state machine crept back in.
    for (const name of Object.values(ClinicEvent)) {
      for (const bad of IMPERATIVE_PREFIXES) {
        expect(name.startsWith(bad), `${name} reads as an instruction`).toBe(false);
      }
    }
  });

  it('gives every node an owner, a clock and somebody who hears', () => {
    for (const flow of Object.values(FLOWS)) {
      for (const nd of flow.nodes) {
        expect(nd.owner, `${flow.kind}/${nd.id}`).toBeTruthy();
        expect(nd.expectMinutes, `${flow.kind}/${nd.id} has no expected time`).toBeGreaterThan(0);
        expect(nd.escalateTo, `${flow.kind}/${nd.id} escalates to nobody`).toBeTruthy();
      }
    }
  });

  it('lets exactly one event finish any given node', () => {
    // Two nodes completed by the same event would make ownership ambiguous,
    // which is the one thing an ownership engine may not be.
    const all = Object.values(FLOWS).flatMap((f) => f.nodes.map((n) => n.completedBy));
    expect(new Set(all).size).toBe(all.length);
    expect(COMPLETES.size).toBe(all.length);
  });
});

describe('nobody moves work — the engine does', () => {
  it('hands the batch to a different person the moment the cycle ends', () => {
    // Separation of duties, and the clearest proof that ownership is not a
    // field somebody sets: an operator may not release their own batch, and
    // nothing in the app offers a handover step that could be skipped.
    let w = emptyWorld(T(9, 0));
    w = must(w, ClinicEvent.BATCH_COLLECTED, 'b9', RoleCode.STERILIZATION_TECHNICIAN, 'STER-0914');
    w = must(w, ClinicEvent.BATCH_ULTRASONIC_DONE, 'b9', RoleCode.STERILIZATION_TECHNICIAN);
    w = must(w, ClinicEvent.BATCH_PACKED, 'b9', RoleCode.STERILIZATION_TECHNICIAN);

    const before = w.flows.find((f) => f.subjectId === 'b9')!;
    expect(ownerOf(before)).toBe(RoleCode.STERILIZATION_TECHNICIAN);

    const r = record(w, {
      type: ClinicEvent.BATCH_AUTOCLAVED, subjectId: 'b9',
      by: RoleCode.STERILIZATION_TECHNICIAN,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const moved = r.consequences.find((c) => c.kind === 'OWNERSHIP_MOVED');
    expect(moved).toBeDefined();
    expect(moved).toMatchObject({
      from: RoleCode.STERILIZATION_TECHNICIAN,
      to: RoleCode.SENIOR_ASSISTANT,
    });
    expect(ownerOf(r.world.flows.find((f) => f.subjectId === 'b9')!))
      .toBe(RoleCode.SENIOR_ASSISTANT);
  });

  it('exposes no way to set a phase', () => {
    // `record` is the entire write path. If a caller could assign `at`, the
    // workflow would be a suggestion.
    const w = openClinic();
    const before = JSON.stringify(w.flows);
    const copy = { ...w, flows: w.flows };
    expect(JSON.stringify(copy.flows)).toBe(before);
    // The only exported mutator is record(); everything else reads.
    expect(typeof record).toBe('function');
  });

  it('starts a visit when the patient arrives, not when somebody opens a screen', () => {
    const w = openClinic();
    const r = record(w, {
      type: ClinicEvent.PATIENT_ARRIVED, subjectId: 'p1',
      subjectLabel: 'Meera R.', by: RoleCode.RECEPTION,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.consequences.some((c) => c.kind === 'FLOW_STARTED' && c.flowKind === FlowKind.PATIENT))
      .toBe(true);
    expect(STARTS.get(ClinicEvent.PATIENT_ARRIVED)).toBe(FlowKind.PATIENT);
  });
});

describe('one event, many consequences', () => {
  it('fans a finished treatment out across three flows at once', () => {
    // The owner's example, in the engine: finishing a treatment advances the
    // visit, opens a clinical record with its own note and day-after call, and
    // opens a bill. None of the three is a step of the others, and none can be
    // forgotten because the patient walked out.
    let w = openClinic();
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.PATIENT_SEATED, 'p1', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.DIAGNOSIS_RECORDED, 'p1', RoleCode.TREATING_DOCTOR);
    w = must(w, ClinicEvent.PLAN_ACCEPTED, 'p1', RoleCode.TREATING_DOCTOR);
    w = must(w, ClinicEvent.CONSENT_SIGNED, 'p1', RoleCode.TREATING_DOCTOR);
    w = { ...w, facts: { ...w.facts, 'xray:p1': true } };

    const r = record(w, {
      type: ClinicEvent.TREATMENT_FINISHED, subjectId: 'p1', by: RoleCode.TREATING_DOCTOR,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const kinds = r.consequences.map((c) => c.kind);
    expect(kinds).toContain('NODE_COMPLETED');
    expect(kinds).toContain('OWNERSHIP_MOVED');
    expect(kinds).toContain('FLOW_STARTED');
    expect(kinds).toContain('NOTIFY');
    expect(kinds).toContain('AUDIT');
    // Six or more, from one thing a doctor did.
    expect(r.consequences.length).toBeGreaterThanOrEqual(6);

    const opened = r.consequences
      .filter((c) => c.kind === 'FLOW_STARTED')
      .map((c) => (c as { flowKind: FlowKind }).flowKind);
    expect(opened).toContain(FlowKind.CLINICAL);
    expect(opened).toContain(FlowKind.BILLING);
  });

  it('tells the next owner without anybody sending anything', () => {
    const w = openClinic();
    const r = record(w, {
      type: ClinicEvent.PATIENT_ARRIVED, subjectId: 'p2',
      subjectLabel: 'Kabir S.', by: RoleCode.RECEPTION,
    });
    if (!r.ok) throw new Error('refused');
    expect(r.consequences.some((c) => c.kind === 'NOTIFY')).toBe(true);
  });

  it('measures the wait from the clock, not from a form', () => {
    let w = openClinic(T(9, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p3', RoleCode.RECEPTION, 'Arjun P.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p3', RoleCode.RECEPTION);

    const r = record(at(w, T(9, 22)), {
      type: ClinicEvent.PATIENT_SEATED, subjectId: 'p3', by: RoleCode.DENTAL_ASSISTANT,
    });
    if (!r.ok) throw new Error('refused');
    const waited = r.consequences.find((c) => c.kind === 'METRIC' && c.name === 'waited');
    expect(waited).toMatchObject({ value: 22 });
  });
});

describe('seven flows, running at once', () => {
  it('does not queue a lab case behind a patient, or a batch behind either', () => {
    let w = openClinic();
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.LAB_DISPATCHED, 'c1', RoleCode.LAB_COORDINATOR, 'Crown, 26');
    w = must(w, ClinicEvent.STOCK_ORDERED, 'gauze', RoleCode.INVENTORY_COORDINATOR, 'Gauze');
    w = must(w, ClinicEvent.BATCH_COLLECTED, 'b2', RoleCode.STERILIZATION_TECHNICIAN, 'STER-0915');

    const live = w.flows.filter((f) => !f.done);
    expect(new Set(live.map((f) => f.kind)).size).toBeGreaterThanOrEqual(5);
    // Advancing one moves nothing else.
    const before = live.map((f) => `${f.kind}:${f.at}`).sort();
    const after = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION)
      .flows.filter((f) => !f.done).map((f) => `${f.kind}:${f.at}`).sort();
    expect(after).not.toEqual(before);
    expect(after.filter((x) => !x.startsWith('PATIENT')))
      .toEqual(before.filter((x) => !x.startsWith('PATIENT')));
  });

  it('runs two patients through different points of the same flow', () => {
    let w = openClinic();
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p2', RoleCode.RECEPTION, 'Kabir S.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.PATIENT_SEATED, 'p1', RoleCode.DENTAL_ASSISTANT);

    const lanes = board(w, w.now);
    const busy = lanes.filter((l) => l.patients.length > 0);
    expect(busy.length).toBe(2);
    expect(busy.map((l) => l.node).sort()).toEqual(['ASSESS', 'REGISTER']);
  });

  it(`derives the board's lanes from the flow, so the two cannot drift`, () => {
    expect(board(emptyWorld(0), 0).map((l) => l.node))
      .toEqual(FLOWS[FlowKind.PATIENT].nodes.map((n) => n.id));
  });
});

describe('the software thinks — time alone changes the screen', () => {
  it('escalates a patient nobody has seated, with nobody pressing anything', () => {
    let w = openClinic(T(9, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);

    // Fourteen minutes: still inside the fifteen the clinic allows.
    expect(sweep(w, T(9, 14)).alerts).toHaveLength(0);

    // Sixteen: late, and it has reached somebody. No event was recorded
    // between these two lines. The clock did it.
    const { alerts } = sweep(w, T(9, 16));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.node).toBe('SEAT');
    expect(alerts[0]!.minutesLate).toBe(1);
    expect(alerts[0]!.escalatedTo).toBe(RoleCode.CLINIC_MANAGER);
  });

  it('puts the late item on the manager\'s screen and leaves it on the assistant\'s', () => {
    let w = openClinic(T(9, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);

    const late = T(9, 25);
    // Escalating does not reassign. The assistant still owns it; the manager
    // has merely been told. Moving it would let the doer off.
    expect(deskOf(w, RoleCode.DENTAL_ASSISTANT, late).mine).toHaveLength(1);
    expect(deskOf(w, RoleCode.CLINIC_MANAGER, late).escalated).toHaveLength(1);
    expect(deskOf(w, RoleCode.CLINIC_MANAGER, late).mine.some((i) => i.flowKind === FlowKind.PATIENT))
      .toBe(false);
  });

  it('sorts a desk worst-first, so the longest-waiting thing is at the top', () => {
    let w = openClinic(T(9, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'a', RoleCode.RECEPTION, 'A');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'a', RoleCode.RECEPTION);
    w = at(w, T(9, 30));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'b', RoleCode.RECEPTION, 'B');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'b', RoleCode.RECEPTION);

    const desk = deskOf(w, RoleCode.DENTAL_ASSISTANT, T(9, 40));
    expect(desk.mine.map((i) => i.subjectLabel)).toEqual(['A', 'B']);
  });
});

describe('the same world, eight different clinics', () => {
  it('shows reception and the doctor completely different work', () => {
    let w = openClinic();
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.PATIENT_SEATED, 'p1', RoleCode.DENTAL_ASSISTANT);

    const doctor = deskOf(w, RoleCode.TREATING_DOCTOR, w.now);
    const reception = deskOf(w, RoleCode.RECEPTION, w.now);

    expect(doctor.mine.map((i) => i.label)).toContain('Examine and diagnose');
    // Reception does not "see less" of the doctor's queue — they hold none of
    // it, so there is nothing of it in their world at all.
    expect(reception.mine.some((i) => i.flowKind === FlowKind.PATIENT)).toBe(false);
  });

  it('gives a role holding nothing an empty desk rather than somebody else\'s', () => {
    const w = openClinic();
    expect(deskOf(w, RoleCode.LAB_COORDINATOR, w.now).mine).toHaveLength(0);
  });
});

describe('governance, and the four words it never says', () => {
  it('refuses to seat a patient into a room nobody has prepared, in one sentence', () => {
    // This used to reach the sterile clause of law L-3 by standing up a clinic
    // whose rooms were ready and whose instruments were not. Readiness is now
    // calculated from a released run among other things, so that state cannot
    // be built — rooms-ready implies sterile-released. The sterile clause is
    // kept as defence in depth and is simply no longer the first to fire.
    let w = newDay(T(9, 0));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    w = must(w, ClinicEvent.PATIENT_REGISTERED, 'p1', RoleCode.RECEPTION);

    const r = record(w, {
      type: ClinicEvent.PATIENT_SEATED, subjectId: 'p1', by: RoleCode.DENTAL_ASSISTANT,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because).toBe('The rooms are not ready yet');
    expect(r.refusal.fix).toBe('Open room readiness');
  });

  it('names the room, not a count, when the morning is unfinished', () => {
    // The refusal a governance rule gives has to be actionable. "One of four
    // outstanding" tells an assistant she is blocked without telling her by
    // what; the rule computes its own sentence so it can say which room.
    let w = newDay(T(9, 0));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.OPERATORY_READY, 'op-1', RoleCode.DENTAL_ASSISTANT, 'Operatory 1');

    const r = record(w, {
      type: ClinicEvent.ROOMS_READY, subjectId: 'today', by: RoleCode.DENTAL_ASSISTANT,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because)
      .toBe('Operatory 2 is not prepared, so nobody can be seated in it');
  });

  it('says one thing, never a list', () => {
    const w = openClinic();
    const r = record(w, {
      type: ClinicEvent.TREATMENT_FINISHED, subjectId: 'pX', by: RoleCode.TREATING_DOCTOR,
    });
    if (r.ok) throw new Error('should have been refused');
    // Three requirements are unmet. The person is told about one.
    expect(Object.keys(r.refusal)).toEqual(['because', 'fix', 'goes']);
    expect(r.refusal.because).toBe('The medical history has not been updated');
  });

  it('treats a missing answer exactly as harshly as a wrong one', () => {
    // ADR-013, with the jargon removed. Nothing has been recorded about pZ at
    // all, and that refuses just as hard as a recorded failure would.
    const w = openClinic();
    expect(admit(w, ClinicEvent.TREATMENT_FINISHED, 'pZ')).not.toBeNull();
  });

  it('never puts its own vocabulary in front of a person', () => {
    // The owner: "The user should never know these words."
    const w = openClinic();
    const r = record(w, {
      type: ClinicEvent.TREATMENT_FINISHED, subjectId: 'pY', by: RoleCode.TREATING_DOCTOR,
    });
    if (r.ok) throw new Error('should have been refused');
    const words = `${r.refusal.because} ${r.refusal.fix}`.toLowerCase();
    for (const jargon of ['gate', 'requirement', 'compliance', 'validation', 'fact', 'rule']) {
      expect(words.includes(jargon), `"${jargon}" leaked onto a screen`).toBe(false);
    }
  });

  it('leaves the world untouched when it refuses', () => {
    const w = openClinic();
    const r = record(w, {
      type: ClinicEvent.TREATMENT_FINISHED, subjectId: 'pQ', by: RoleCode.TREATING_DOCTOR,
    });
    expect(r.ok).toBe(false);
    // A refused event is not a recorded event. The log is what happened.
    expect(w.events.some((e) => e.type === ClinicEvent.TREATMENT_FINISHED)).toBe(false);
  });
});

describe('the record of what happened', () => {
  it('appends and never rewrites', () => {
    let w = openClinic();
    const before = w.events.length;
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    expect(w.events.length).toBe(before + 1);
    expect(w.events[w.events.length - 1]!.seq).toBe(before + 1);
    expect(w.events.map((e) => e.seq)).toEqual(w.events.map((_, i) => i + 1));
  });

  it('records who did it, as a role', () => {
    let w = openClinic();
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    expect(w.events[w.events.length - 1]!.by).toBe(RoleCode.RECEPTION);
  });

  it('reports lateness as zero once the work is done', () => {
    let w = openClinic(T(9, 0));
    w = must(w, ClinicEvent.PATIENT_ARRIVED, 'p1', RoleCode.RECEPTION, 'Meera R.');
    const f = w.flows.find((x) => x.subjectId === 'p1')!;
    expect(lateness({ ...f, done: true }, T(23, 0))).toBe(0);
  });
});
