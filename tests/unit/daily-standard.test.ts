/**
 * The Daily Operating Standard, held to its own rules.
 *
 * A library of forty-seven non-negotiables is only worth having if something
 * stops it rotting: a role that no longer exists, a control reference that
 * points at nothing, a gap silently filled in, a KPI whose prose and whose
 * machine-readable target have drifted apart. Every one of those is invisible
 * on screen and fatal in an audit.
 */
import { describe, it, expect } from 'vitest';
import {
  DAILY_STANDARD, RHYTHM_ORDER, RHYTHM_LABEL, Rhythm, Proof, RoleCode,
  dayFor, theDay, openingGate, closingGate, unproven, ungoverned,
  proofMix, governingActivities, isKnownActivity, isGate,
} from '../../packages/contracts/src/index.js';

describe('the library is well formed', () => {
  it('holds the forty-seven the owner wrote, and no more', () => {
    expect(DAILY_STANDARD).toHaveLength(47);
  });

  it('gives every entry a unique id', () => {
    const ids = DAILY_STANDARD.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never lists the same task twice for the same role and moment', () => {
    // Flushing waterlines appears twice — before opening and at closing — and
    // that is correct. The same task at the same moment would be a slip.
    const keys = DAILY_STANDARD.map((s) => `${s.rhythm}|${s.role}|${s.task}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('assigns every non-negotiable to a role that actually exists', () => {
    const roles = new Set(Object.values(RoleCode));
    for (const s of DAILY_STANDARD) {
      expect(roles.has(s.role), `${s.id} is assigned to ${s.role}`).toBe(true);
    }
  });

  it('places every non-negotiable somewhere in the day', () => {
    for (const s of DAILY_STANDARD) {
      expect(RHYTHM_ORDER, `${s.id} has rhythm ${s.rhythm}`).toContain(s.rhythm);
    }
  });

  it('names every slot in words a person would say', () => {
    for (const r of RHYTHM_ORDER) {
      expect(RHYTHM_LABEL[r]).toBeTruthy();
      expect(RHYTHM_LABEL[r]).not.toBe(r);
    }
  });
});

describe('the day has a total order', () => {
  it('orders the seven slots without ties or gaps', () => {
    expect(new Set(RHYTHM_ORDER).size).toBe(RHYTHM_ORDER.length);
    expect(RHYTHM_ORDER.length).toBe(Object.keys(Rhythm).length);
  });

  it('opens before it closes', () => {
    expect(RHYTHM_ORDER.indexOf(Rhythm.BEFORE_OPENING))
      .toBeLessThan(RHYTHM_ORDER.indexOf(Rhythm.CLOSING));
  });

  it('treats only opening and closing as gates', () => {
    const gates = RHYTHM_ORDER.filter(isGate);
    expect(gates).toEqual([Rhythm.BEFORE_OPENING, Rhythm.CLOSING]);
  });

  it('gives each role its day in the order the day happens', () => {
    const priya = dayFor(RoleCode.DENTAL_ASSISTANT);
    expect(priya.length).toBeGreaterThan(0);
    const positions = priya.map((s) => RHYTHM_ORDER.indexOf(s.rhythm));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('accounts for every entry exactly once across the day', () => {
    const total = theDay().reduce((n, slot) => n + slot.items.length, 0);
    expect(total).toBe(DAILY_STANDARD.length);
  });
});

describe('nothing claims coverage it does not have', () => {
  it('points every `covers` at a real activity in the frozen matrix', () => {
    for (const id of governingActivities()) {
      expect(isKnownActivity(id), `${id} is not in the frozen matrix`).toBe(true);
    }
  });

  it('makes every ungoverned standard say what is missing', () => {
    // Constitution rule 4: a row with no value carries no value. An empty gap
    // would let "nothing governs this" read as "nothing needed".
    for (const s of ungoverned()) {
      expect(s.gap, `${s.id} has no control and no explanation`).toBeTruthy();
      expect((s.gap ?? '').length, `${s.id}'s gap is a stub`).toBeGreaterThan(20);
    }
  });

  it('makes every unprovable standard say why', () => {
    for (const s of unproven()) {
      expect(s.gap, `${s.id} cannot be proved and does not say why`).toBeTruthy();
    }
  });

  it('never marks something proved by the system that nothing governs and nothing holds', () => {
    // The one combination that would be a lie: KuBi claiming it already knows,
    // with no control behind it and no data to know it from.
    const liars = DAILY_STANDARD.filter(
      (s) => s.proof === Proof.SYSTEM && s.covers === null && !s.gap,
    );
    expect(liars).toEqual([]);
  });
});

