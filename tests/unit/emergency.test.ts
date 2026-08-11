/**
 * OPEN-012 — morning emergency readiness.
 *
 *   `Morning emergency readiness · Required emergency resources accessible ·
 *   Daily · Assistant · Doctor · Checklist · PS · Clinic safety alert`
 *
 * Six of the seven uncovered opening controls were one thing wearing six
 * matrix rows — opening the building. This was the seventh, and it was never
 * in that group. Priority PS, checker Doctor, and the failure mode is somebody
 * going into anaphylaxis while a colleague looks for a key.
 *
 * So the tests are about the three things that separate this from a tick
 * sheet: an unasked question fails, expiry is a date rather than an opinion,
 * and the person who checks it may not be the person who signs it.
 */
import { describe, it, expect } from 'vitest';
import {
  RoleCode, ClinicEvent,
  EMERGENCY_KIT, KIT_BY_ID, UNRATIFIED_EMERGENCY_KIT, EMERGENCY_QUESTIONS,
  EmergencyKind, ItemVerdict, EmergencyState,
  emergencyReadiness, refuseVerification, checkFrom, verificationFrom,
  EMERGENCY_SHEET_COLUMNS, OPENING_CONTROLS, UNCOVERED_OPENING_CONTROLS,
  readiness,
  type EmergencyCheck, type EmergencyCheckRow, type EmergencyVerification,
  type Operatory, type ReadinessEvent,
} from '@kubi/contracts';

const TODAY = 400;
const NOW = 9 * 60 + 15;
const ASSISTANT = 'e1';
const DOCTOR = 'e7';

/** Everything present, reachable, and well in date. */
const goodRows = (): EmergencyCheckRow[] => EMERGENCY_KIT.map((i) => ({
  itemId: i.id,
  found: i.required,
  earliestExpiryDay: i.kind === EmergencyKind.DEVICE
    || i.kind === EmergencyKind.INFORMATION ? null : TODAY + 400,
  accessible: true,
  note: null,
}));

const check = (rows = goodRows(), by = ASSISTANT): EmergencyCheck => ({
  at: 8 * 60 + 50, byEmployeeCode: by, byRole: RoleCode.DENTAL_ASSISTANT, rows,
});

const signedBy = (who = DOCTOR, role = RoleCode.TREATING_DOCTOR): EmergencyVerification =>
  ({ at: 9 * 60, byEmployeeCode: who, byRole: role });

const withRow = (itemId: string, over: Partial<EmergencyCheckRow>): EmergencyCheckRow[] =>
  goodRows().map((r) => (r.itemId === itemId ? { ...r, ...over } : r));

const read = (
  c: EmergencyCheck | null, v: EmergencyVerification | null = null, today = TODAY,
) => emergencyReadiness(EMERGENCY_KIT, c, v, today, NOW);

/* ═══════════════════════════════════════════════════════════════════════ */

describe('the contents list is real work, and it is not the clinic’s yet', () => {
  it('says out loud that nobody has signed it off', () => {
    // An emergency kit's contents are a clinical and statutory decision. KuBi
    // runs the control so the machinery is real and testable, and it must not
    // report a kit "complete" against a list it wrote itself.
    expect(UNRATIFIED_EMERGENCY_KIT).toBe(true);
    expect(EMERGENCY_QUESTIONS.length).toBeGreaterThanOrEqual(3);
    expect(EMERGENCY_QUESTIONS[0]).toContain('doctor’s signature');
  });

  it('covers the emergencies a dental clinic actually has', () => {
    const scenarios = new Set(EMERGENCY_KIT.map((i) => i.forWhat));
    for (const s of ['Anaphylaxis', 'Cardiac arrest', 'Hypoglycaemia',
      'Angina', 'Suspected heart attack', 'Prolonged seizure']) {
      expect([...scenarios].join(' | '), `nothing for ${s}`).toContain(s);
    }
  });

  it('tells every item what its absence means, in words that make somebody move', () => {
    // A contents list that says "adrenaline — 3" is inventory. The reason is
    // what makes a person walk to the cupboard at 08:50.
    for (const i of EMERGENCY_KIT) {
      expect(i.ifMissing.length, `${i.id} has no reason`).toBeGreaterThan(30);
      expect(i.forWhat.length, `${i.id} says nothing about what it is for`)
        .toBeGreaterThan(3);
    }
  });

  it('gives a replacement window to everything that is ordered, drug or not', () => {
    // Ordering adrenaline takes days. A kit that tells you on the morning it
    // expires has told you too late — and a defibrillator's pads dry out and
    // its battery flattens, so "device" is the wrong axis for this question.
    // What matters is whether the thing arrives from a supplier.
    expect(KIT_BY_ID.get('ADRENALINE')!.replaceDaysBefore).toBeGreaterThan(0);
    expect(KIT_BY_ID.get('AED')!.replaceDaysBefore).toBeGreaterThan(0);
    // A telephone number on a wall does not expire and must not be nagged about.
    expect(KIT_BY_ID.get('CONTACTS')!.replaceDaysBefore).toBe(0);
    expect(KIT_BY_ID.get('BVM')!.replaceDaysBefore).toBe(0);
  });

  it('does not stop the clinic for everything on the list', () => {
    // Everything here could save a life, and that is not the same question as
    // whether this morning can go ahead without it. A spacer is fetched; the
    // adrenaline is not.
    expect(KIT_BY_ID.get('ADRENALINE')!.critical).toBe(true);
    expect(KIT_BY_ID.get('SPACER')!.critical).toBe(false);
  });
});

