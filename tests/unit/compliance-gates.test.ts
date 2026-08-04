/**
 * The compliance gates, held to the two rules that make them dangerous.
 *
 *   UNKNOWN is never PASS.            (ADR-013)
 *   BLOCK_HARD has no override path.  (ADR-004)
 *
 * Together those mean a gate switched on before KuBi can evaluate it refuses
 * everything, permanently. These tests exist to make sure that stays true —
 * the tempting bug is to let an unevaluable requirement "pass for now", and
 * that single line would let an implant surgery through with no consent on
 * file while the screen showed a green tick.
 */
import { describe, it, expect } from 'vitest';
import {
  COMPLIANCE_GATES, TREATMENT_GATES, EnforcementMode, EvaluationResult,
  evaluateGate, allRequirements, blockingToday, enforceableToday,
  missingForGates, gateCoverage,
} from '../../packages/contracts/src/index.js';

const gate = (n: number) => COMPLIANCE_GATES.find((g) => g.number === n)!;

describe('the gates are well formed', () => {
  it('holds the seventeen universal gates and twelve treatment sets', () => {
    expect(COMPLIANCE_GATES).toHaveLength(17);
    expect(TREATMENT_GATES).toHaveLength(12);
  });

  it('numbers them one to seventeen, in order, with no gaps', () => {
    expect(COMPLIANCE_GATES.map((g) => g.number)).toEqual(
      Array.from({ length: 17 }, (_, i) => i + 1),
    );
  });

  it('gives every requirement a unique id across both sets', () => {
    const ids = allRequirements().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves no gate without requirements or without a reason to refuse', () => {
    for (const g of COMPLIANCE_GATES) {
      expect(g.requirements.length, `${g.id} has no requirements`).toBeGreaterThan(0);
      expect(g.blockIf.length, `${g.id} refuses without saying why`).toBeGreaterThan(0);
    }
  });

  it('says what is missing for every requirement it cannot evaluate', () => {
    for (const r of allRequirements()) {
      if (r.evaluable) {
        expect(r.needs, `${r.label} is evaluable but claims something is missing`).toBeNull();
      } else {
        expect(r.needs, `${r.label} cannot be evaluated and does not say why`).toBeTruthy();
      }
    }
  });
});

describe('every gate is BLOCK_HARD, and that is not negotiable', () => {
  it('enforces hard, with no override mode anywhere', () => {
    for (const g of COMPLIANCE_GATES) {
      expect(g.enforcement, `${g.id}`).toBe(EnforcementMode.BLOCK_HARD);
    }
  });

  it('offers no override on the verdict at all', () => {
    // ADR-004: enforced by the absence of a path, not by a runtime check.
    // If an override ever appears it will appear here first.
    const v = evaluateGate(gate(7));
    expect(Object.keys(v)).not.toContain('override');
    expect(Object.keys(v)).not.toContain('canOverride');
  });
});

describe('UNKNOWN is never PASS', () => {
  it('refuses a gate with an unevaluable requirement even when everything is satisfied', () => {
    // The whole file in one test. Gate 3 is medical safety: eleven of its
    // twelve requirements need a medical history KuBi does not hold.
    const everything = new Set(allRequirements().map((r) => r.id));
    const v = evaluateGate(gate(3), everything);
    expect(v.verdict).toBe(EvaluationResult.FAIL);
    expect(v.failed).toEqual([]);          // nothing failed
    expect(v.unknown.length).toBeGreaterThan(0);  // it refuses on UNKNOWN alone
  });

  it('passes only when every requirement is evaluable and satisfied', () => {
    // No gate is fully evaluable today — enforceableToday() is empty, and the
    // test below asserts that. So PASS is demonstrated against a gate reduced
    // to the requirements KuBi can actually decide, which is what gate 8 will
    // look like once the four fields behind it exist.
    const g8 = gate(8);
    const reduced = { ...g8, requirements: g8.requirements.filter((r) => r.evaluable) };
    const all = new Set(reduced.requirements.map((r) => r.id));
    expect(evaluateGate(reduced, all).verdict).toBe(EvaluationResult.PASS);
    // One short is enough to refuse.
    const short = new Set([...all].slice(1));
    expect(evaluateGate(reduced, short).verdict).toBe(EvaluationResult.FAIL);
  });

  it('separates what the clinic can fix from what the product must build', () => {
    const v = evaluateGate(gate(8));
    // Failed = evaluable and not done. Unknown = KuBi cannot tell.
    expect(v.failed.every((r) => r.evaluable)).toBe(true);
    expect(v.unknown.every((r) => !r.evaluable)).toBe(true);
    expect(v.failed.length + v.unknown.length + v.passed.length)
      .toBe(gate(8).requirements.length);
  });

  it('always carries the owner’s own refusal wording to whoever is stopped', () => {
    // A gate that refuses without saying which requirement refused is the
    // thing that makes staff hate compliance software.
    for (const g of COMPLIANCE_GATES) {
      expect(evaluateGate(g).blockIf).toEqual(g.blockIf);
    }
  });
});

describe('what switching these on today would actually do', () => {
  it('records the honest state, so a change to it is deliberate', () => {
    expect(gateCoverage()).toEqual({
      gates: 17, treatmentGates: 12, requirements: 181, evaluable: 46, enforceable: 0,
    });
  });

  it('would block every single gate, with the clinic doing everything right', () => {
    // Not a criticism of the gates. The gates are correct and the data is
    // absent, and this is the number that has to move.
    expect(blockingToday()).toHaveLength(17);
    expect(enforceableToday()).toEqual([]);
  });

  it('orders the missing capabilities worst-first, so the biggest unlock is top', () => {
    const missing = missingForGates();
    const counts = missing.map((m) => m.requirements.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(counts[0]).toBeGreaterThan(5);
  });

  it('cannot evaluate a single requirement of the financial gate', () => {
    expect(gate(6).requirements.every((r) => !r.evaluable)).toBe(true);
  });

  it('can evaluate most of pre-operative safety, which is the encouraging one', () => {
    // Sterility, equipment, emergency drugs and oxygen are all things KuBi
    // already tracks. Gate 8 is the closest to switchable.
    const evaluable = gate(8).requirements.filter((r) => r.evaluable);
    expect(evaluable.length).toBeGreaterThan(gate(8).requirements.length / 2);
  });
});

describe('treatment gates sit on top of the universal ones', () => {
  it('names a treatment and requirements for each', () => {
    for (const t of TREATMENT_GATES) {
      expect(t.treatment.length).toBeGreaterThan(3);
      expect(t.requirements.length).toBeGreaterThan(3);
    }
  });

  it('never repeats a universal gate’s requirement id', () => {
    const universal = new Set(COMPLIANCE_GATES.flatMap((g) => g.requirements.map((r) => r.id)));
    for (const t of TREATMENT_GATES) {
      for (const r of t.requirements) {
        expect(universal.has(r.id), `${t.treatment} reuses ${r.id}`).toBe(false);
      }
    }
  });

  it('gives implant surgery the most, as the highest-risk procedure', () => {
    const sizes = TREATMENT_GATES.map((t) => ({ t: t.treatment, n: t.requirements.length }))
      .sort((a, b) => b.n - a.n);
    expect(sizes[0]?.t).toBe('Implant surgery');
  });
});
