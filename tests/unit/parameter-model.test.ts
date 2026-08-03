/**
 * The five layers.
 *
 * A dependency graph and a weighting scheme are the kind of thing that looks
 * right in a document and is quietly wrong in code — a cycle, a class that
 * sums to 97, a parameter that outranks the thing it depends on. These are the
 * assertions that make the model load-bearing rather than decorative.
 */
import { describe, it, expect } from 'vitest';
import {
  PARAMETER_SPEC, CLASS_WEIGHT, EVIDENCE_CONFIDENCE, WeightClass, HealthTrend,
  DECISION_REQUIRED, dependents, upstreamOf, weightOf, attainableWeight, unattainableClasses,
  Parameter, RoleCode, EvidenceType,
} from '../../packages/contracts/src/index.js';

const ALL = Object.keys(PARAMETER_SPEC) as Parameter[];

describe('layer 1 — the dependency graph', () => {
  it('covers all sixteen parameters', () => {
    expect(ALL).toHaveLength(16);
    expect(new Set(ALL)).toEqual(new Set(Object.values(Parameter)));
  });

  it('has no cycles', () => {
    // A cycle makes "is this parameter blocked" unanswerable, and would hang
    // any naive walk of the graph.
    for (const p of ALL) {
      expect(upstreamOf(p), `${p} depends on itself`).not.toContain(p);
    }
  });

  it('only ever depends on real parameters', () => {
    for (const p of ALL) {
      for (const d of PARAMETER_SPEC[p].dependsOn) {
        expect(ALL, `${p} depends on unknown ${d}`).toContain(d);
      }
    }
  });

  it('carries the spine the owner drew', () => {
    // opening → room → journey → documentation → experience
    const experience = upstreamOf(Parameter.FOLLOWUP_EXPERIENCE);
    expect(experience).toContain(Parameter.CLINICAL_DOCUMENTATION);
    expect(experience).toContain(Parameter.PATIENT_JOURNEY);
    expect(experience).toContain(Parameter.ROOM_CHAIR_READINESS);
    expect(experience).toContain(Parameter.OPENING_READINESS);
  });

  it('makes a ready room depend on sterile kit and stock, not just cleaning', () => {
    // A clean chair with no sterile instruments is not a ready room. This join
    // is the difference between a graph that describes the clinic and one that
    // describes a tidy diagram.
    const deps = PARAMETER_SPEC[Parameter.ROOM_CHAIR_READINESS].dependsOn;
    expect(deps).toContain(Parameter.INFECTION_CONTROL);
    expect(deps).toContain(Parameter.INVENTORY_IMPLANTS);
  });

  it('keeps quality independent, so the loop runs when everything else fails', () => {
    expect(PARAMETER_SPEC[Parameter.QUALITY_CAPA].dependsOn).toEqual([]);
  });

  it('reports dependents as the inverse of dependencies', () => {
    for (const p of ALL) {
      for (const d of dependents(p)) {
        expect(PARAMETER_SPEC[d].dependsOn).toContain(p);
      }
    }
  });

  it('has at least one root and one leaf', () => {
    expect(ALL.some((p) => PARAMETER_SPEC[p].dependsOn.length === 0)).toBe(true);
    expect(ALL.some((p) => dependents(p).length === 0)).toBe(true);
  });
});