describe('rule 1 · an unasked question fails', () => {
  it('will not call an unchecked kit ready', () => {
    const v = read(null);
    expect(v.state).toBe(EmergencyState.NOT_CHECKED);
    expect(v.safe).toBe(false);
    expect(v.headline).toContain('has not been checked this morning');
  });

  it('marks an item nobody counted as UNCHECKED, not as missing', () => {
    // Two different facts, fixed by two different people: one is about the
    // kit, the other about the morning.
    const v = read(check(withRow('ADRENALINE', { found: null })));
    const adr = v.items.find((r) => r.item.id === 'ADRENALINE')!;
    expect(adr.verdict).toBe(ItemVerdict.UNCHECKED);
    expect(adr.stops).toBe(true);
    expect(v.safe).toBe(false);
  });

  it('treats "nobody said whether it is reachable" as unanswered, not as yes', () => {
    // The standard's word is *accessible*. A tri-state is the only honest way
    // to hold it — a blank is not a yes.
    const v = read(check(withRow('AED', { accessible: null })));
    const aed = v.items.find((r) => r.item.id === 'AED')!;
    expect(aed.verdict).toBe(ItemVerdict.UNCHECKED);
    expect(aed.because).toContain('can actually be reached');
  });

  it('does not inherit yesterday’s check', () => {
    // The failure this control exists to prevent, said as code: a daily check
    // that carries forward is not a daily check.
    const yesterday: ReadinessEvent[] = [
      { type: ClinicEvent.EMERGENCY_CHECKED, subjectId: `${ASSISTANT}#DENTAL_ASSISTANT`,
        at: -600 },
    ];
    expect(checkFrom(yesterday, new Map(), 0)).toBeNull();
  });

  it('reads today’s check back out of the log, with who did it', () => {
    const events: ReadinessEvent[] = [
      { type: ClinicEvent.EMERGENCY_CHECKED, subjectId: `${ASSISTANT}#DENTAL_ASSISTANT`,
        at: 8 * 60 + 50 },
    ];
    const rows = new Map([[8 * 60 + 50, goodRows()]]);
    const c = checkFrom(events, rows, 0)!;
    expect(c.byEmployeeCode).toBe(ASSISTANT);
    expect(c.byRole).toBe(RoleCode.DENTAL_ASSISTANT);
    expect(c.rows).toHaveLength(EMERGENCY_KIT.length);
  });
});

