/**
 * Contract invariants. These encode owner controls 5, 6 and 8 as executable
 * assertions so a future edit that weakens them fails CI rather than shipping.
 */
import { describe, it, expect } from 'vitest';
import {
  EvaluationResult, EnforcementMode, ENFORCEMENT_MATRIX, resolveComposite,
  IMMUTABLE_BLOCK_HARD_GATES, ROLES_DENIED_CLINICAL_AUTHORITY, RoleCode,
  ActorRefKind, ENUM_REGISTER, COMPETENCY_RANK, CompetencyLevel,
} from '../../packages/contracts/src/index.js';

describe('AP-1 — UNKNOWN and NOT_CONFIGURED never become PASS (owner control 5)', () => {
  it('never yields PROCEED for UNKNOWN under any enforcement mode', () => {
    for (const mode of Object.values(EnforcementMode)) {
      expect(ENFORCEMENT_MATRIX[mode].UNKNOWN).not.toBe('PROCEED');
      expect(ENFORCEMENT_MATRIX[mode].NOT_CONFIGURED).not.toBe('PROCEED');
    }
  });

  it('treats UNKNOWN at least as strictly as FAIL in every mode', () => {
    const strictness = { PROCEED: 0, WARN: 1, BLOCK_OVERRIDABLE: 2, BLOCK_HARD: 3 } as const;
    for (const mode of Object.values(EnforcementMode)) {
      const row = ENFORCEMENT_MATRIX[mode];
      expect(strictness[row.UNKNOWN]).toBeGreaterThanOrEqual(strictness[row.FAIL]);
      expect(strictness[row.NOT_CONFIGURED]).toBeGreaterThanOrEqual(strictness[row.FAIL]);
    }
  });

  it('BLOCK_HARD is non-overridable for FAIL, UNKNOWN and NOT_CONFIGURED (control 9)', () => {
    const hard = ENFORCEMENT_MATRIX.BLOCK_HARD;
    expect(hard.FAIL).toBe('BLOCK_HARD');
    expect(hard.UNKNOWN).toBe('BLOCK_HARD');
    expect(hard.NOT_CONFIGURED).toBe('BLOCK_HARD');
  });

  it('has exactly five evaluation outcomes', () => {
    expect(Object.keys(EvaluationResult).sort()).toEqual(
      ['FAIL', 'NOT_APPLICABLE', 'NOT_CONFIGURED', 'PASS', 'UNKNOWN'].sort(),
    );
  });
});

describe('Composite gates resolve to their worst member', () => {
  it('one UNKNOWN member makes the composite UNKNOWN', () => {
    expect(resolveComposite(['PASS', 'PASS', 'UNKNOWN'])).toBe('UNKNOWN');
  });
  it('FAIL dominates UNKNOWN', () => {
    expect(resolveComposite(['UNKNOWN', 'FAIL'])).toBe('FAIL');
  });
  it('NOT_CONFIGURED does not become PASS', () => {
    expect(resolveComposite(['PASS', 'NOT_CONFIGURED'])).toBe('NOT_CONFIGURED');
  });
  it('an empty member set is NOT_CONFIGURED, never PASS', () => {
    expect(resolveComposite([])).toBe('NOT_CONFIGURED');
  });
  it('all-PASS passes', () => {
    expect(resolveComposite(['PASS', 'NOT_APPLICABLE', 'PASS'])).toBe('PASS');
  });
});

describe('Authority separation (owner controls 6 and 8)', () => {
  it('SYSTEM_ADMINISTRATOR can never hold clinical authority', () => {
    expect(ROLES_DENIED_CLINICAL_AUTHORITY).toContain(RoleCode.SYSTEM_ADMINISTRATOR);
  });
  it('keeps role, record-relation and functional assignment distinct', () => {
    expect(Object.keys(ActorRefKind).sort()).toEqual(
      ['EXTERNAL', 'FUNCTIONAL_ASSIGNMENT', 'RECORD_RELATION', 'ROLE', 'SYSTEM'].sort(),
    );
  });
  it('declares the 13 canonical roles from FRS §3', () => {
    expect(Object.keys(RoleCode)).toHaveLength(13);
  });
});

describe('Immutable hard gates (owner control 9)', () => {
  it('lists the four structurally non-overridable gates', () => {
    expect([...IMMUTABLE_BLOCK_HARD_GATES]).toEqual(['G-05', 'G-07', 'G-14', 'G-15']);
  });
});

describe('Register completeness', () => {
  it('registers every enum for drift detection', () => {
    expect(Object.keys(ENUM_REGISTER).length).toBeGreaterThanOrEqual(31);
  });
  it('ranks competency so higher satisfies lower (G-09)', () => {
    expect(COMPETENCY_RANK[CompetencyLevel.INDEPENDENT]).toBeGreaterThan(
      COMPETENCY_RANK[CompetencyLevel.SUPERVISED],
    );
    expect(COMPETENCY_RANK[CompetencyLevel.NOT_TRAINED]).toBe(0);
  });
});
