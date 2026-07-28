/**
 * KuBi — permission evaluation. Phase 0 §09's authorization pipeline,
 * implemented.
 *
 * checkPermission runs, in order:
 *   1. Grant   — does any active role held at this org/clinic grant the code?
 *   2. Clinical — if the permission is CLINICAL or SAFETY_OVERRIDE class,
 *                 does the actor also hold clinical authority?
 *   3. Break-glass — BREAK_GLASS-class codes NEVER pass step 1 (the DB
 *                 trigger guarantees no role can hold one); they pass only
 *                 via an active BreakGlassGrant checked separately.
 *
 * A denial is not silent: every UNAUTHORIZED_ATTEMPT is written to
 * audit_log by the caller (the guard), not by this function — this module
 * stays a pure decision, so it is trivially unit-testable without a
 * transaction.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { evaluateClinicalAuthority } from './clinical-authority.service.js';
import { PermissionClass } from '@kubi/contracts';

export interface PermissionCheckInput {
  employeeId: string;
  organizationId: string;
  /** Clinic the action targets, if any. Omit for org-level actions. */
  clinicId?: string | null;
  code: string; // "resource:action"
}

export type PermissionDecision =
  | { allowed: true }
  | { allowed: false; reason: 'NOT_GRANTED' | 'CLINICAL_AUTHORITY_REQUIRED' };

export async function checkPermission(
  tx: TenantPrisma,
  clock: Clock,
  input: PermissionCheckInput,
): Promise<PermissionDecision> {
  const permission = await tx.permission.findUnique({ where: { code: input.code } });
  if (!permission) {
    // An unknown code is a programming error, not a user-facing authorization
    // question — fail closed rather than silently treating it as ungranted-but-ok.
    throw new Error(`[permission-evaluation] Unknown permission code: ${input.code}`);
  }

  if (permission.class === PermissionClass.BREAK_GLASS) {
    // Never satisfied by a standing grant. Callers needing this path use
    // break-glass.service.ts's checkBreakGlassActive instead.
    return { allowed: false, reason: 'NOT_GRANTED' };
  }

  const now = clock.now();
  const grants = await tx.employeeRole.findMany({
    where: {
      employeeId: input.employeeId,
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      role: {
        organizationId: input.organizationId,
        permissions: { some: { permissionId: permission.id } },
      },
    },
    select: { clinicId: true },
  });

  const grantedHere = grants.some(
    (g) => g.clinicId === null || (input.clinicId != null && g.clinicId === input.clinicId),
  );
  if (!grantedHere) {
    return { allowed: false, reason: 'NOT_GRANTED' };
  }

  if (permission.class === PermissionClass.CLINICAL || permission.class === PermissionClass.SAFETY_OVERRIDE) {
    const authority = await evaluateClinicalAuthority(tx, input.employeeId);
    if (!authority.granted) {
      return { allowed: false, reason: 'CLINICAL_AUTHORITY_REQUIRED' };
    }
  }

  return { allowed: true };
}
