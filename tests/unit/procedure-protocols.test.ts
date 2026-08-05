/**
 * The procedure protocols, and the thing that makes them different.
 *
 * The other five libraries are sets. This one is a sequence, and the tests
 * are about order: that a protocol has a position on it, that the runner
 * returns the *next* step rather than a list, and that work done out of
 * sequence is recorded rather than silently accepted or silently dropped.
 *
 * Recording an insertion torque before the implant is placed is not untidy.
 * It is a record that reads correctly and is false.
 */
import { describe, it, expect } from 'vitest';
import {
  PROCEDURE_PROTOCOLS, UNIVERSAL_PROTOCOL, PHASE_ORDER, Phase, RoleCode,
  procedures, stepsFor, protocolOf, runProtocol, phaseOf,
  protocolCoverage, protocolNeedsOwner,
} from '../../packages/contracts/src/index.js';

describe('the library is well formed', () => {
  it('holds seventeen protocols and their 164 steps', () => {
    // Seventeen, not the owner's sixteen: section 3 covered radiographs and
    // CBCT under one heading, and they are two protocols with two triggers.
    expect(procedures()).toHaveLength(17);
    expect(PROCEDURE_PROTOCOLS).toHaveLength(164);
  });

  it('keeps the ten universal rules separate rather than copied into all sixteen', () => {
    // Duplicating them 160 times is how a library rots.
    expect(UNIVERSAL_PROTOCOL).toHaveLength(10);
    const universalTasks = new Set(UNIVERSAL_PROTOCOL.map((u) => u.task));
    for (const s of PROCEDURE_PROTOCOLS) {
      expect(universalTasks.has(s.task), `${s.id} duplicates a universal rule`).toBe(false);
    }
  });

  it('gives every step a unique id', () => {
    const ids = PROCEDURE_PROTOCOLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives implant surgery the longest protocol, at twenty-five steps', () => {
    const longest = procedures()
      .map((p) => ({ p, n: stepsFor(p).length }))
      .sort((a, b) => b.n - a.n)[0];
    expect(longest?.p).toBe('Implant surgery');
    expect(longest?.n).toBe(25);
  });
});

describe('a protocol is a sequence, not a set', () => {
  it('numbers every step within its procedure, from one, without gaps', () => {
    for (const p of procedures()) {
      const orders = stepsFor(p).map((s) => s.order);
      expect(orders, p).toEqual(Array.from({ length: orders.length }, (_, i) => i + 1));
    }
  });

  it('never runs a phase backwards inside a procedure', () => {
    // Before cannot follow During, and During cannot follow After. The order
    // is clinical: recording insertion torque before placement is impossible.
    for (const p of procedures()) {
      const positions = stepsFor(p).map((s) => PHASE_ORDER.indexOf(s.phase));
      expect(positions, p).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it('groups each procedure into its phases, in order, dropping empty ones', () => {
    const implant = protocolOf('Implant surgery');
    expect(implant.map((x) => x.label)).toEqual(['Before', 'During', 'After']);
    expect(implant.map((x) => x.steps.length)).toEqual([9, 10, 6]);
  });

  it('reads a phase off the condition verb only where the owner gave no heading', () => {
    expect(phaseOf('Extraction advised')).toBe(Phase.BEFORE);
    expect(phaseOf('Filling started')).toBe(Phase.DURING);
    expect(phaseOf('Scaling completed')).toBe(Phase.AFTER);
    // And the flag records which is which, so an inferred phase never passes
    // as a clinical decision somebody made.
    const stated = PROCEDURE_PROTOCOLS.filter((s) => s.phaseStated);
    expect(stated.length).toBeGreaterThan(0);
    expect(stated.length).toBeLessThan(PROCEDURE_PROTOCOLS.length);
  });
});

describe('running a protocol', () => {
  it('returns the next step, not a list', () => {
    const r = runProtocol('Implant surgery');
    expect(r.next?.task).toBe('Implant informed consent');
    expect(r.phase).toBe(Phase.BEFORE);
    expect(r.doneCount).toBe(0);
    expect(r.totalCount).toBe(25);
  });

  it('moves on as steps are completed, in order', () => {
    const steps = stepsFor('Extraction');
    const done = new Set(steps.slice(0, 7).map((s) => s.id));
    const r = runProtocol('Extraction', done);
    expect(r.doneCount).toBe(7);
    expect(r.next?.task).toBe('Anaesthetic recording');
    expect(r.phase).toBe(Phase.DURING);
    expect(r.outOfOrder).toEqual([]);
  });

  it('finishes cleanly, with nothing next', () => {
    const steps = stepsFor('Composite filling');
    const r = runProtocol('Composite filling', new Set(steps.map((s) => s.id)));
    expect(r.next).toBeNull();
    expect(r.phase).toBeNull();
    expect(r.remaining).toEqual([]);
    expect(r.doneCount).toBe(r.totalCount);
  });

  it('records work done out of order rather than rejecting or hiding it', () => {
    // A clinic working around the protocol is telling you something about the
    // protocol. Refusing is the gate's job; the runner notices and reports.
    const steps = stepsFor('Implant surgery');
    const torque = steps.find((s) => s.task === 'Record insertion torque')!;
    const r = runProtocol('Implant surgery', new Set([torque.id]));
    expect(r.outOfOrder.map((s) => s.task)).toEqual(['Record insertion torque']);
    expect(r.next?.task).toBe('Implant informed consent');
    // It still counts as done — the evidence is not discarded.
    expect(r.doneCount).toBe(1);
  });

  it('is pure, so the same procedure and the same ticks give the same run', () => {
    const done = new Set(stepsFor('Extraction').slice(0, 3).map((s) => s.id));
    expect(runProtocol('Extraction', done)).toEqual(runProtocol('Extraction', done));
  });

  it('gives an unknown procedure an empty run rather than throwing', () => {
    const r = runProtocol('Tooth whitening');
    expect(r.totalCount).toBe(0);
    expect(r.next).toBeNull();
  });
});

describe('what the clinic still has to decide', () => {
  it('records the honest state, so a change to it is deliberate', () => {
    expect(protocolCoverage()).toEqual({
      procedures: 17, steps: 164, universal: 10, owned: 8, phaseStated: 96,
    });
  });

  it('keeps the owner’s assignments on protocol one, and invents none elsewhere', () => {
    const first = stepsFor('New patient consultation');
    expect(first).toHaveLength(8);
    expect(first.every((s) => s.role !== null)).toBe(true);
    expect(first.every((s) => s.mandatory === true)).toBe(true);
    expect(stepsFor('Implant surgery').every((s) => s.role === null)).toBe(true);
    expect(stepsFor('Implant surgery').every((s) => s.mandatory === null)).toBe(true);
  });

  it('assigns only roles that exist, where one is assigned at all', () => {
    const roles = new Set(Object.values(RoleCode));
    for (const s of PROCEDURE_PROTOCOLS) {
      if (s.role === null) continue;
      expect(roles.has(s.role), `${s.id} is assigned to ${s.role}`).toBe(true);
    }
  });

  it('has 156 steps with nobody assigned', () => {
    expect(protocolNeedsOwner()).toHaveLength(156);
  });
});
