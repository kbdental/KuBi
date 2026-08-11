/**
 * Clinic readiness, against the owner's actual opening procedure.
 *
 * The claim under test is the one line the activity matrix insists on:
 * *"The staff should not manually tick 'Clinic Ready.' KuBi calculates it."*
 * Everything below is an attempt to make the clinic say it is ready when it
 * is not.
 */
import { describe, it, expect } from 'vitest';
import {
  ClinicEvent, RoleCode, Verdict, decisionsFor, emptyWorld, record, readiness, whyNotReady,
  OPERATORY_MINUTES, HOUSEKEEPING_MINUTES, STERILIZATION_MINUTES, READINESS_MINUTES,
  OPENING_CONTROLS, UNCOVERED_OPENING_CONTROLS,
  type Operatory, type World,
} from '@kubi/contracts';

const T = (h: number, m: number) => h * 60 + m;

/** This clinic has four. The number lives here and nowhere in the code. */
const FOUR: Operatory[] = [
  { id: 'op-1', label: 'Operatory 1', position: 1 },
  { id: 'op-2', label: 'Operatory 2', position: 2 },
  { id: 'op-3', label: 'Operatory 3', position: 3 },
  { id: 'op-4', label: 'Operatory 4', position: 4 },
];

const FIRST_PATIENT = T(10, 0);

const world = (ops: Operatory[] = FOUR, now = T(9, 0)): World =>
  emptyWorld(now, { operatories: ops, firstPatientAt: FIRST_PATIENT });

function must(w: World, type: ClinicEvent, id: string, by: RoleCode, label?: string): World {
  const r = record(w, { type, subjectId: id, by, ...(label ? { subjectLabel: label } : {}) });
  if (!r.ok) throw new Error(`the clinic refused "${type}": ${r.refusal.because}`);
  return r.world;
}

const at = (w: World, now: number): World => ({ ...w, now });

