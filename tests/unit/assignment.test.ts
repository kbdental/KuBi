/**
 * Which assistant covers which chair — PAT-001.a.
 *
 *   *"Dental Assistants must be aware of all appointments for the day in their
 *   assigned operatory."*
 *
 * Four operatories, two assistants, and no assignment existed anywhere in
 * KuBi. The sentence had nothing to stand on: an assistant cannot be aware of
 * the appointments in "her" operatory when the software does not know which
 * one that is.
 *
 * The last block is the one worth reading. Two assistants covering four rooms
 * means somebody has two chairs, and two chairs can run at the same time —
 * and nothing in KuBi could notice that until the rooms had names against
 * them.
 */
import { describe, it, expect } from 'vitest';
import {
  RoleCode, ControlPriority,
  CoverState, chairCover, assistantForRoom,
  UNRATIFIED_ASSIGNMENT, ASSIGNMENT_QUESTIONS, ASSIGNMENT_SHEET_COLUMNS,
  type RoomAssignment, type CoveredSlot,
} from '@kubi/contracts';

const T = (h: number, m = 0) => h * 60 + m;
const NOW = T(9, 15);

const ROOMS = [1, 2, 3, 4].map((i) => ({ id: `op-${i}`, label: `Operatory ${i}` }));

/** Priya takes 1 and 2, Meera takes 3 and 4. Nisha stands in for both. */
const ASSIGNED: RoomAssignment[] = [
  { operatoryId: 'op-1', assistantEmployeeCode: 'e1', standInEmployeeCode: 'e6' },
  { operatoryId: 'op-2', assistantEmployeeCode: 'e1', standInEmployeeCode: 'e6' },
  { operatoryId: 'op-3', assistantEmployeeCode: 'e2', standInEmployeeCode: 'e6' },
  { operatoryId: 'op-4', assistantEmployeeCode: 'e2', standInEmployeeCode: 'e6' },
];

const slot = (over: Partial<CoveredSlot> = {}): CoveredSlot => ({
  id: 's1', patientLabel: 'Anita Rao', operatoryId: 'op-1',
  at: T(10, 0), endsAt: T(11, 0), namedAssistant: null, ...over,
});

const BOTH_HERE = new Set(['e1', 'e2', 'e6']);

const view = (
  slots: CoveredSlot[], present: Set<string> | undefined = BOTH_HERE,
  assignments = ASSIGNED,
) => chairCover(ROOMS, assignments, slots, present, NOW);

/* ═══════════════════════════════════════════════════════════════════════ */

describe('the room carries the assistant, not the appointment', () => {
  it('works out a booking’s assistant from the chair it is booked into', () => {
    // The one-line reason for the whole design: reception books a patient into
    // a chair, and who staffs that chair is a fact about the day rather than a
    // fact about the patient.
    expect(assistantForRoom('op-1', ASSIGNED, BOTH_HERE)).toBe('e1');
    expect(assistantForRoom('op-3', ASSIGNED, BOTH_HERE)).toBe('e2');
  });

  it('falls to the named stand-in when the assigned assistant is not here', () => {
    expect(assistantForRoom('op-1', ASSIGNED, new Set(['e2', 'e6']))).toBe('e6');
  });

  it('still names the assigned person when nobody at all is in', () => {
    // Returning null would read as "nobody is assigned to this room", which is
    // a different problem from "the person assigned has not come in", and the
    // manager does different things about the two.
    expect(assistantForRoom('op-1', ASSIGNED, new Set())).toBe('e1');
  });

  it('has nobody for a booking with no room', () => {
    expect(assistantForRoom(null, ASSIGNED, BOTH_HERE)).toBeNull();
  });

  it('says the assignment is the clinic’s to make, not KuBi’s', () => {
    // Two assistants and four rooms admits several sensible answers, and they
    // are not equivalent — pairing the two surgical rooms under one person is
    // what creates the clash below.
    expect(UNRATIFIED_ASSIGNMENT).toBe(true);
    expect(ASSIGNMENT_QUESTIONS[0]).toContain('by corridor');
  });
});

