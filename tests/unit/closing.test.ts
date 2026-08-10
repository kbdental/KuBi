/**
 * The closing drill, against the owner's document.
 *
 * The matrix asks the same thing of the evening as of the morning — *"KuBi
 * should distinguish Task Completed from Clinic Safe to Close"* — and adds one
 * thing the morning never has: a state where something is wrong and the clinic
 * closes anyway. That state is named here and deliberately not acted on.
 */
import { describe, it, expect } from 'vitest';
import {
  ClinicEvent, RoleCode, Verdict, decisionsFor, emptyWorld, record, closing, whyNotClosed,
  SAME_DAY_STERILISATION_NOTE, CLOSING_MINUTES, lastCollection,
  CLOSING_CONTROLS, UNCOVERED_CLOSING_CONTROLS, readiness,
  type Operatory, type World,
} from '@kubi/contracts';

const T = (h: number, m: number) => h * 60 + m;

const FOUR: Operatory[] = [
  { id: 'op-1', label: 'Operatory 1', position: 1 },
  { id: 'op-2', label: 'Operatory 2', position: 2 },
  { id: 'op-3', label: 'Operatory 3', position: 3 },
  { id: 'op-4', label: 'Operatory 4', position: 4 },
];

/** 18:30 — "clinic shut time is 6.30 normally". */
const SHUT = T(18, 30);
/** 19:00 — "with exceptions of some days that is 7". */
const LATE_SHUT = T(19, 0);

const evening = (ops: Operatory[] = FOUR, now = T(19, 0), shutAt: number | null = SHUT): World =>
  emptyWorld(now, { operatories: ops, firstPatientAt: T(10, 0), shutAt });

function must(w: World, type: ClinicEvent, id: string, by: RoleCode, label?: string): World {
  const r = record(w, { type, subjectId: id, by, ...(label ? { subjectLabel: label } : {}) });
  if (!r.ok) throw new Error(`the clinic refused "${type}": ${r.refusal.because}`);
  return r.world;
}

