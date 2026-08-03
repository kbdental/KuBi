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
  /**
   * The FRS §3 canon, verbatim. A role vanishing from here is a silent
   * requirements regression, which a bare length check would not have caught.
   */
  const FRS_ROLES = [
    'OWNER_DIRECTOR', 'CLINIC_HEAD', 'CLINICAL_DIRECTOR', 'TREATING_DOCTOR',
    'CLINIC_MANAGER', 'RECEPTION', 'SENIOR_ASSISTANT', 'DENTAL_ASSISTANT',
    'INVENTORY_COORDINATOR', 'LAB_COORDINATOR', 'QUALITY_COMPLIANCE',
    'HOUSEKEEPING', 'SYSTEM_ADMINISTRATOR',
  ];

  /**
   * Roles added beyond the FRS, each a deliberate, dated decision. Adding a
   * row here is the amendment; adding a role without one fails the test below.
   *
   * STERILIZATION_TECHNICIAN — owner scope, 3 August 2026. Phase 1 builds the
   * clinical workflow and named sterilisation as one of its five dashboards.
   * The role is not cosmetic: "an operator may not release their own batch" is
   * a separation-of-duties gate, and a gate needs a role to hang on rather
   * than a person's name. Pending: FRS §3 amendment.
   */
  const ADDED_BEYOND_FRS = ['STERILIZATION_TECHNICIAN'];

  it('still declares all 13 canonical roles from FRS §3', () => {
    expect(Object.keys(RoleCode)).toEqual(expect.arrayContaining(FRS_ROLES));
  });

  it('adds no role beyond the FRS without a recorded decision', () => {
    // Non-negotiable 4: never silently resolve an open requirements question.
    // A new role that nobody decided on would otherwise arrive as a passing
    // test and a bumped number.
    const extra = Object.keys(RoleCode).filter((r) => !FRS_ROLES.includes(r));
    expect(extra.sort()).toEqual([...ADDED_BEYOND_FRS].sort());
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