describe('a chair with work and nobody to do it', () => {
  it('covers a room whose assistant is in the building', () => {
    const v = view([slot()]);
    const one = v.rooms.find((r) => r.operatoryId === 'op-1')!;
    expect(one.state).toBe(CoverState.COVERED);
    expect(one.coveredBy).toBe('e1');
    expect(v.uncovered).toEqual([]);
  });

  it('uses the stand-in and says so, rather than reporting it as covered', () => {
    // ATT-007 already asks for cover to be named on approved leave. This is
    // that rule one level down, and the sentence has to say which it is.
    const v = view([slot()], new Set(['e2', 'e6']));
    const one = v.rooms.find((r) => r.operatoryId === 'op-1')!;
    expect(one.state).toBe(CoverState.STOOD_IN);
    expect(one.coveredBy).toBe('e6');
    expect(one.because).toContain('named stand-in is covering');
  });

  it('raises the room as uncovered when neither is here', () => {
    const v = view([slot()], new Set(['e2']));
    expect(v.uncovered.map((r) => r.operatoryId)).toEqual(['op-1']);
    const finding = v.findings.find((f) => f.control === 'PAT-001.a')!;
    expect(finding.priority).toBe(ControlPriority.C);
    expect(finding.ownerRole).toBe(RoleCode.CLINIC_MANAGER);
  });

  it('does not chase an empty room', () => {
    // A room with nobody assigned and nothing booked is not in use, and
    // reporting it every morning is how a list stops being read.
    const v = view([], new Set());
    expect(v.uncovered).toEqual([]);
    expect(v.rooms.every((r) => r.state === CoverState.UNUSED)).toBe(true);
    expect(v.headline).toBe('No chair has work today.');
  });

  it('says nothing about staffing when the attendance sheet has not been read', () => {
    // UNKNOWN is never a pass, and it is also not a failure to shout about.
    const v = view([slot()], undefined);
    expect(v.uncovered).toEqual([]);
    expect(v.rooms.find((r) => r.operatoryId === 'op-1')!.state)
      .toBe(CoverState.COVERED);
  });

  it('reports a room nobody was ever assigned to, separately from an absence', () => {
    const v = view([slot({ operatoryId: 'op-4' })], BOTH_HERE, [
      { operatoryId: 'op-4', assistantEmployeeCode: null, standInEmployeeCode: null },
    ]);
    expect(v.uncovered[0]!.because).toContain('no assistant is assigned to it');
  });
});

describe('one person cannot be in two rooms at once', () => {
  /**
   * The finding nothing else in KuBi could produce. Two assistants and four
   * rooms means somebody has two chairs, two chairs can run together, and
   * until the rooms had names against them there was nothing to compare.
   */
  it('finds the overlap, and says how long it is', () => {
    const v = view([
      slot({ id: 's1', patientLabel: 'Anita Rao', operatoryId: 'op-1',
        at: T(10, 0), endsAt: T(11, 30) }),
      slot({ id: 's2', patientLabel: 'Devika Nair', operatoryId: 'op-2',
        at: T(11, 0), endsAt: T(12, 0) }),
    ]);
    expect(v.clashes).toHaveLength(1);
    expect(v.clashes[0]!.assistantEmployeeCode).toBe('e1');
    expect(v.clashes[0]!.overlapMinutes).toBe(30);
    expect(v.clashes[0]!.because).toContain('Anita Rao and Devika Nair');
  });

  it('treats it as patient safety, not as a rota inconvenience', () => {
    // The second patient is in a chair with nobody at it. That is where a
    // swallowed instrument or an unmonitored sedation comes from.
    const v = view([
      slot({ id: 's1', operatoryId: 'op-1', at: T(10, 0), endsAt: T(11, 0) }),
      slot({ id: 's2', operatoryId: 'op-2', at: T(10, 30), endsAt: T(11, 0) }),
    ]);
    expect(v.findings[0]!.priority).toBe(ControlPriority.PS);
    expect(v.findings[0]!.what).toContain('two rooms at once');
  });

  it('says nothing when the two run back to back', () => {
    // Ending at eleven and starting at eleven is a busy day, not a clash.
    const v = view([
      slot({ id: 's1', operatoryId: 'op-1', at: T(10, 0), endsAt: T(11, 0) }),
      slot({ id: 's2', operatoryId: 'op-2', at: T(11, 0), endsAt: T(12, 0) }),
    ]);
    expect(v.clashes).toEqual([]);
  });

  it('says nothing when two overlapping cases are in the same room', () => {
    // Then the diary is wrong rather than the roster, and it is APT-001.c's
    // problem — one finding for one fault.
    const v = view([
      slot({ id: 's1', operatoryId: 'op-1', at: T(10, 0), endsAt: T(11, 0) }),
      slot({ id: 's2', operatoryId: 'op-1', at: T(10, 30), endsAt: T(11, 30) }),
    ]);
    expect(v.clashes).toEqual([]);
  });

  it('does not clash two different assistants', () => {
    const v = view([
      slot({ id: 's1', operatoryId: 'op-1', at: T(10, 0), endsAt: T(11, 0) }),
      slot({ id: 's2', operatoryId: 'op-3', at: T(10, 0), endsAt: T(11, 0) }),
    ]);
    expect(v.clashes).toEqual([]);
  });

  it('finds the clash the stand-in creates when somebody is away', () => {
    // The case that will actually happen: Nisha covers all four rooms because
    // both assistants are out, and now every pair overlaps.
    const v = view([
      slot({ id: 's1', operatoryId: 'op-1', at: T(10, 0), endsAt: T(11, 0) }),
      slot({ id: 's2', operatoryId: 'op-3', at: T(10, 0), endsAt: T(11, 0) }),
    ], new Set(['e6']));
    expect(v.clashes).toHaveLength(1);
    expect(v.clashes[0]!.assistantEmployeeCode).toBe('e6');
  });
});

