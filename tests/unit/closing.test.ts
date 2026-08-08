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
  x = must(x, ClinicEvent.PAYMENTS_RECONCILED, 'today', RoleCode.RECEPTION);
  x = must(x, ClinicEvent.DAY_REPORTED, 'today', RoleCode.RECEPTION);
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
    const ids = shut(evening()).blocks.map((b) => b.id);
    expect(ids).toEqual([
      'OPERATORY_CLOSED:op-1', 'OPERATORY_CLOSED:op-2',
      'OPERATORY_CLOSED:op-3', 'OPERATORY_CLOSED:op-4',
      'PAYMENTS', 'REPORT', 'WASTE', 'ENVIRONMENT', 'SECURITY',
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
    expect(by('PAYMENTS')).toBe(RoleCode.RECEPTION);
    expect(by('REPORT')).toBe(RoleCode.RECEPTION);
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
    w = must(w, ClinicEvent.PAYMENTS_RECONCILED, 'today', RoleCode.RECEPTION);
    w = must(w, ClinicEvent.DAY_REPORTED, 'today', RoleCode.RECEPTION);
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
    // CLINIC_LOCKED. A manager who has left a patient mid-visit should be told
    // about the patient, not about the bins.
    let w = evening();
    w = must(w, ClinicEvent.CLINIC_UNLOCKED, 'today', RoleCode.RECEPTION, 'the clinic');
    w = must(w, ClinicEvent.BATCH_COLLECTED, 'b9', RoleCode.STERILIZATION_TECHNICIAN, 'STER-9');

    const r = record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal.because).toBe('Instruments are still in the loop');
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

  it('says why same-day sterilisation will bite, without pretending to solve it', () => {
    // Instruments go to the sterilisation room at closing, the cycle is 75
    // minutes to cooling, and the matrix wants same-day at 100%. Recorded
    // rather than resolved.
    expect(SAME_DAY_STERILISATION_NOTE).toContain('75');
    expect(SAME_DAY_STERILISATION_NOTE).toContain('cut-off');
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

  it('still refuses to close with instruments in the loop', () => {
    // The arithmetic is a finding, not a licence. Until the owner rules on it,
    // the clinic behaves exactly as before.
    expect(SAME_DAY_STERILISATION_NOTE).toContain('cut-off');
    let w = evening();
    w = must(w, ClinicEvent.BATCH_COLLECTED, 'b1', RoleCode.STERILIZATION_TECHNICIAN, 'STER-1');
    expect(record(w, {
      type: ClinicEvent.CLINIC_LOCKED, subjectId: 'today', by: RoleCode.CLINIC_MANAGER,
    }).ok).toBe(false);
  });
});

describe('the closing measures', () => {
  it('counts closing-checklist compliance over the drill', () => {
    let w = evening();
    expect(shut(w).compliance).toBe(0);
    for (const o of FOUR) {
      w = must(w, ClinicEvent.OPERATORY_CLOSED, o.id, RoleCode.DENTAL_ASSISTANT, o.label);
    }
    expect(shut(w).compliance).toBeCloseTo(4 / 9);
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
