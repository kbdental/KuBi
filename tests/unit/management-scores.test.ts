/**
 * §7 — the eight management scores.
 *
 * Sixteen control parameters roll upward into eight numbers an owner reads.
 * The assertions that matter are about GREY: a parameter with nothing to
 * measure must be excluded, never averaged in as a zero. Every dashboard that
 * gets this wrong is quietly lying on quiet days.
 */
import { describe, it, expect } from 'vitest';
import {
  SCORE_SPEC, SCORE_ORDER, ManagementScore, Outcome,
  outcomeOf, rollUp, operationalScore, scoreFor,
  Parameter,
} from '../../packages/contracts/src/index.js';

const ALL_PARAMS = Object.values(Parameter);

describe('the eight scores', () => {
  it('are eight, and are the eight in the specification table', () => {
    expect(SCORE_ORDER).toHaveLength(8);
    expect(SCORE_ORDER.map((s) => SCORE_SPEC[s].label)).toEqual([
      'Clinic readiness', 'Patient care compliance', 'Clinical documentation',
      'Infection control', 'Appointment efficiency', 'Lab efficiency',
      'Inventory readiness', 'Team compliance',
    ]);
  });

  it('each carries how it is measured, in the owner’s words', () => {
    for (const s of SCORE_ORDER) {
      expect(SCORE_SPEC[s].measure, `${s} has no measure`).toBeTruthy();
    }
    expect(SCORE_SPEC.LAB_EFFICIENCY.measure).toMatch(/remakes/i);
    expect(SCORE_SPEC.CLINIC_READINESS.measure).toMatch(/before first patient/i);
  });

  it('rolls every control parameter into exactly one score', () => {
    // A parameter in no score is unmanaged; a parameter in two is
    // double-counted, which quietly weights it more than the owner asked.
    for (const p of ALL_PARAMS) {
      const owning = SCORE_ORDER.filter((s) => SCORE_SPEC[s].parameters.includes(p));
      expect(owning.length, `${p} rolls into ${owning.length} scores`).toBe(1);
      expect(scoreFor(p)).toBe(owning[0]);
    }
  });

  it('accounts for all sixteen parameters and invents none', () => {
    const used = SCORE_ORDER.flatMap((s) => SCORE_SPEC[s].parameters);
    expect(new Set(used).size).toBe(16);
    for (const p of used) expect(ALL_PARAMS).toContain(p);
  });
});

describe('GREY is not zero', () => {
  it('excludes nothing-to-measure from a roll-up rather than averaging it in', () => {
    // 90 and 100 with one silence is 95, not 63.
    expect(rollUp([90, 100, null])).toBe(95);
  });

  it('returns null when there is nothing to measure at all', () => {
    expect(rollUp([null, null])).toBeNull();
    expect(rollUp([])).toBeNull();
    expect(operationalScore([null, null, null])).toBeNull();
  });

  it('scores null as GREY, never as a percentage', () => {
    expect(outcomeOf(null)).toBe(Outcome.GREY);
  });

  it('does not let a quiet day flatter the operational score', () => {
    // A clinic that ran one thing well is not a 100% clinic, but it is also
    // not a 12% clinic. Both errors come from the same mistake.
    expect(operationalScore([100, null, null, null])).toBe(100);
    expect(operationalScore([100, 60])).toBe(80);
  });
});

describe('outcome thresholds', () => {
  it('bands at 95 and 85', () => {
    expect(outcomeOf(96)).toBe(Outcome.GREEN);
    expect(outcomeOf(95)).toBe(Outcome.GREEN);
    expect(outcomeOf(94)).toBe(Outcome.AMBER);
    expect(outcomeOf(85)).toBe(Outcome.AMBER);
    expect(outcomeOf(84)).toBe(Outcome.RED);
  });

  it('forces RED on a patient-safety failure whatever the percentage says', () => {
    // 97% with an unverified autoclave cycle is not green. A threshold that
    // says otherwise is why people stop trusting dashboards.
    expect(outcomeOf(97, true)).toBe(Outcome.RED);
    expect(outcomeOf(100, true)).toBe(Outcome.RED);
  });

  it('still reports GREY rather than RED when there is nothing to measure', () => {
    expect(outcomeOf(null, false)).toBe(Outcome.GREY);
  });
});

describe('the four management outcomes', () => {
  it('are exactly four', () => {
    expect(Object.keys(Outcome).sort()).toEqual(['AMBER', 'GREEN', 'GREY', 'RED']);
  });
});

describe('score identity', () => {
  it('names every score in the enum and in the order', () => {
    expect(new Set(SCORE_ORDER)).toEqual(new Set(Object.values(ManagementScore)));
  });
});