describe('a swap is fine, and a swap nobody can see is not', () => {
  it('reports an appointment naming somebody other than the room’s assistant', () => {
    // A roster nobody can see the exceptions to is a roster that has stopped
    // describing the clinic.
    const v = view([slot({ operatoryId: 'op-1', namedAssistant: 'e2' })]);
    expect(v.overrides).toHaveLength(1);
    const finding = v.findings.find((f) => f.what.includes('names an assistant'))!;
    expect(finding.priority).toBe(ControlPriority.I);
    expect(finding.what).toContain('deliberate swap');
  });

  it('does not report a booking that simply agrees with the room', () => {
    const v = view([slot({ operatoryId: 'op-1', namedAssistant: 'e1' })]);
    expect(v.overrides).toEqual([]);
  });

  it('lets the named person carry the clash, not the room’s assistant', () => {
    // If Meera is covering Priya's ten o'clock as well as her own, the clash
    // is Meera's.
    const v = view([
      slot({ id: 's1', operatoryId: 'op-1', at: T(10, 0), endsAt: T(11, 0),
        namedAssistant: 'e2' }),
      slot({ id: 's2', operatoryId: 'op-3', at: T(10, 30), endsAt: T(11, 30) }),
    ]);
    expect(v.clashes).toHaveLength(1);
    expect(v.clashes[0]!.assistantEmployeeCode).toBe('e2');
  });

  it('says a patient with no room has no assistant either', () => {
    const v = view([slot({ operatoryId: null, patientLabel: 'Imran Shaikh' })]);
    expect(v.unplaced).toHaveLength(1);
    expect(v.findings.some((f) => f.what.includes('no operatory, so no assistant')))
      .toBe(true);
  });
});

describe('what each assistant is carrying', () => {
  it('counts rooms, appointments and chair minutes per person', () => {
    // The number that answers "is this fair" without anybody having to add it
    // up on paper at the end of the week.
    const v = view([
      slot({ id: 's1', operatoryId: 'op-1', at: T(10, 0), endsAt: T(11, 0) }),
      slot({ id: 's2', operatoryId: 'op-2', at: T(11, 30), endsAt: T(12, 0) }),
      slot({ id: 's3', operatoryId: 'op-3', at: T(10, 0), endsAt: T(10, 45) }),
    ]);
    const priya = v.load.find((l) => l.employeeCode === 'e1')!;
    expect(priya.rooms).toEqual(['op-1', 'op-2']);
    expect(priya.slots).toBe(2);
    expect(priya.bookedMinutes).toBe(90);

    const meera = v.load.find((l) => l.employeeCode === 'e2')!;
    expect(meera.slots).toBe(1);
    expect(meera.bookedMinutes).toBe(45);
  });

  it('shows somebody who is not in as carrying nothing', () => {
    const v = view([slot({ operatoryId: 'op-1' })], new Set(['e2', 'e6']));
    const priya = v.load.find((l) => l.employeeCode === 'e1')!;
    expect(priya.present).toBe(false);
    expect(priya.rooms).toEqual([]);
  });

  it('leads on the clash, then the uncovered room, then the quiet day', () => {
    expect(view([
      slot({ id: 's1', operatoryId: 'op-1', at: T(10, 0), endsAt: T(11, 0) }),
      slot({ id: 's2', operatoryId: 'op-2', at: T(10, 30), endsAt: T(11, 0) }),
    ]).headline).toContain('two rooms at once');

    expect(view([slot()], new Set(['e2'])).headline)
      .toContain('work and nobody to do it');

    expect(view([slot()]).headline).toBe('1 chair in use, all covered.');
  });

  it('names the columns the clinic’s sheet must carry', () => {
    expect(ASSIGNMENT_SHEET_COLUMNS).toEqual(
      ['date', 'operatory', 'assistant', 'stand_in']);
  });
});