describe('rule 2 · expiry is a date, not an opinion', () => {
  it('calls an expired drug as absent as one never bought', () => {
    const v = read(check(withRow('ADRENALINE', { earliestExpiryDay: TODAY - 12 })));
    const adr = v.items.find((r) => r.item.id === 'ADRENALINE')!;
    expect(adr.verdict).toBe(ItemVerdict.EXPIRED);
    expect(adr.because).toContain('Expired 12 days ago');
    expect(v.safe).toBe(false);
    expect(v.headline).toContain('EMERGENCY KIT NOT READY');
  });

  it('fails on the day it expires with nobody touching anything', () => {
    // The property that makes it derived rather than stored. Same check, same
    // rows, one day later.
    const rows = withRow('ADRENALINE', { earliestExpiryDay: TODAY });
    expect(emergencyReadiness(EMERGENCY_KIT, check(rows), signedBy(), TODAY, NOW).safe)
      .toBe(true);
    expect(emergencyReadiness(EMERGENCY_KIT, check(rows), signedBy(), TODAY + 1, NOW).safe)
      .toBe(false);
  });

  it('warns while there is still time to order', () => {
    const soon = TODAY + KIT_BY_ID.get('ADRENALINE')!.replaceDaysBefore - 1;
    const v = read(check(withRow('ADRENALINE', { earliestExpiryDay: soon })), signedBy());
    const adr = v.items.find((r) => r.item.id === 'ADRENALINE')!;
    expect(adr.verdict).toBe(ItemVerdict.EXPIRING);
    // Expiring is not expired. The clinic runs, and somebody orders.
    expect(adr.stops).toBe(false);
    expect(v.safe).toBe(true);
    expect(v.watch.map((r) => r.item.id)).toContain('ADRENALINE');
  });

  it('takes the earliest date in the box, not the furthest', () => {
    // A box of five with one expiring next week needs attention next week,
    // and the furthest date would hide exactly the ampoule somebody reaches
    // for first.
    const v = read(check(withRow('ADRENALINE',
      { found: 5, earliestExpiryDay: TODAY - 1 })));
    expect(v.items.find((r) => r.item.id === 'ADRENALINE')!.verdict)
      .toBe(ItemVerdict.EXPIRED);
  });

  it('does not expire a device or a telephone number', () => {
    const v = read(check(), signedBy());
    for (const id of ['AED', 'CONTACTS', 'BVM']) {
      expect(v.items.find((r) => r.item.id === id)!.verdict).toBe(ItemVerdict.READY);
    }
  });
});

describe('rule 3 · the checker is not the doer', () => {
  it('refuses a signature from the person who did the check', () => {
    // The same rule sterilisation applies to batch release. A check somebody
    // signs off themselves is one person saying one thing twice.
    const v = read(check(), signedBy(ASSISTANT, RoleCode.DENTAL_ASSISTANT));
    expect(v.complete).toBe(false);
    expect(v.verificationRefusedBecause).toContain('may not also sign it off');
  });

  it('refuses a signature from anybody who is not a doctor', () => {
    const v = read(check(), signedBy('e6', RoleCode.SENIOR_ASSISTANT));
    expect(v.complete).toBe(false);
    expect(v.verificationRefusedBecause).toContain('names the Checker as the doctor');
  });

  it('accepts the doctor’s countersignature', () => {
    const v = read(check(), signedBy());
    expect(v.state).toBe(EmergencyState.READY);
    expect(v.complete).toBe(true);
    expect(v.verifiedBy).toBe(DOCTOR);
    expect(v.verificationRefusedBecause).toBeNull();
  });

  it('has nothing to verify when nobody checked', () => {
    expect(refuseVerification(signedBy(), null)).toContain('no check to verify');
  });

  it('keeps a safe clinic running while the signature is outstanding', () => {
    // The distinction that stops this rule being routed around. The kit is
    // whole; the control is not finished. Blocking every treatment on a
    // countersignature would teach a clinic to sign it blind at 08:45.
    const v = read(check());
    expect(v.state).toBe(EmergencyState.AWAITING_VERIFICATION);
    expect(v.safe).toBe(true);
    expect(v.complete).toBe(false);
    expect(v.headline).toContain('Waiting on a doctor');
  });

  it('reads the countersignature out of the log with its role', () => {
    const events: ReadinessEvent[] = [
      { type: ClinicEvent.EMERGENCY_VERIFIED, subjectId: `${DOCTOR}#TREATING_DOCTOR`,
        at: 9 * 60 },
    ];
    expect(verificationFrom(events, 0)).toEqual({
      at: 9 * 60, byEmployeeCode: DOCTOR, byRole: RoleCode.TREATING_DOCTOR,
    });
  });
});

