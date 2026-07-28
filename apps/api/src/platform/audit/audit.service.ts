/**
 * KuBi — audit writer. Phase 0 §14, owner control 11 (immutable audit events
 * for access/permission changes).
 *
 * This is the APPLICATION half of the two-mechanism audit architecture; the
 * DATABASE half is the `audit_logs_immutable` trigger (migration 0004) that
 * refuses UPDATE/DELETE even for a superuser. Together: an application bug
 * cannot skip writing an audit row it should have written (by convention —
 * call sites are reviewed against this), and neither an application bug nor a
 * direct SQL session can rewrite one after the fact (structural).
 *
 * `writeAudit` MUST be called with the SAME transactional client (`tx`) that
 * performed the change being audited, inside the same `withTenantContext` or
 * `withSystemContext` block — so the audit write commits atomically with the
 * change, or not at all.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';

export interface AuditEntry {
  organizationId: string;
  clinicId?: string | null;
  actorUserId?: string | null;
  actorEmployeeId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  correlationId?: string | null;
}

export async function writeAudit(tx: TenantPrisma, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      clinicId: entry.clinicId ?? null,
      actorUserId: entry.actorUserId ?? null,
      actorEmployeeId: entry.actorEmployeeId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      oldValue: entry.oldValue === undefined ? undefined : (entry.oldValue as never),
      newValue: entry.newValue === undefined ? undefined : (entry.newValue as never),
      reason: entry.reason ?? null,
      correlationId: entry.correlationId ?? null,
    },
  });
}

/** Standard action codes for access/permission events (owner control 11). */
export const AuditAction = {
  ROLE_GRANTED: 'ROLE_GRANTED',
  ROLE_REVOKED: 'ROLE_REVOKED',
  PERMISSION_GRANTED_TO_ROLE: 'PERMISSION_GRANTED_TO_ROLE',
  PERMISSION_REVOKED_FROM_ROLE: 'PERMISSION_REVOKED_FROM_ROLE',
  CLINICAL_AUTHORITY_GRANTED: 'CLINICAL_AUTHORITY_GRANTED',
  CLINICAL_AUTHORITY_REVOKED: 'CLINICAL_AUTHORITY_REVOKED',
  FUNCTIONAL_ASSIGNMENT_GRANTED: 'FUNCTIONAL_ASSIGNMENT_GRANTED',
  FUNCTIONAL_ASSIGNMENT_REVOKED: 'FUNCTIONAL_ASSIGNMENT_REVOKED',
  BREAK_GLASS_ACTIVATED: 'BREAK_GLASS_ACTIVATED',
  BREAK_GLASS_REVOKED: 'BREAK_GLASS_REVOKED',
  UNAUTHORIZED_ATTEMPT: 'UNAUTHORIZED_ATTEMPT',
  ORGANIZATION_PROVISIONED: 'ORGANIZATION_PROVISIONED',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
} as const;