/** Instruments through the loop, which is one of the readiness blocks. */
function sterilise(w: World): World {
  let x = must(w, ClinicEvent.BATCH_COLLECTED, 'b1', RoleCode.STERILIZATION_TECHNICIAN, 'STER-1');
  x = must(x, ClinicEvent.BATCH_ULTRASONIC_DONE, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
  x = must(x, ClinicEvent.BATCH_PACKED, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
  x = must(x, ClinicEvent.BATCH_AUTOCLAVED, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
  return must(x, ClinicEvent.BATCH_RELEASED, 'b1', RoleCode.SENIOR_ASSISTANT);
}

/** The whole morning, done properly. */
function fullMorning(ops: Operatory[] = FOUR): World {
  let w = world(ops, T(8, 30));
  w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
  for (const o of ops) {
    w = must(w, ClinicEvent.OPERATORY_READY, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
  }
  w = sterilise(w);
  w = must(w, ClinicEvent.EQUIPMENT_VERIFIED, 'today', RoleCode.SENIOR_ASSISTANT);
    w = must(w, ClinicEvent.RECEPTION_READY, 'today', RoleCode.RECEPTION);
  w = must(w, ClinicEvent.COMMON_AREAS_READY, 'today', RoleCode.HOUSEKEEPING);
  // OPEN-012 — the emergency kit, mandatory since it got a block.
  return must(w, ClinicEvent.EMERGENCY_CHECKED, 'e1#DENTAL_ASSISTANT',
    RoleCode.DENTAL_ASSISTANT);
}

const read = (w: World) => readiness(w.events, w.operatories, w.firstPatientAt, w.now);

/* ═══════════════════════════════════════════════════════════════════════ */

describe('the morning is built from the master, not from a constant', () => {
  it('makes one block per operatory the clinic actually has', () => {
    const four = read(world(FOUR)).blocks.filter((b) => b.id.startsWith('OPERATORY:'));
    expect(four).toHaveLength(4);
    expect(four.map((b) => b.label)).toEqual([
      'Prepare Operatory 1', 'Prepare Operatory 2',
      'Prepare Operatory 3', 'Prepare Operatory 4',
    ]);
  });

  it('grows to six the day the clinic builds two more, with no code change', () => {
    const six = [...FOUR,
      { id: 'op-5', label: 'Operatory 5', position: 5 },
      { id: 'op-6', label: 'Operatory 6', position: 6 }];
    expect(read(world(six)).blocks.filter((b) => b.id.startsWith('OPERATORY:'))).toHaveLength(6);
  });

  it('reads in corridor order however the master is stored', () => {
    const shuffled = [FOUR[2]!, FOUR[0]!, FOUR[3]!, FOUR[1]!];
    const labels = read(world(shuffled)).blocks
      .filter((b) => b.id.startsWith('OPERATORY:')).map((b) => b.label);
    expect(labels).toEqual([
      'Prepare Operatory 1', 'Prepare Operatory 2',
      'Prepare Operatory 3', 'Prepare Operatory 4',
    ]);
  });

  it('carries the owner’s fifteen minutes, and refuses to invent the others', () => {
    const r = read(world());
    const room = r.blocks.find((b) => b.id === 'OPERATORY:op-1')!;
    expect(room.expectMinutes).toBe(OPERATORY_MINUTES);
    expect(room.expectMinutes).toBe(15);

    // The owner's other two measured figures.
    expect(r.blocks.find((b) => b.id === 'COMMON_AREAS')!.expectMinutes)
      .toBe(HOUSEKEEPING_MINUTES);
    expect(r.blocks.find((b) => b.id === 'STERILE')!.expectMinutes)
      .toBe(STERILIZATION_MINUTES);

    // No separate figure, which is not the same as unknown: the equipment
    // round and the waiting area "happen in that 50 min" — inside the
    // whole-morning window rather than on a clock of their own — and the
    // stock check is done as required rather than to a duration.
    for (const id of ['EQUIPMENT', 'STOCK', 'RECEPTION']) {
      expect(r.blocks.find((b) => b.id === id)!.expectMinutes, id).toBeNull();
    }
  });
});

describe('an unconfigured clinic is not a ready clinic', () => {
  it('refuses to call an empty master ready', () => {
    // The trap this guards: zero blocks outstanding because there are zero
    // blocks. UNKNOWN is never PASS, applied to master data.
    const r = read(world([]));
    expect(r.outstanding.filter((b) => b.id.startsWith('OPERATORY:'))).toHaveLength(0);
    expect(r.ready).toBe(false);
    expect(r.unconfigured).toContain('No operatory has been set up for this clinic');
  });

  it('says so as the reason, rather than blaming a block', () => {
    expect(whyNotReady(read(world([])))).toBe('No operatory has been set up for this clinic');
  });
});

describe('readiness is calculated, and cannot be asserted', () => {
  it('refuses ROOMS_READY while one operatory of four is outstanding', () => {
    let w = world(FOUR, T(9, 0));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    for (const o of [FOUR[0]!, FOUR[1]!, FOUR[2]!]) {
      w = must(w, ClinicEvent.OPERATORY_READY, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
    }
    w = sterilise(w);
    w = must(w, ClinicEvent.EQUIPMENT_VERIFIED, 'today', RoleCode.SENIOR_ASSISTANT);
        w = must(w, ClinicEvent.RECEPTION_READY, 'today', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.COMMON_AREAS_READY, 'today', RoleCode.HOUSEKEEPING);

    const r = record(w, {
      type: ClinicEvent.ROOMS_READY, subjectId: 'today', by: RoleCode.DENTAL_ASSISTANT,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // Names the room. "One item outstanding" would tell her she is blocked
    // without telling her by what.
    expect(r.refusal.because).toBe('Operatory 4 is not prepared, so nobody can be seated in it');
  });

  it('names the sterilisation run when that is what is missing', () => {
    let w = world(FOUR, T(9, 0));
    for (const o of FOUR) {
      w = must(w, ClinicEvent.OPERATORY_READY, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
    }
    w = must(w, ClinicEvent.EQUIPMENT_VERIFIED, 'today', RoleCode.SENIOR_ASSISTANT);
        w = must(w, ClinicEvent.RECEPTION_READY, 'today', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.COMMON_AREAS_READY, 'today', RoleCode.HOUSEKEEPING);

    expect(whyNotReady(read(w)))
      .toBe('There are no sterile packs in the cabinets for today');
  });

  it('admits ROOMS_READY once — and only once — the whole morning is done', () => {
    const w = fullMorning();
    expect(read(w).ready).toBe(true);
    const r = record(w, {
      type: ClinicEvent.ROOMS_READY, subjectId: 'today', by: RoleCode.DENTAL_ASSISTANT,
    });
    expect(r.ok).toBe(true);
  });

  it('cannot be talked into readiness by an empty master', () => {
    // Preparing nothing, in a clinic configured with nothing, must not pass.
    const w = must(world([], T(9, 0)),
      ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    const r = record(w, {
      type: ClinicEvent.ROOMS_READY, subjectId: 'today', by: RoleCode.DENTAL_ASSISTANT,
    });
    expect(r.ok).toBe(false);
  });
});

describe('who owns which part of the morning', () => {
  it('puts the rooms on the dental assistant, and the stock check with her', () => {
    const r = read(world());
    const hers = r.blocks.filter((b) => b.owner === RoleCode.DENTAL_ASSISTANT).map((b) => b.id);
    // The emergency kit is hers too — the matrix names the Doer as Assistant.
    // The doctor's countersignature is a separate fact and not a block.
    expect(hers).toEqual([
      'OPERATORY:op-1', 'OPERATORY:op-2', 'OPERATORY:op-3', 'OPERATORY:op-4',
      'EMERGENCY', 'STOCK',
    ]);
  });

  it('gives the equipment round to the head assistant, not to any assistant', () => {
    // "Equipment round is to be done by head dental nurse or Head dental
    // assistant" — narrower than the earlier instruction, and the one block a
    // dental assistant may not report. Still one task and not four, because
    // the trolley moves between rooms.
    const r = read(world());
    expect(r.blocks.filter((b) => b.id === 'EQUIPMENT')).toHaveLength(1);
    expect(r.blocks.find((b) => b.id === 'EQUIPMENT')!.owner)
      .toBe(RoleCode.SENIOR_ASSISTANT);
  });

  it('gives the floors and shared areas to housekeeping, and the front to reception', () => {
    const r = read(world());
    expect(r.blocks.find((b) => b.id === 'COMMON_AREAS')!.owner).toBe(RoleCode.HOUSEKEEPING);
    expect(r.blocks.find((b) => b.id === 'RECEPTION')!.owner).toBe(RoleCode.RECEPTION);
    expect(r.blocks.find((b) => b.id === 'STERILE')!.owner)
      .toBe(RoleCode.STERILIZATION_TECHNICIAN);
  });
});

describe('the owner’s two readiness measures', () => {
  it('reports first-patient readiness against target, early as a negative', () => {
    // Ready at 09:40 for a ten o'clock patient: twenty minutes in hand.
    let w = fullMorning();
    w = at(w, T(9, 40));
    const r = read({ ...w, events: w.events.map((e) => ({ ...e, at: T(9, 40) })) });
    expect(r.ready).toBe(true);
    expect(r.readyAt).toBe(T(9, 40));
    expect(r.targetAt).toBe(T(10, 0));
    expect(r.varianceMinutes).toBe(-20);
  });

  it('reports a late morning as a positive variance', () => {
    const w = fullMorning();
    const r = read({ ...w, events: w.events.map((e) => ({ ...e, at: T(10, 12) })) });
    expect(r.varianceMinutes).toBe(12);
  });

  it('has no variance to report while the clinic is not ready', () => {
    // Not zero. Zero would read as "exactly on target", which is a different
    // morning from one that has not finished.
    const r = read(world());
    expect(r.readyAt).toBeNull();
    expect(r.varianceMinutes).toBeNull();
  });

  it('counts opening-checklist compliance over the blocks that gate the door', () => {
    let w = world(FOUR, T(9, 0));
    expect(read(w).compliance).toBe(0);
    for (const o of FOUR) {
      w = must(w, ClinicEvent.OPERATORY_READY, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
    }
    // Ten blocks listed; nine of them mandatory. Compliance is four of the
    // nine — the stock check is real work and is not part of "may the clinic
    // open", so counting it would make a complete morning read as 90%.
    expect(read(w).blocks).toHaveLength(10);
    expect(read(w).compliance).toBe(4 / 9);
    expect(read(fullMorning()).compliance).toBe(1);
  });

  it('calls the morning overdue once the first patient is due and it is not ready', () => {
    const w = world(FOUR, T(9, 55));
    expect(read(w).overdue).toBe(false);
    expect(read(w).minutesToTarget).toBe(5);

    const late = world(FOUR, T(10, 5));
    expect(read(late).overdue).toBe(true);
    expect(read(late).minutesToTarget).toBe(-5);
  });

  it('is not overdue when the work is done, however late the hour', () => {
    const w = at(fullMorning(), T(11, 0));
    expect(read(w).overdue).toBe(false);
  });
});

describe('the morning has two paths, and the longer one decides the start', () => {
  /**
   * The owner's numbers: *"total time for clinic readiness should be put as 45
   * to 50 min that should include all tasks leaving the sterilization cycle
   * which takes 1 hour 15 minutes uptill cooling in an autoclave."*
   *
   * So the clinic is not ready fifty minutes after somebody unlocks the door —
   * it is ready when the autoclave has cooled, and the start time has to be
   * worked back from that.
   */
  it('works back from the sterilisation cycle while the run is outstanding', () => {
    const r = read(world(FOUR, T(8, 0)));
    // Ten o'clock patient, seventy-five minute cycle.
    expect(r.startBy).toBe(T(8, 45));
    expect(r.startDrivenBy).toBe('the sterilisation cycle');
  });

  it('works back from the rest of the morning once the packs are out', () => {
    let w = world(FOUR, T(8, 0));
    w = sterilise(w);
    const r = read(w);
    // Fifty minutes of work left, so there is more room than there was.
    expect(r.startBy).toBe(T(9, 10));
    expect(r.startDrivenBy).toBe('the rest of the morning');
  });

  it('does not add the blocks up — more than one person is working', () => {
    // Four rooms at fifteen minutes is sixty minutes of work inside a fifty
    // minute morning. Summing them would push the start time a quarter of an
    // hour earlier than the clinic needs and make every morning look late.
    expect(READINESS_MINUTES).toBe(50);
    expect(FOUR.length * OPERATORY_MINUTES).toBeGreaterThan(READINESS_MINUTES);
  });

  it('has no start time to give when nobody is booked', () => {
    const r = readiness([], FOUR, null, T(8, 0));
    expect(r.startBy).toBeNull();
    expect(r.startDrivenBy).toBeNull();
  });
});

describe('work that is listed but does not hold the door', () => {
  /** *"Inventory is just checked as per requirement."* */
  it('keeps the stock check out of what is stopping the clinic opening', () => {
    const w = fullMorning();          // everything except the stock check
    const r = read(w);
    expect(r.ready).toBe(true);
    expect(r.outstanding).toHaveLength(0);
    // Still real, still listed, still somebody's job.
    expect(r.advisory.map((b) => b.id)).toEqual(['STOCK']);
  });

  it('lets the clinic open with the stock uncounted', () => {
    expect(record(fullMorning(), {
      type: ClinicEvent.ROOMS_READY, subjectId: 'today', by: RoleCode.DENTAL_ASSISTANT,
    }).ok).toBe(true);
  });

  it('never names it as the reason the clinic is not ready', () => {
    let w = world(FOUR, T(9, 0));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    // Nothing done at all: the first thing said must be a room, never stock.
    expect(whyNotReady(read(w))).not.toContain('Stock');
  });
});

describe('only the person whose job it is may report it done', () => {
  /**
   * Found by driving a real morning over HTTP rather than by reading the code:
   * the dental assistant recorded housekeeping's floors and the clinic said
   * yes, because nothing had ever compared the recording role against the role
   * that owns the work. A readiness report is somebody's word that they did a
   * thing — taken from the wrong person it is worth nothing.
   */
  const opened = () => must(world(FOUR, T(8, 45)),
    ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');

  it('refuses a dental assistant doing the head assistant’s equipment round', () => {
    // The one block narrowed by the owner after the first pass: "Equipment
    // round is to be done by head dental nurse or Head dental assistant".
    const r = record(opened(), {
      type: ClinicEvent.EQUIPMENT_VERIFIED, subjectId: 'today',
      by: RoleCode.DENTAL_ASSISTANT,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because).toBe('The equipment round is not your part of the morning');
    // And the head assistant may.
    expect(record(opened(), {
      type: ClinicEvent.EQUIPMENT_VERIFIED, subjectId: 'today',
      by: RoleCode.SENIOR_ASSISTANT,
    }).ok).toBe(true);
  });

  it('refuses the assistant reporting housekeeping’s floors', () => {
    const r = record(opened(), {
      type: ClinicEvent.COMMON_AREAS_READY, subjectId: 'today',
      by: RoleCode.DENTAL_ASSISTANT,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because)
      .toBe('Cleaning the floors and shared areas is not your part of the morning');
  });

  it('refuses housekeeping reporting a prepared operatory', () => {
    expect(record(opened(), {
      type: ClinicEvent.OPERATORY_READY, subjectId: 'op-1', by: RoleCode.HOUSEKEEPING,
    }).ok).toBe(false);
  });

  it('refuses the assistant readying the waiting area', () => {
    expect(record(opened(), {
      type: ClinicEvent.RECEPTION_READY, subjectId: 'today', by: RoleCode.DENTAL_ASSISTANT,
    }).ok).toBe(false);
  });

  it('lets a senior assistant do an assistant’s morning', () => {
    // The same act, done by somebody senior. This is the one widening, and it
    // deliberately does not extend to releasing a batch — that stays a
    // separation-of-duties gate held by the shape of the sterilisation flow.
    expect(record(opened(), {
      type: ClinicEvent.OPERATORY_READY, subjectId: 'op-1', by: RoleCode.SENIOR_ASSISTANT,
    }).ok).toBe(true);
  });

  it('does not make a person’s own work look blocked to them', () => {
    // `decisions()` asks "could this be recorded?" about work that already has
    // an owner. If ownership were checked there too, every readiness item would
    // read BLOCKED on the list of the very person who owns it.
    const mineNow = decisionsFor(opened(), RoleCode.HOUSEKEEPING, T(8, 46));
    expect(mineNow).toHaveLength(1);
    expect(mineNow[0]!.verdict).toBe(Verdict.PROCEED);
  });
});

describe('a day with nobody booked has no deadline, and says so', () => {
  /**
   * The working agreement, in the design principle: *"Never imply a state you
   * do not have — … absent appointment data is not a guessed first-patient
   * time."* This was found live: the target read 12:00 in a clinic whose last
   * appointment was ten days old, because the world carried a default hour.
   * A made-up deadline is worse than no deadline — it reports a variance
   * against a time nobody agreed to.
   */
  const noSchedule = (now: number) =>
    emptyWorld(now, { operatories: FOUR });   // firstPatientAt deliberately unset

  it('reports no target rather than a plausible-looking hour', () => {
    const r = read(noSchedule(T(9, 0)));
    expect(r.targetAt).toBeNull();
    expect(r.minutesToTarget).toBeNull();
  });

  it('is never overdue against a deadline that does not exist', () => {
    // Late in the day, morning untouched, and still not "overdue" — because
    // overdue against what?
    expect(read(noSchedule(T(18, 0))).overdue).toBe(false);
  });

  it('reports no variance even once the clinic is ready', () => {
    let w = noSchedule(T(8, 30));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    for (const o of FOUR) {
      w = must(w, ClinicEvent.OPERATORY_READY, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
    }
    w = sterilise(w);
    w = must(w, ClinicEvent.EQUIPMENT_VERIFIED, 'today', RoleCode.SENIOR_ASSISTANT);
        w = must(w, ClinicEvent.RECEPTION_READY, 'today', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.COMMON_AREAS_READY, 'today', RoleCode.HOUSEKEEPING);
    w = must(w, ClinicEvent.EMERGENCY_CHECKED, 'e1#DENTAL_ASSISTANT',
      RoleCode.DENTAL_ASSISTANT);

    const r = read(w);
    expect(r.ready).toBe(true);
    expect(r.readyAt).not.toBeNull();      // we know when it became ready
    expect(r.varianceMinutes).toBeNull();  // we do not know what it was due by
  });

  it('still lets the clinic be declared ready — no schedule is not a blocker', () => {
    // The gate is about the work, not about the diary.
    let w = noSchedule(T(8, 30));
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    for (const o of FOUR) {
      w = must(w, ClinicEvent.OPERATORY_READY, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
    }
    w = sterilise(w);
    w = must(w, ClinicEvent.EQUIPMENT_VERIFIED, 'today', RoleCode.SENIOR_ASSISTANT);
        w = must(w, ClinicEvent.RECEPTION_READY, 'today', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.COMMON_AREAS_READY, 'today', RoleCode.HOUSEKEEPING);
    w = must(w, ClinicEvent.EMERGENCY_CHECKED, 'e1#DENTAL_ASSISTANT',
      RoleCode.DENTAL_ASSISTANT);
    expect(record(w, {
      type: ClinicEvent.ROOMS_READY, subjectId: 'today', by: RoleCode.DENTAL_ASSISTANT,
    }).ok).toBe(true);
  });
});

describe('staff entry is reported, and honestly labelled', () => {
  it('counts people through the hygiene protocol', () => {
    let w = world();
    w = must(w, ClinicEvent.STAFF_READY, 'emp-priya', RoleCode.DENTAL_ASSISTANT, 'Priya');
    w = must(w, ClinicEvent.STAFF_READY, 'emp-kavita', RoleCode.RECEPTION, 'Kavita');
    // The same person twice is one person.
    w = must(w, ClinicEvent.STAFF_READY, 'emp-priya', RoleCode.DENTAL_ASSISTANT, 'Priya');
    expect(read(w).staffEntered).toBe(2);
  });

  it('does not pretend to gate on it', () => {
    // §1 gates each *person*, and an event carries the role that recorded it
    // rather than the individual. Counting is honest; refusing would not be,
    // because the model cannot yet tell two assistants apart. Recorded as a
    // known limit rather than quietly enforced on a role.
    const w = fullMorning();
    expect(read(w).staffEntered).toBe(0);
    expect(read(w).ready).toBe(true);
  });
});

describe('every one of the matrix’s thirteen opening controls is accounted for', () => {
  /**
   * The evening has had this table since it was built; the morning never did,
   * so the morning's gaps were a paragraph in a document rather than something
   * a test could fail on. This is the mirror.
   */
  const ids = Object.keys(OPENING_CONTROLS);

  it('covers OPEN-001 through OPEN-013 and invents no others', () => {
    expect(ids).toEqual(Array.from({ length: 13 },
      (_, i) => `OPEN-${String(i + 1).padStart(3, '0')}`));
  });

  it('points every covered control at a block that actually exists', () => {
    const blocks = new Set(read(world()).blocks.map((b) =>
      b.id.startsWith('OPERATORY:') ? 'OPERATORY' : b.id));
    for (const [id, { covers }] of Object.entries(OPENING_CONTROLS)) {
      // OPEN-013 is the exception, and deliberately so: the matrix gives its
      // doer as "System" and its evidence as "Auto". It points at no block
      // because it *is* the calculation over the blocks.
      if (covers === null || covers === 'DERIVED') continue;
      expect(blocks, `${id} points at "${covers}", which is not a readiness block`)
        .toContain(covers);
    }
  });

  it('leaves exactly one control with no doer, and it is the derived one', () => {
    const derived = Object.entries(OPENING_CONTROLS)
      .filter(([, v]) => v.covers === 'DERIVED').map(([id]) => id);
    expect(derived).toEqual(['OPEN-013']);
  });

  it('gives every control a reason, so none is covered by assertion alone', () => {
    for (const [id, { why }] of Object.entries(OPENING_CONTROLS)) {
      expect(why.length, `${id} has no reason`).toBeGreaterThan(20);
    }
  });

  it('names the six nothing covers, rather than quietly dropping them', () => {
    // All six are one thing wearing six matrix rows: opening the building.
    // Neither source document has that section — the closing drill switches
    // all of it off in the evening, and the opening procedure begins with
    // people already inside a working building. The clinic plainly does it;
    // KuBi has no block for it and nobody has said whose job it is.
    expect(UNCOVERED_OPENING_CONTROLS).toEqual([
      'OPEN-001', 'OPEN-007', 'OPEN-008', 'OPEN-009', 'OPEN-010', 'OPEN-011',
    ]);
  });

  it('holds the water pump on the owner’s ruling, and admits no block has it', () => {
    // *"starting the water pump is a task of opening"*. The matrix put it in
    // the evening. It is the morning's now — and the morning does not yet
    // cover it, which is the honest state rather than a block invented to
    // make the row look closed.
    expect(OPENING_CONTROLS['OPEN-010']!.covers).toBeNull();
    expect(OPENING_CONTROLS['OPEN-010']!.why).toContain('water pump');
    expect(UNCOVERED_OPENING_CONTROLS).toContain('OPEN-010');
  });

  it('gave emergency readiness a block rather than leaving it with the fans', () => {
    // OPEN-012 sat in the uncovered list next to the ACs and the air diffuser
    // and was never the same kind of thing. It has its own block and its own
    // engine now; what makes it different is that "accessible" is twenty
    // separate facts rather than one tick.
    expect(OPENING_CONTROLS['OPEN-012']!.covers).toBe('EMERGENCY');
    expect(OPENING_CONTROLS['OPEN-012']!.why).toContain('checklist rather than a tick');
  });
});