describe('layer 2 — weighting', () => {
  it('allocates exactly 100 across the five classes', () => {
    const total = Object.values(CLASS_WEIGHT).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it('matches the owner’s allocation', () => {
    expect(CLASS_WEIGHT).toEqual({
      PATIENT_SAFETY: 40, CLINICAL_QUALITY: 25,
      PATIENT_EXPERIENCE: 15, OPERATIONS: 10, BUSINESS: 10,
    });
  });

  it('splits each class evenly across its parameters, losing nothing to rounding', () => {
    // The rounding trap: parameters over classes must not lose or gain a
    // point, or every grade is slightly wrong forever.
    const total = ALL.reduce((sum, p) => sum + weightOf(p), 0);
    expect(total).toBeCloseTo(attainableWeight(), 10);
  });

  it('says out loud that ten points are not yet earnable by anybody', () => {
    // BUSINESS has no parameters until Phase 4. Redistributing the ten would
    // make a clinic's score jump on a release day with nothing changed at the
    // clinic; hiding it would cap everyone at 90 and make a "90 for Gold"
    // threshold quietly unreachable. So the model reports both numbers.
    expect(unattainableClasses()).toEqual([WeightClass.BUSINESS]);
    expect(attainableWeight()).toBe(90);
  });

  it('does not let attendance equal sterilisation', () => {
    // The owner's actual question, as an assertion.
    expect(weightOf(Parameter.INFECTION_CONTROL))
      .toBeGreaterThan(weightOf(Parameter.ATTENDANCE_LEAVE));
  });

  it('gives every parameter a class that exists', () => {
    for (const p of ALL) {
      expect(Object.values(WeightClass)).toContain(PARAMETER_SPEC[p].weightClass);
    }
  });

  it('leaves the BUSINESS class empty for now, and says so by arithmetic', () => {
    // No parameter is business yet — Business Growth is Phase 4. The class
    // exists so its 10 points are reserved rather than redistributed, which
    // would make today's grades incomparable with tomorrow's.
    const business = ALL.filter((p) => PARAMETER_SPEC[p].weightClass === WeightClass.BUSINESS);
    expect(business).toHaveLength(0);
  });
});

describe('layer 3 — evidence confidence', () => {
  it('scores every evidence type', () => {
    for (const t of Object.values(EvidenceType)) {
      expect(EVIDENCE_CONFIDENCE[t], `${t} has no confidence`).toBeGreaterThan(0);
    }
  });

  it('ranks a system record above a ticked box', () => {
    expect(EVIDENCE_CONFIDENCE.SYSTEM).toBeGreaterThan(EVIDENCE_CONFIDENCE.CONFIRMATION);
  });

  it('ranks a second pair of eyes above one person’s signature', () => {
    expect(EVIDENCE_CONFIDENCE.VERIFICATION).toBeGreaterThan(EVIDENCE_CONFIDENCE.SIGNATURE);
  });

  it('never awards full confidence to anything a human types', () => {
    for (const t of ['CONFIRMATION', 'VALUE', 'ATTACHMENT', 'SIGNATURE'] as const) {
      expect(EVIDENCE_CONFIDENCE[t]).toBeLessThan(100);
    }
  });
});

describe('layer 4 — ownership', () => {
  it('gives every parameter exactly one owner, or an open decision', () => {
    for (const p of ALL) {
      const owner = PARAMETER_SPEC[p].owner;
      const ok = owner === DECISION_REQUIRED
        || Object.values(RoleCode).includes(owner as RoleCode);
      expect(ok, `${p} has owner "${owner}"`).toBe(true);
    }
  });

  it('does not invent an owner where the frozen matrix is split', () => {
    // Team & coordination is split three ways across three activities —
    // Clinic Head, Owner, and "Owner/Clinic Head". That is an unmade decision,
    // not a plurality, and non-negotiable 4 says it stays one.
    expect(PARAMETER_SPEC[Parameter.STAFF_CONDUCT].owner).toBe(DECISION_REQUIRED);
  });

  it('puts clinical parameters under a clinical owner', () => {
    for (const p of [
      Parameter.INFECTION_CONTROL, Parameter.PATIENT_JOURNEY,
      Parameter.CLINICAL_DOCUMENTATION, Parameter.SURGICAL_HIGH_RISK,
    ]) {
      expect(PARAMETER_SPEC[p].owner).toBe(RoleCode.CLINICAL_DIRECTOR);
    }
  });
});

describe('layer 5 — health and trend', () => {
  it('keeps “declining” and “needs intervention” separate', () => {
    // A trend is an observation; an intervention is a verdict. Collapsing them
    // means the system decides when to escalate by arithmetic alone.
    expect(HealthTrend.DECLINING).not.toBe(HealthTrend.NEEDS_INTERVENTION);
  });

  it('has a value for “not enough history”, which is not STABLE', () => {
    // Non-negotiable 2 applied to trend: two days of data is not stability.
    expect(HealthTrend.UNKNOWN).toBeDefined();
    expect(HealthTrend.UNKNOWN).not.toBe(HealthTrend.STABLE);
  });
});