/** The whole drill, done properly. */
function wholeDrill(w = evening()): World {
  let x = w;
  for (const o of FOUR) {
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

const shut = (w: World) => closing(w.events, w.operatories, w.shutAt, w.now);

/* ═══════════════════════════════════════════════════════════════════════ */

describe('the evening is built from the master, like the morning', () => {
  it('closes down every operatory the clinic actually has', () => {
    const rooms = shut(evening()).blocks.filter((b) => b.id.startsWith('OPERATORY_CLOSED:'));
    expect(rooms).toHaveLength(4);
    expect(rooms.map((b) => b.label)).toEqual([
      'Close down Operatory 1', 'Close down Operatory 2',
      'Close down Operatory 3', 'Close down Operatory 4',
    ]);
  });

  it('has one block per section of the owner’s drill', () => {
    // Grouped by owner rather than interleaved: the assistant's rooms and
    // restock, then reception's money and tomorrow, then housekeeping's
    // building, then the act of leaving. Two people working at once is what
    // makes thirty minutes possible.
    const ids = shut(evening()).blocks.map((b) => b.id);
    expect(ids).toEqual([
      'OPERATORY_CLOSED:op-1', 'OPERATORY_CLOSED:op-2',
      'OPERATORY_CLOSED:op-3', 'OPERATORY_CLOSED:op-4',
      'RESTOCK', 'PAYMENTS', 'REPORT', 'TOMORROW',
      'WASTE', 'ENVIRONMENT', 'SECURITY',
    ]);
  });

  it('will not call an unconfigured clinic closed', () => {
    const c = shut(evening([]));
    expect(c.clear).toBe(false);
    expect(c.unconfigured).toContain('No operatory has been set up for this clinic');
  });
});

describe('who does what in the evening', () => {
  it('puts the rooms on the assistant and the money on reception', () => {
    const c = shut(evening());
    const by = (id: string) => c.blocks.find((b) => b.id === id)!.owner;
    expect(by('OPERATORY_CLOSED:op-1')).toBe(RoleCode.DENTAL_ASSISTANT);
    expect(by('RESTOCK')).toBe(RoleCode.DENTAL_ASSISTANT);
    expect(by('PAYMENTS')).toBe(RoleCode.RECEPTION);
    expect(by('REPORT')).toBe(RoleCode.RECEPTION);
    expect(by('TOMORROW')).toBe(RoleCode.RECEPTION);
    expect(by('SECURITY')).toBe(RoleCode.RECEPTION);
    expect(by('WASTE')).toBe(RoleCode.HOUSEKEEPING);
    expect(by('ENVIRONMENT')).toBe(RoleCode.HOUSEKEEPING);
  });

  it('refuses reception reporting housekeeping’s fumigation, and the reverse', () => {
    expect(record(evening(), {
      type: ClinicEvent.ENVIRONMENT_CLOSED, subjectId: 'today', by: RoleCode.RECEPTION,
    }).ok).toBe(false);
    expect(record(evening(), {
      type: ClinicEvent.PAYMENTS_RECONCILED, subjectId: 'today', by: RoleCode.HOUSEKEEPING,
    }).ok).toBe(false);
  });

  it('says "closing" and not "morning" when it refuses in the evening', () => {
    const r = record(evening(), {
      type: ClinicEvent.ENVIRONMENT_CLOSED, subjectId: 'today', by: RoleCode.RECEPTION,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because).toBe('Closing the clinic down is not your part of the closing');
    expect(r.refusal.goes).toBe('Closing');
  });

  it('lets reception reconcile the takings, which is their section', () => {
    expect(record(evening(), {
      type: ClinicEvent.PAYMENTS_RECONCILED, subjectId: 'today', by: RoleCode.RECEPTION,
    }).ok).toBe(true);
  });
});

describe('the day cannot be locked up on somebody’s word', () => {
  /** A finished day: nobody waiting, no instruments in the loop, note written. */
  const finishedDay = (): World => evening(FOUR, T(19, 0));

  it('refuses to lock up while an operatory is still open, naming it', () => {
    let w = finishedDay();
    for (const o of [FOUR[0]!, FOUR[1]!, FOUR[2]!]) {
      w = must(w, ClinicEvent.OPERATORY_CLOSED, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
    }
    w = must(w, ClinicEvent.CONSUMABLES_RESTOCKED, 'today', RoleCode.DENTAL_ASSISTANT);
    w = must(w, ClinicEvent.PAYMENTS_RECONCILED, 'today', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.DAY_REPORTED, 'today', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.TOMORROW_REVIEWED, 'today', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.WASTE_CLOSED, 'today', RoleCode.HOUSEKEEPING);
    w = must(w, ClinicEvent.ENVIRONMENT_CLOSED, 'today', RoleCode.HOUSEKEEPING);
    w = must(w, ClinicEvent.PREMISES_SECURED, 'today', RoleCode.RECEPTION);

    const r = record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because)
      .toBe('Operatory 4 has not been closed down — instruments, film, power and floor');
  });

  it('names the waste when that is what is left', () => {
    let w = finishedDay();
    for (const o of FOUR) {
      w = must(w, ClinicEvent.OPERATORY_CLOSED, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
    }
    w = must(w, ClinicEvent.PAYMENTS_RECONCILED, 'today', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.DAY_REPORTED, 'today', RoleCode.RECEPTION);
    expect(whyNotClosed(shut(w)))
      .toBe('The waste bins are not closed and the logbook is not written');
  });

  it('locks up once the whole drill is done', () => {
    const w = wholeDrill(finishedDay());
    expect(shut(w).clear).toBe(true);
    expect(record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(true);
  });

  it('puts the patient, the note and the instruments ahead of the building', () => {
    // The closing-drill rule is deliberately the last of the four on
    // CLINIC_LOCKED. A manager who has left an unreleased autoclave cycle
    // should be told about the cycle, not about the bins.
    let w = evening();
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.BATCH_COLLECTED, 'b9', RoleCode.STERILIZATION_TECHNICIAN, 'STER-9');
    w = must(w, ClinicEvent.BATCH_ULTRASONIC_DONE, 'b9', RoleCode.STERILIZATION_TECHNICIAN);
    w = must(w, ClinicEvent.BATCH_PACKED, 'b9', RoleCode.STERILIZATION_TECHNICIAN);
    w = must(w, ClinicEvent.BATCH_AUTOCLAVED, 'b9', RoleCode.STERILIZATION_TECHNICIAN);

    const r = record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because).toBe('An autoclave cycle has not been released');
  });
});

describe('the critical exception is named, and not acted on', () => {
  /**
   * The matrix asks for 🔴 CLOSING WITH CRITICAL EXCEPTION and a manager
   * acknowledgement. That is an override path over a patient-safety failure,
   * and constitution rule 2 says a BLOCK_HARD gate has no override. So the
   * state exists in the data — visible, countable, reportable — and nothing
   * lets anybody through it until the owner rules.
   */
  it('separates patient-safety work from the rest', () => {
    const c = shut(evening());
    const critical = c.blocks.filter((b) => b.critical).map((b) => b.id);
    expect(critical).toEqual([
      'OPERATORY_CLOSED:op-1', 'OPERATORY_CLOSED:op-2',
      'OPERATORY_CLOSED:op-3', 'OPERATORY_CLOSED:op-4',
      'WASTE', 'ENVIRONMENT',
    ]);
    // The takings and the report matter; they are not patient safety.
    expect(c.blocks.find((b) => b.id === 'PAYMENTS')!.critical).toBe(false);
    expect(c.blocks.find((b) => b.id === 'REPORT')!.critical).toBe(false);
    // Nor is handing the day on. The matrix scores CLOSE-009 and CLOSE-013 as
    // I and CLOSE-014 as C; only PS is patient safety, and calling anything
    // else critical would empty the word out.
    expect(c.blocks.find((b) => b.id === 'RESTOCK')!.critical).toBe(false);
    expect(c.blocks.find((b) => b.id === 'TOMORROW')!.critical).toBe(false);
  });

  it('still holds the door for work that is merely important', () => {
    // Not critical is not optional. Every block gates the lockup; what
    // `critical` decides is whether the manager is told about this one first.
    const w = wholeDrill();
    let x = evening();
    for (const o of FOUR) {
      x = must(x, ClinicEvent.OPERATORY_CLOSED, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
    }
    x = must(x, ClinicEvent.PAYMENTS_RECONCILED, 'today', RoleCode.RECEPTION);
    x = must(x, ClinicEvent.DAY_REPORTED, 'today', RoleCode.RECEPTION);
    x = must(x, ClinicEvent.TOMORROW_REVIEWED, 'today', RoleCode.RECEPTION);
    x = must(x, ClinicEvent.WASTE_CLOSED, 'today', RoleCode.HOUSEKEEPING);
    x = must(x, ClinicEvent.ENVIRONMENT_CLOSED, 'today', RoleCode.HOUSEKEEPING);
    x = must(x, ClinicEvent.PREMISES_SECURED, 'today', RoleCode.RECEPTION);

    expect(shut(x).clear).toBe(false);
    expect(shut(x).criticalException).toHaveLength(0);
    expect(whyNotClosed(shut(x)))
      .toBe('The operatories have not been replenished for tomorrow');
    expect(record(x, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(false);

    // And with it done, the same day locks up.
    expect(record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(true);
  });

  it('reports the exception when safety work is outstanding', () => {
    let w = evening();
    w = must(w, ClinicEvent.PAYMENTS_RECONCILED, 'today', RoleCode.RECEPTION);
    const c = shut(w);
    expect(c.criticalException.map((b) => b.id)).toContain('WASTE');
    expect(c.criticalException.map((b) => b.id)).not.toContain('PAYMENTS');
  });

  it('offers no way to close through it', () => {
    // If an acknowledgement is ever built it will be a permission, not a flag
    // on this call. Until then there is no argument that gets past the gate.
    let w = evening();
    w = must(w, ClinicEvent.PAYMENTS_RECONCILED, 'today', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.DAY_REPORTED, 'today', RoleCode.RECEPTION);
    for (const by of [RoleCode.CLINIC_MANAGER, RoleCode.CLINIC_HEAD, RoleCode.OWNER_DIRECTOR]) {
      expect(record(w, { type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by }).ok,
        `${by} must not be able to close through a critical exception`).toBe(false);
    }
  });

  it('says how the same-day question was settled, and by what', () => {
    // Not "recorded rather than resolved" any more — the owner ruled. The note
    // carries the arithmetic that forced the choice and the choice itself, so
    // whoever proposes same-day again finds both in one place.
    expect(SAME_DAY_STERILISATION_NOTE).toContain('75');
    expect(SAME_DAY_STERILISATION_NOTE).toContain('morning run');
    expect(lastCollection(T(18, 30)).reachable).toBe(false);
  });
});

describe('when the clinic shuts', () => {
  /**
   * The owner: *"clinic shut time is 6.30 normally with exceptions of some
   * days that is 7"*. Both facts are data — the normal time on the clinic, the
   * exception days in their own table — because a clinic that only knew 18:30
   * would call every one of those evenings an overrun.
   */
  it('carries today’s shut time, whichever one it is', () => {
    expect(shut(evening()).shutAt).toBe(SHUT);
    expect(shut(evening(FOUR, T(19, 0), LATE_SHUT)).shutAt).toBe(LATE_SHUT);
  });

  it('measures how long closing took, not how late it was', () => {
    // The drill starts when the clinic shuts, so finishing after 18:30 is the
    // normal case and not a failure. What is worth knowing is the gap.
    const w = wholeDrill(evening(FOUR, T(19, 20)));
    expect(shut(w).closedAt).toBe(T(19, 20));
    expect(shut(w).overrunMinutes).toBe(50);
  });

  it('measures a late day against its own shut time, not the normal one', () => {
    // Seven o'clock day. Leaving at 19:50 is the same fifty minutes of work,
    // and reporting eighty would blame the team for the exception.
    const w = wholeDrill(evening(FOUR, T(19, 50), LATE_SHUT));
    expect(shut(w).overrunMinutes).toBe(50);
  });

  it('reports no overrun when nobody has set a shut time', () => {
    const w = wholeDrill(evening(FOUR, T(19, 20), null));
    expect(shut(w).shutAt).toBeNull();
    expect(shut(w).overrunMinutes).toBeNull();
    expect(shut(w).closedAt).toBe(T(19, 20));   // we still know when they left
  });

  it('knows the clinic is mid-closing, and when it is not', () => {
    expect(shut(evening(FOUR, T(18, 45))).closingNow).toBe(true);
    // Before the door shuts, the evening has not started.
    expect(shut(evening(FOUR, T(17, 0))).closingNow).toBe(false);
    // And once the drill is done it is not closing any more, whatever the hour.
    expect(shut(wholeDrill(evening(FOUR, T(19, 30)))).closingNow).toBe(false);
  });

  it('puts the drill on people the moment the clinic shuts', () => {
    // Not "once the last patient leaves" — some evenings the door closes at
    // 18:30 with the drill still to do and nobody in the chair.
    const before = decisionsFor(evening(FOUR, T(18, 0)), RoleCode.HOUSEKEEPING, T(18, 0));
    expect(before).toHaveLength(0);
    const after = decisionsFor(evening(FOUR, T(18, 31)), RoleCode.HOUSEKEEPING, T(18, 31));
    expect(after.map((d) => d.question)).toEqual([
      'Close the bio-medical waste', 'Close the clinic down and fumigate',
    ]);
  });
});

describe('thirty minutes, and what follows from it', () => {
  it('expects the team out half an hour after the clinic shuts', () => {
    expect(CLOSING_MINUTES).toBe(30);
    expect(shut(evening()).expectedCloseAt).toBe(T(19, 0));
    // And on a seven o'clock day, half past seven.
    expect(shut(evening(FOUR, T(19, 0), LATE_SHUT)).expectedCloseAt).toBe(T(19, 30));
  });

  it('reports variance against the expectation, early as a negative', () => {
    const early = wholeDrill(evening(FOUR, T(18, 50)));
    expect(shut(early).varianceMinutes).toBe(-10);
    const late = wholeDrill(evening(FOUR, T(19, 25)));
    expect(shut(late).varianceMinutes).toBe(25);
  });

  it('knows when the team should have gone home and has not', () => {
    expect(shut(evening(FOUR, T(18, 50))).runningLate).toBe(false);
    expect(shut(evening(FOUR, T(19, 10))).runningLate).toBe(true);
    // Finished is finished, however late the hour.
    expect(shut(wholeDrill(evening(FOUR, T(20, 0)))).runningLate).toBe(false);
  });

  it('escalates outstanding closing work past the expected close', () => {
    const onTime = decisionsFor(evening(FOUR, T(18, 45)), RoleCode.HOUSEKEEPING, T(18, 45));
    expect(onTime.every((d) => d.verdict === Verdict.PROCEED)).toBe(true);

    const over = decisionsFor(evening(FOUR, T(19, 15)), RoleCode.HOUSEKEEPING, T(19, 15));
    expect(over.every((d) => d.verdict === Verdict.ESCALATE)).toBe(true);
    expect(over[0]!.lateBy).toBe(15);
    expect(over[0]!.ifIgnored).toContain('past when the team should have left');
  });

  it('is never late when the clinic has no shut time', () => {
    const d = decisionsFor(evening(FOUR, T(23, 0), null), RoleCode.HOUSEKEEPING, T(23, 0));
    expect(d.every((x) => x.lateBy === 0)).toBe(true);
  });
});

describe('same-day sterilisation does not fit, and the arithmetic says so', () => {
  /**
   * Three of the owner's own numbers, put together for the first time:
   * shut at 18:30, thirty minutes of closing, seventy-five minutes of
   * sterilisation to cooling. Working back from when the team leaves gives a
   * last-collection time *before* the clinic shuts.
   */
  it('puts the last possible collection before the clinic even shuts', () => {
    const c = lastCollection(T(18, 30));
    expect(c.at).toBe(T(17, 45));          // 19:00 leave − 75 min
    expect(c.reachable).toBe(false);
    expect(c.shortfallMinutes).toBe(45);
  });

  it('is no better on a seven o’clock day — the whole schedule just shifts', () => {
    const c = lastCollection(T(19, 0));
    expect(c.at).toBe(T(18, 15));
    expect(c.reachable).toBe(false);
    expect(c.shortfallMinutes).toBe(45);   // the same gap, an hour later
  });

  it('says nothing when there is no shut time to work back from', () => {
    expect(lastCollection(null)).toEqual({ at: null, reachable: false, shortfallMinutes: null });
  });

  it('lets a batch wait for the morning, and refuses an unreleased cycle', () => {
    // The owner's ruling, both halves. A batch at collection is tomorrow's
    // first job; a cycle that ran and was never released is a today problem.
    expect(SAME_DAY_STERILISATION_NOTE).toContain('morning run');

    let waiting = wholeDrill();
    waiting = must(waiting, ClinicEvent.BATCH_COLLECTED, 'b1',
      RoleCode.STERILIZATION_TECHNICIAN, 'STER-1');
    expect(record(waiting, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(true);

    let unreleased = waiting;
    unreleased = must(unreleased, ClinicEvent.BATCH_ULTRASONIC_DONE, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
    unreleased = must(unreleased, ClinicEvent.BATCH_PACKED, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
    unreleased = must(unreleased, ClinicEvent.BATCH_AUTOCLAVED, 'b1', RoleCode.STERILIZATION_TECHNICIAN);
    expect(record(unreleased, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(false);
  });

  it('hands the overnight batch to the morning, which cannot open without it', () => {
    // The other half of the ruling, and the reason the evening can let a batch
    // go: the safety net moved to opening. Yesterday's instruments are the
    // morning's STERILE block, and the clinic cannot be called ready until
    // somebody releases a run.
    const tomorrow = emptyWorld(T(8, 30), { operatories: FOUR, firstPatientAt: T(10, 0) });
    const morning = readiness(tomorrow.events, tomorrow.operatories,
      tomorrow.firstPatientAt, T(8, 30));
    const sterile = morning.blocks.find((b) => b.id === 'STERILE')!;
    expect(sterile.mandatory).toBe(true);
    expect(sterile.done).toBe(false);
    expect(morning.ready).toBe(false);
    expect(morning.outstanding.map((b) => b.id)).toContain('STERILE');
    expect(sterile.ifOutstanding).toBe('There are no sterile packs in the cabinets for today');
  });
});

describe('every one of the matrix’s sixteen controls is accounted for', () => {
  /**
   * Seven of the matrix's owners read "Assigned Staff", which is not an owner.
   * Each is traced to the section of the owner's closing drill that contains
   * the work — the drill assigns owners per protocol, so the owner falls out
   * of which protocol the control belongs to. Derivation, not inference, and
   * checked here rather than believed.
   */
  const ids = Object.keys(CLOSING_CONTROLS);

  it('covers CLOSE-001 through CLOSE-016 and invents no others', () => {
    expect(ids).toEqual(Array.from({ length: 16 },
      (_, i) => `CLOSE-${String(i + 1).padStart(3, '0')}`));
  });

  it('points every covered control at a block that actually exists', () => {
    const blocks = new Set(shut(evening()).blocks.map((b) =>
      b.id.startsWith('OPERATORY_CLOSED:') ? 'OPERATORY_CLOSED' : b.id));
    for (const [id, { covers }] of Object.entries(CLOSING_CONTROLS)) {
      if (covers === null || covers === 'GOVERNANCE' || covers === 'MORNING') continue;
      expect(blocks, `${id} points at "${covers}", which is not a closing block`)
        .toContain(covers);
    }
  });

  it('gives every control a reason, so none is covered by assertion alone', () => {
    for (const [id, { why }] of Object.entries(CLOSING_CONTROLS)) {
      expect(why.length, `${id} has no reason`).toBeGreaterThan(20);
    }
  });

  it('leaves nothing the drill has no home for', () => {
    // Four used to be uncovered — CLOSE-009, 012, 013, 014 — and three of the
    // four were "get ready for tomorrow" work: the drill was thorough about
    // shutting the building down and silent about handing the day on. The
    // owner's instruction was to add them, and this is the assertion that the
    // gap actually closed rather than being described as closed.
    expect(UNCOVERED_CLOSING_CONTROLS).toEqual([]);
  });

  it('resolves the seven that used to read "Assigned Staff"', () => {
    // Six derived from a section of the drill. The water pump derived from
    // nothing — it appeared in the matrix and in no section — and the owner
    // explained why: it is not a closing task at all.
    const wasAssignedStaff = ['CLOSE-007', 'CLOSE-010', 'CLOSE-011', 'CLOSE-012', 'CLOSE-015'];
    expect(wasAssignedStaff.filter((id) => CLOSING_CONTROLS[id]!.covers !== null))
      .toEqual(wasAssignedStaff);
  });

  it('adds three controls as two blocks, and sends the fourth to the morning', () => {
    // The judgement worth being able to check: CLOSE-013 and CLOSE-014 are one
    // sit-down at reception — you cannot review tomorrow's list without
    // noticing which case is at the lab.
    expect(CLOSING_CONTROLS['CLOSE-009']!.covers).toBe('RESTOCK');
    expect(CLOSING_CONTROLS['CLOSE-013']!.covers).toBe('TOMORROW');
    expect(CLOSING_CONTROLS['CLOSE-014']!.covers).toBe('TOMORROW');
  });

  it('keeps the water pump out of the evening, on the owner’s ruling', () => {
    // *"the water pump… is not a task of closing, instead starting the water
    // pump is a task of opening"*. The matrix had it on the wrong side of the
    // day. It is recorded as the morning's rather than deleted, and the
    // evening must not mention it — a closing block that names a switch
    // nobody flips at closing teaches people to ignore the sentence.
    expect(CLOSING_CONTROLS['CLOSE-012']!.covers).toBe('MORNING');
    const env = shut(evening()).blocks.find((b) => b.id === 'ENVIRONMENT')!;
    expect(env.ifOutstanding).not.toContain('pump');
    for (const b of shut(evening()).blocks) {
      expect(b.label.toLowerCase(), `${b.id} still mentions the pump`).not.toContain('pump');
    }
  });

  it('costs the day no extra time, because the work was already being done', () => {
    // The rooms were being restocked and tomorrow was being looked at on the
    // way out of the door. What changed is that the system can see it, so the
    // owner's thirty minutes stands.
    expect(CLOSING_MINUTES).toBe(30);
  });

  it('puts the waste on housekeeping and the lockdown on reception', () => {
    const owner = (id: string) => {
      const covers = CLOSING_CONTROLS[id]!.covers!;
      return shut(evening()).blocks.find((b) => b.id === covers)!.owner;
    };
    expect(owner('CLOSE-007')).toBe(RoleCode.HOUSEKEEPING);
    expect(owner('CLOSE-011')).toBe(RoleCode.HOUSEKEEPING);
    expect(owner('CLOSE-015')).toBe(RoleCode.RECEPTION);
  });

  it('puts the operatory shutdown on the assistant, per room', () => {
    // CLOSE-010 was one matrix row and is three things in the drill: the
    // light, compressor and suction are the assistant's, in each room; the
    // board is reception's; the chairs are housekeeping's.
    const rooms = shut(evening()).blocks.filter((b) => b.id.startsWith('OPERATORY_CLOSED:'));
    expect(rooms).toHaveLength(4);
    for (const r of rooms) expect(r.owner).toBe(RoleCode.DENTAL_ASSISTANT);
    expect(CLOSING_CONTROLS['CLOSE-010']!.why).toContain('Security');
    expect(CLOSING_CONTROLS['CLOSE-010']!.why).toContain('Environment');
  });
});

describe('the closing measures', () => {
  it('counts closing-checklist compliance over the drill', () => {
    let w = evening();
    expect(shut(w).compliance).toBe(0);
    for (const o of FOUR) {
      w = must(w, ClinicEvent.OPERATORY_CLOSED, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
    }
    expect(shut(w).compliance).toBeCloseTo(4 / 11);
    expect(shut(wholeDrill()).compliance).toBe(1);
  });

  it('records when the day actually closed', () => {
    const w = wholeDrill(evening(FOUR, T(19, 20)));
    expect(shut(w).closedAt).toBe(T(19, 20));
  });

  it('counts staff out through the exit protocol, without gating on it', () => {
    let w = wholeDrill();
    w = must(w, ClinicEvent.STAFF_LEFT, 'emp-priya', RoleCode.DENTAL_ASSISTANT, 'Priya');
    w = must(w, ClinicEvent.STAFF_LEFT, 'emp-priya', RoleCode.DENTAL_ASSISTANT, 'Priya');
    w = must(w, ClinicEvent.STAFF_LEFT, 'emp-kavita', RoleCode.RECEPTION, 'Kavita');
    expect(shut(w).staffLeft).toBe(2);
    // Same limit as staff entry: an event carries a role, not a person, so the
    // per-person protocol is counted and not enforced.
    expect(shut(w).clear).toBe(true);
  });
});