describe('the states a kit can be in', () => {
  it('separates missing from short from unreachable', () => {
    // Three different mornings. Ordering, counting, and finding a key.
    expect(read(check(withRow('SYRINGES', { found: 0 }))).items
      .find((r) => r.item.id === 'SYRINGES')!.verdict).toBe(ItemVerdict.MISSING);
    expect(read(check(withRow('SYRINGES', { found: 2 }))).items
      .find((r) => r.item.id === 'SYRINGES')!.verdict).toBe(ItemVerdict.SHORT);
    expect(read(check(withRow('SYRINGES', { accessible: false }))).items
      .find((r) => r.item.id === 'SYRINGES')!.verdict).toBe(ItemVerdict.INACCESSIBLE);
  });

  it('says a locked cupboard is the same as an empty one', () => {
    const v = read(check(withRow('ADRENALINE',
      { accessible: false, note: 'Cupboard locked, key not on the board' })));
    const adr = v.items.find((r) => r.item.id === 'ADRENALINE')!;
    expect(adr.because).toContain('Cupboard locked');
    expect(adr.because).toContain('the same as absent');
    expect(v.safe).toBe(false);
  });

  it('leads on what somebody would reach for and not find', () => {
    // Missing outranks expiring; the headline names the item, not a count.
    const rows = goodRows()
      .map((r) => (r.itemId === 'OXYGEN' ? { ...r, found: 0 } : r))
      .map((r) => (r.itemId === 'ASPIRIN' ? { ...r, found: 1 } : r));
    const v = read(check(rows));
    expect(v.stopping[0]!.item.id).toBe('OXYGEN');
    expect(v.headline).toContain('Oxygen cylinder');
  });

  it('does not stop the clinic for a non-critical item', () => {
    const v = read(check(withRow('SPACER', { found: 0 })), signedBy());
    expect(v.safe).toBe(true);
    expect(v.items.find((r) => r.item.id === 'SPACER')!.verdict)
      .toBe(ItemVerdict.MISSING);
    expect(v.stopping).toEqual([]);
  });

  it('is derived — no event says the kit is ready', () => {
    // Same rule as clinic readiness and room availability. The log records
    // that somebody checked and that somebody signed; it never records a
    // verdict, because a verdict somebody can set is a verdict somebody will.
    expect(Object.keys(ClinicEvent).filter((n) => /EMERGENCY_READY|KIT_OK/.test(n)))
      .toEqual([]);
    expect(ClinicEvent.EMERGENCY_CHECKED).toBeTruthy();
    expect(ClinicEvent.EMERGENCY_VERIFIED).toBeTruthy();
  });
});

describe('OPEN-012 is no longer an uncovered control', () => {
  const ROOMS: Operatory[] = [1, 2].map((i) => ({
    id: `op-${i}`, label: `Operatory ${i}`, position: i,
  }));

  it('has a readiness block, owned by the assistant the matrix names', () => {
    const b = readiness([], ROOMS, 10 * 60, NOW).blocks.find((x) => x.id === 'EMERGENCY')!;
    expect(b).toBeDefined();
    expect(b.owner).toBe(RoleCode.DENTAL_ASSISTANT);
    expect(b.mandatory).toBe(true);
    expect(b.completedBy).toBe(ClinicEvent.EMERGENCY_CHECKED);
  });

  it('holds the clinic shut until it is done', () => {
    const all = readiness([], ROOMS, 10 * 60, NOW).blocks
      .filter((b) => b.mandatory)
      .map((b): ReadinessEvent => ({
        type: b.completedBy, subjectId: b.subjectId ?? '', at: 8 * 60 + 50,
      }));
    expect(readiness(all, ROOMS, 10 * 60, NOW).ready).toBe(true);

    const withoutKit = all.filter((e) => e.type !== ClinicEvent.EMERGENCY_CHECKED);
    expect(readiness(withoutKit, ROOMS, 10 * 60, NOW).ready).toBe(false);
  });

  it('leaves exactly six uncovered controls, and they are the building', () => {
    expect(OPENING_CONTROLS['OPEN-012']?.covers).toBe('EMERGENCY');
    expect(UNCOVERED_OPENING_CONTROLS).toEqual([
      'OPEN-001', 'OPEN-007', 'OPEN-008', 'OPEN-009', 'OPEN-010', 'OPEN-011',
    ]);
  });

  it('names the columns the clinic’s sheet must carry', () => {
    for (const c of ['item_id', 'found', 'earliest_expiry', 'accessible',
      'checked_by', 'verified_by']) {
      expect(EMERGENCY_SHEET_COLUMNS).toContain(c);
    }
  });
});
