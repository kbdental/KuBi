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
  ClinicEvent, RoleCode, emptyWorld, record, closing, whyNotClosed,
  SAME_DAY_STERILISATION_NOTE, type Operatory, type World,
} from '@kubi/contracts';

const T = (h: number, m: number) => h * 60 + m;

const FOUR: Operatory[] = [
  { id: 'op-1', label: 'Operatory 1', position: 1 },
  { id: 'op-2', label: 'Operatory 2', position: 2 },
  { id: 'op-3', label: 'Operatory 3', position: 3 },
  { id: 'op-4', label: 'Operatory 4', position: 4 },
];

const evening = (ops: Operatory[] = FOUR, now = T(19, 0)): World =>
  emptyWorld(now, { operatories: ops, firstPatientAt: T(10, 0) });

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

const shut = (w: World) => closing(w.events, w.operatories);

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
