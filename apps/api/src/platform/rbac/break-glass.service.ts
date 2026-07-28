/**
 * KuBi — break-glass. The entire escape hatch (Phase 0 §09). Time-boxed,
 * reason-required, separately audited. No standing role can hold a
 * BREAK_GLASS-class permission (enforced by the DB trigger in migration
 * 0004) — this is the only path to one.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { writeAudit, AuditAction } from '../audit/audit.service.js';
import { PermissionClass } from '@kubi/contracts';

const MAX_DURATION_MINUTES = 4 * 60; // 4 hours — a break-glass grant is not a standing arrangement

export interface ActivateBreakGlassInput {
  organizationId: string;
  employeeId: string;
  permissionCode: string;
  reason: string;
  requestedBy: string;
  approvedBy?: string | null;
  durationMinutes: number;
}

export async function activateBreakGlass(
  tx: TenantPrisma,
  clock: Clock,
  input: ActivateBreakGlassInput,
) {
  if (!input.reason || input.reason.trim().length < 8) {
    throw new Error('activateBreakGlass requires a specific, non-trivial reason.');
  }
  if (input.durationMinutes <= 0 || input.durationMinutes > MAX_DURATION_MINUTES) {
    throw new Error(`durationMinutes must be between 1 and ${MAX_DURATION_MINUTES}.`);
  }

  const permission = await tx.permission.findUnique({ where: { code: input.permissionCode } });
  if (!permission || permission.class !== PermissionClass.BREAK_GLASS) {
    throw new Error(`${input.permissionCode} is not a BREAK_GLASS-class permission.`);
  }

  const now = clock.now();
  const expiresAt = new Date(now.getTime() + input.durationMinutes * 60_000);

  const grant = await tx.breakGlassGrant.create({
    data: {
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      permissionCode: input.permissionCode,
      reason: input.reason,
      requestedBy: input.requestedBy,
      approvedBy: input.approvedBy ?? null,
      activatedAt: now,
      expiresAt,
    },
  });

  await writeAudit(tx, {
    organizationId: input.organizationId,
    actorEmployeeId: input.requestedBy,
    action: AuditAction.BREAK_GLASS_ACTIVATED,
    entityType: 'break_glass_grant',
    entityId: grant.id,
    newValue: { permissionCode: input.permissionCode, employeeId: input.employeeId, expiresAt },
    reason: input.reason,
  });

  return grant;
}

export async function checkBreakGlassActive(
  tx: TenantPrisma,
  clock: Clock,
  employeeId: string,
  permissionCode: string,
): Promise<boolean> {
  const now = clock.now();
  const active = await tx.breakGlassGrant.findFirst({
    where: {
      employeeId,
      permissionCode,
      revokedAt: null,
      activatedAt: { lte: now },
      expiresAt: { gte: now },
    },
  });
  return active !== null;
}

export async function revokeBreakGlass(
  tx: TenantPrisma,
  clock: Clock,
  grantId: string,
  revokedBy: string,
  organizationId: string,
) {
  const grant = await tx.breakGlassGrant.update({
    where: { id: grantId },
    data: { revokedBy, revokedAt: clock.now() },
  });
  await writeAudit(tx, {
    organizationId,
    actorEmployeeId: revokedBy,
    action: AuditAction.BREAK_GLASS_REVOKED,
    entityType: 'break_glass_grant',
    entityId: grantId,
  });
  return grant;
}
