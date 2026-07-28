/**
 * KuBi — clinical authority evaluation. Phase 0 §09 / owner controls 6, 8.
 *
 * Clinical authority is queried, never inferred. A missing row is a definite,
 * expected answer ("this employee does not hold clinical authority") — most
 * staff never will, and that is correct, not an error state. This is
 * DIFFERENT from AP-1's UNKNOWN: AP-1 concerns readiness/safety GATES whose
 * evaluator or evidence source may be unreachable; a clinical-authority
 * lookup either finds a definitive row or definitively finds none, so it
 * returns a boolean, not the five-valued EvaluationResult. Gates that CONSUME
 * this result (e.g. G-01 consent) are the ones that translate "no clinical
 * authority" into their own UNKNOWN/FAIL semantics if relevant — that
 * translation is out of Phase 2 scope (no gates exist yet).
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';

export interface ClinicalAuthorityStatus {
  granted: boolean;
  licenseNumber: string | null;
  grantedAt: Date | null;
  reason: string | null;
}

export async function evaluateClinicalAuthority(
  tx: TenantPrisma,
  employeeId: string,
): Promise<ClinicalAuthorityStatus> {
  const row = await tx.clinicalAuthority.findUnique({ where: { employeeId } });
  if (!row || !row.granted || row.revokedAt) {
    return { granted: false, licenseNumber: null, grantedAt: null, reason: null };
  }
  return {
    granted: true,
    licenseNumber: row.licenseNumber,
    grantedAt: row.grantedAt,
    reason: row.reason,
  };
}

export interface GrantClinicalAuthorityInput {
  organizationId: string;
  employeeId: string;
  licenseNumber: string;
  reason: string;
  grantedBy: string;
}

/**
 * Grants clinical authority. Deliberately NOT gated on the grantor already
 * holding clinical authority (a bootstrapping impossibility — see the seed
 * comment in canonical-roles.ts); gated instead on the ADMIN-class
 * `clinical_authority:grant` permission, held only by CLINICAL_DIRECTOR and
 * OWNER_DIRECTOR in the seeded catalogue.
 */
export async function grantClinicalAuthority(
  tx: TenantPrisma,
  input: GrantClinicalAuthorityInput,
): Promise<void> {
  if (!input.reason || input.reason.trim().length < 8) {
    throw new Error('grantClinicalAuthority requires a specific, non-trivial reason.');
  }
  await tx.clinicalAuthority.upsert({
    where: { employeeId: input.employeeId },
    create: {
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      granted: true,
      licenseNumber: input.licenseNumber,
      grantedBy: input.grantedBy,
      grantedAt: new Date(), // ok: audited timestamp written server-side at grant time, not a business rule evaluation
      reason: input.reason,
      revokedBy: null,
      revokedAt: null,
    },
    update: {
      granted: true,
      licenseNumber: input.licenseNumber,
      grantedBy: input.grantedBy,
      grantedAt: new Date(),
      reason: input.reason,
      revokedBy: null,
      revokedAt: null,
    },
  });
}

export async function revokeClinicalAuthority(
  tx: TenantPrisma,
  employeeId: string,
  revokedBy: string,
): Promise<void> {
  await tx.clinicalAuthority.update({
    where: { employeeId },
    data: { granted: false, revokedBy, revokedAt: new Date() },
  });
}
