/**
 * The three behaviours the owner named for clinic opening.
 *
 *   *"The staff should not manually tick 'Clinic Ready.' KuBi calculates it:
 *   Clinic Ready = all mandatory opening controls passed."*
 *
 *   *"If OPEN-004 Dental Chair = FAIL, that chair becomes 🔴 NOT AVAILABLE
 *   FOR PATIENT ALLOCATION."*
 *
 * Plus OPEN-013, which is the first of those two written as a matrix row —
 * doer "System", evidence "Auto".
 *
 * These are behaviour tests rather than unit tests. Each one is written so it
 * fails if somebody later makes the obvious simplification: adding a
 * CLINIC_READY event because a screen wanted one, or letting a failed chair
 * raise a maintenance ticket and nothing else.
 */
import { describe, it, expect } from 'vitest';
import {
  ClinicEvent, readiness, equipment, roomAvailability,
  ASSETS, OPENING_CONTROLS, UNCOVERED_OPENING_CONTROLS, READY_IS_DERIVED_ONLY,
  AssetState, RoomState,
  type Operatory, type ReadinessEvent,
} from '@kubi/contracts';

const NOW = 9 * 60 + 15;
const ROOMS: Operatory[] = [1, 2, 3, 4].map((i) => ({
  id: `op-${i}`, label: `Operatory ${i}`, position: i,
}));

const ev = (type: string, subjectId: string, at = 8 * 60 + 50): ReadinessEvent =>
  ({ type: type as ClinicEvent, subjectId, at });

/** Everything the morning needs, reported. */
function allReported(): ReadinessEvent[] {
  const r = readiness([], ROOMS, 10 * 60, NOW);
  return r.blocks
    .filter((b) => b.mandatory)
    .map((b) => ev(b.completedBy, b.subjectId ?? ''));
}

/* ═══════════════════════════════════════════════════════════════════════ */

describe('OPEN-013 · nobody ticks "Clinic Ready"', () => {
  it('has no event that could record it', () => {
    // Enforced by absence, the way BLOCK_HARD gates are. There is no thing to
    // record, so no permission can be granted to record it and no screen can
    // offer a button. This is the assertion that would fail if somebody added
    // one in good faith to make a screen simpler.
    const names = Object.keys(ClinicEvent);
    expect(names.filter((n) => /CLINIC_READY|READINESS_CONFIRMED|MARK_READY/.test(n)))
      .toEqual([]);
    expect(READY_IS_DERIVED_ONLY).toBe(true);
  });

  it('calculates ready from the mandatory blocks, and nothing else', () => {
    expect(readiness([], ROOMS, 10 * 60, NOW).ready).toBe(false);
    expect(readiness(allReported(), ROOMS, 10 * 60, NOW).ready).toBe(true);
  });

  it('goes back to not-ready if a block is removed, with no un-tick required', () => {
    // The property that makes it a calculation rather than a stored flag.
    const all = allReported();
    const minusOne = all.slice(0, -1);
    expect(readiness(minusOne, ROOMS, 10 * 60, NOW).ready).toBe(false);
  });

  it('is recorded in the matrix as derived, with no doer', () => {
    expect(OPENING_CONTROLS['OPEN-013']?.covers).toBe('DERIVED');
    expect(UNCOVERED_OPENING_CONTROLS).not.toContain('OPEN-013');
  });

  it('refuses to call an unconfigured clinic ready', () => {
    // Nothing to check is not the same as everything checked. An empty
    // operatory master is a question nobody answered.
    const r = readiness([], [], 10 * 60, NOW);
    expect(r.ready).toBe(false);
    expect(r.unconfigured).toHaveLength(1);
  });
});