describe('the standards and their targets agree', () => {
  it('reads the same percentage in the prose and in the target', () => {
    for (const s of DAILY_STANDARD) {
      const written = /(\d+)\s*%/.exec(s.standard);
      if (!written || s.target.kind !== 'PERCENT') continue;
      expect(Number(written[1]), `${s.id}: "${s.standard}"`).toBe(s.target.atLeast);
    }
  });

  it('reads the same number of minutes in the prose and in the target', () => {
    for (const s of DAILY_STANDARD) {
      const written = /(\d+)\s*minutes?/.exec(s.standard);
      if (!written || s.target.kind !== 'WITHIN_MINUTES') continue;
      expect(Number(written[1]), `${s.id}: "${s.standard}"`).toBe(s.target.minutes);
    }
  });

  it('uses a ZERO target wherever the standard says zero or none', () => {
    for (const s of DAILY_STANDARD) {
      if (!/^(zero|no )/i.test(s.standard)) continue;
      expect(s.target.kind, `${s.id}: "${s.standard}"`).toBe('ZERO');
    }
  });

  it('keeps the owner’s own wording rather than a paraphrase', () => {
    for (const s of DAILY_STANDARD) {
      expect(s.task.length, `${s.id} has an empty task`).toBeGreaterThan(8);
      expect(s.standard.length, `${s.id} has an empty standard`).toBeGreaterThan(3);
    }
  });
});

describe('the two journeys come out of the library, not out of a screen', () => {
  it('gives the opening gate the fourteen before-opening non-negotiables', () => {
    expect(openingGate()).toHaveLength(14);
    expect(openingGate().every((s) => s.rhythm === Rhythm.BEFORE_OPENING)).toBe(true);
  });

  it('gives the closing gate the thirteen closing non-negotiables', () => {
    expect(closingGate()).toHaveLength(13);
    expect(closingGate().every((s) => s.rhythm === Rhythm.CLOSING)).toBe(true);
  });

  it('spreads the opening across four roles, so no one person can open alone', () => {
    const roles = new Set(openingGate().map((s) => s.role));
    expect(roles.size).toBe(4);
  });

  it('never leaves a gate slot with nobody in it', () => {
    for (const slot of theDay()) {
      expect(slot.items.length, `${slot.label} is empty`).toBeGreaterThan(0);
    }
  });
});

describe('how much of the day rests on somebody’s word', () => {
  it('counts every entry exactly once in the proof mix', () => {
    const mix = proofMix();
    const total = Object.values(mix).reduce((a, b) => a + b, 0);
    expect(total).toBe(DAILY_STANDARD.length);
  });

  it('records the honest state today, so a change to it is deliberate', () => {
    // These are not targets. They are the measurement, written down so that
    // moving a standard from CONFIRMATION to SYSTEM is a visible event rather
    // than something that quietly happens or quietly does not.
    expect(proofMix()).toEqual({
      SYSTEM: 18, READING: 3, CONFIRMATION: 21, NOT_YET: 5,
    });
  });

  it('rests more of the day on somebody’s word than the system can prove itself', () => {
    // Stated as a fact about the product rather than as a pass mark: 21 of the
    // 47 non-negotiables close because a person says so, against 18 the system
    // knows on its own. That is the number that has to fall, and this test is
    // here so nobody can claim it has fallen without changing it.
    const mix = proofMix();
    expect(mix.CONFIRMATION).toBeGreaterThan(mix.SYSTEM);
    expect(mix.CONFIRMATION).toBe(21);
    expect(mix.SYSTEM).toBe(18);
  });

  it('cannot prove five of them at all today', () => {
    // Money (three), aseptic technique during a procedure, and backup.
    expect(unproven()).toHaveLength(5);
  });

  it('names seventeen non-negotiables with no control behind them', () => {
    expect(ungoverned()).toHaveLength(17);
  });

  it('shows housekeeping as the largest ungoverned cluster', () => {
    const byRole = new Map<string, number>();
    for (const s of ungoverned()) byRole.set(s.role, (byRole.get(s.role) ?? 0) + 1);
    const worst = [...byRole.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(worst?.[0]).toBe(RoleCode.HOUSEKEEPING);
    expect(worst?.[1]).toBe(6);
  });
});

describe('a proposal is not governance', () => {
  it('leaves every proposed standard ungoverned, and says so twice', () => {
    // The distinction this whole file turns on, and the one the tests caught
    // me blurring: pointing `covers` at a drafted control would have made ten
    // rows read as governed when nothing escalates and no KPI moves.
    const proposed = DAILY_STANDARD.filter((s) => s.proposed);
    expect(proposed.length).toBeGreaterThan(0);
    for (const s of proposed) {
      expect(s.covers, `${s.id} claims a frozen control`).toBeNull();
      expect(s.gap, `${s.id} is proposed but stops explaining the gap`).toBeTruthy();
    }
  });

  it('still counts them among the ungoverned', () => {
    expect(ungoverned().length).toBe(17);
    expect(ungoverned().filter((s) => s.proposed).length).toBe(10);
  });

  it('names a proposal that is not in the frozen matrix, deliberately', () => {
    for (const s of DAILY_STANDARD) {
      if (!s.proposed) continue;
      // If one of these ever passes, the matrix has been unfrozen and `covers`
      // should have been set instead.
      expect(isKnownActivity(s.proposed), `${s.proposed} is now frozen`).toBe(false);
    }
  });
});