describe('OPEN-004 · a failed chair withdraws its room', () => {
  const fail = (tag: string): ReadinessEvent[] =>
    [ev(ClinicEvent.ASSET_FAILED, tag, 8 * 60 + 30)];

  it('takes Operatory 3 out of allocation when its chair is down', () => {
    // The rule the owner stated, and the one thing the register could not do
    // before: a down chair produced a ticket and left the room bookable.
    const v = equipment(ASSETS, fail('CHAIR-03'), NOW);
    const rooms = roomAvailability(ROOMS, v);
    const three = rooms.rooms.find((r) => r.operatoryId === 'op-3')!;

    expect(three.available).toBe(false);
    expect(three.state).toBe(RoomState.WITHDRAWN);
    expect(three.because).toContain('NOT AVAILABLE FOR PATIENT ALLOCATION');
    expect(three.blockedBy.map((b) => b.asset.tag)).toEqual(['CHAIR-03']);
  });

  it('leaves the other three rooms alone', () => {
    // One failure, one room. A chair failure that shut the clinic would be
    // just as wrong as one that shut nothing.
    const v = equipment(ASSETS, fail('CHAIR-03'), NOW);
    const rooms = roomAvailability(ROOMS, v);
    expect(rooms.unavailable.map((r) => r.operatoryId)).toEqual(['op-3']);
  });

  it('gives the room back when the chair is restored, with nothing to un-tick', () => {
    const events = [
      ...fail('CHAIR-03'),
      ev(ClinicEvent.ASSET_RESTORED, 'CHAIR-03', 9 * 60),
    ];
    const rooms = roomAvailability(ROOMS, equipment(ASSETS, events, NOW));
    expect(rooms.unavailable).toEqual([]);
  });

  it('does not withdraw a room for kit you can carry in from next door', () => {
    // A curing light lives in Operatory 2 and does not hold it. This is the
    // distinction the register had no field for, and without it a lapsed
    // radiometer reading was shutting an operatory.
    const v = equipment(ASSETS, fail('CURE-02'), NOW);
    expect(v.down.map((r) => r.asset.tag)).toContain('CURE-02');
    expect(roomAvailability(ROOMS, v).unavailable).toEqual([]);
  });

  it('separates where a thing lives from what its failure stops', () => {
    const cure = ASSETS.find((a) => a.tag === 'CURE-02')!;
    const chair = ASSETS.find((a) => a.tag === 'CHAIR-02')!;
    expect(cure.location).toBe('Operatory 2');
    expect(cure.holdsRoom).toBeNull();
    expect(chair.location).toBe('Operatory 2');
    expect(chair.holdsRoom).toBe('Operatory 2');
  });

  it('does not call a trolley an orphan', () => {
    // The scanner is mobile and declares no room. That is correct, not a
    // broken link — the first version reported it as a fault every morning.
    const links = roomAvailability(ROOMS, equipment(ASSETS, [], NOW));
    expect(links.orphaned.map((r) => r.asset.tag)).not.toContain('SCANNER-01');
  });

  it('does not shut every room because the register has never been filled in', () => {
    // The finding that produced the third state. With no service history at
    // all — the state a clinic is in on its first day with KuBi — a two-state
    // rule withdrew all four operatories at once. Nobody believes that, and a
    // flag nobody believes gets switched off before the day a chair fails.
    const links = roomAvailability(ROOMS, equipment(ASSETS, [], NOW));
    expect(links.unavailable).toEqual([]);
    expect(links.unverified.map((r) => r.operatoryId))
      .toEqual(['op-1', 'op-2', 'op-3', 'op-4']);
  });

  it('says which check has never been recorded, rather than implying it passed', () => {
    // UNKNOWN is never PASS. The room is open and the sentence says why it is
    // not a clean bill of health — the same distinction inventory draws
    // between "out of stock" and "never counted".
    const links = roomAvailability(ROOMS, equipment(ASSETS, [], NOW));
    const one = links.rooms.find((r) => r.operatoryId === 'op-1')!;
    expect(one.state).toBe(RoomState.UNVERIFIED);
    expect(one.available).toBe(true);
    expect(one.because).toContain('nobody has ever recorded');
    expect(one.unverified.map((r) => r.asset.tag)).toContain('XRAY-01');
  });

  it('withdraws a room for a lapsed blocking cycle, not only for a breakdown', () => {
    // "May not be used" and "is broken" are different states with the same
    // consequence. An X-ray on a licence that was recorded and then lapsed is
    // not a fault; it is illegal, and the room cannot take that patient.
    const lapsedLicence: ReadinessEvent[] = [
      // Recorded two years and a month ago, against a 730-day cycle.
      ev(ClinicEvent.ASSET_SERVICED, 'XRAY-02#AERB', NOW - 761 * 24 * 60),
    ];
    const links = roomAvailability(ROOMS, equipment(ASSETS, lapsedLicence, NOW));
    const two = links.rooms.find((r) => r.operatoryId === 'op-2')!;
    expect(two.state).toBe(RoomState.WITHDRAWN);
    expect(two.blockedBy.map((r) => r.asset.tag)).toContain('XRAY-02');
  });

  it('reports a chair pointing at a room that does not exist', () => {
    // The asset-to-room link is a string match, because that is what the
    // register holds, and a string match rots. A chair protecting no room has
    // to be visible as a broken link rather than as a room that is fine.
    const renamed: Operatory[] = ROOMS.map((r) =>
      r.id === 'op-3' ? { ...r, label: 'Surgery C' } : r);
    const links = roomAvailability(renamed, equipment(ASSETS, fail('CHAIR-03'), NOW));

    expect(links.unavailable.map((r) => r.operatoryId)).not.toContain('op-3');
    expect(links.orphaned.map((r) => r.asset.tag)).toContain('CHAIR-03');
  });

  it('says nothing is wrong when nothing is wrong', () => {
    const rooms = roomAvailability(ROOMS, {
      records: [], down: [], unusable: [], unserviced: [], tasks: [],
      checksDue: [], amcAction: [], downtimeMinutes: 0,
    });
    expect(rooms.unavailable).toEqual([]);
    expect(rooms.rooms.every((r) => r.state === RoomState.AVAILABLE)).toBe(true);
  });

  it('is derived — no event marks a room unavailable', () => {
    // Same rule as clinic readiness. If a room could be flagged by hand, the
    // flag and the chair would drift apart within a fortnight.
    expect(Object.keys(ClinicEvent).filter((n) => /ROOM_|OPERATORY_UNAVAIL/.test(n)))
      .toEqual([]);
  });
});

describe('the six opening controls still uncovered', () => {
  it('names them rather than letting them be forgotten', () => {
    // All six are one thing wearing six matrix rows: opening the building.
    // OPEN-012 used to be the seventh and never belonged with them — it was
    // patient safety, and it now has a block and an engine of its own.
    expect(UNCOVERED_OPENING_CONTROLS).toEqual([
      'OPEN-001', 'OPEN-007', 'OPEN-008', 'OPEN-009',
      'OPEN-010', 'OPEN-011',
    ]);
  });

  it('holds a reason for every control, covered or not', () => {
    for (const [id, v] of Object.entries(OPENING_CONTROLS)) {
      expect(v.why, `${id} has no reason recorded`).toBeTruthy();
    }
  });
});

describe('a failed asset is a state, not a task', () => {
  it('reads DOWN from the log rather than from a field', () => {
    const v = equipment(ASSETS, [
      { type: ClinicEvent.ASSET_FAILED, subjectId: 'CHAIR-01', at: 8 * 60 },
    ], NOW);
    expect(v.records.find((r) => r.asset.tag === 'CHAIR-01')!.state)
      .toBe(AssetState.DOWN);
  });
});
