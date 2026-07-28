/**
 * KuBi — resolves a TenancyContext from a userId.
 *
 * The context is NEVER cached in the access token (token.service.ts carries
 * only userId + organizationId). It is recomputed from the database on every
 * request via withSystemContext, so a role revoked mid-session takes effect
 * on the very next call — not after the token expires.
 *
 * crossClinic = true when the employee holds AT LEAST ONE active,
 * currently-effective EmployeeRole grant with clinicId = NULL (the org-wide
 * grant semantics established in migration 0004). clinicIds collects every
 * clinic explicitly granted, whether or not crossClinic is also true — a
 * caller with both an org-wide grant and one clinic-specific grant still
 * reports the clinic explicitly, since some UI needs "my home clinics" even
 * when their permission is broader.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import { withSystemContext } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import type { TenancyContext } from '@kubi/contracts';

export interface ResolvedSession {
  userId: string;
  organizationId: string;
  employeeId: string | null;
  displayLabel: string | null;
  tenancy: TenancyContext;
  /** Active role codes at any scope — used for UI, never for the authorization decision itself. */
  roleCodes: string[];
}

export async function resolveSession(
  prisma: TenantPrisma,
  clock: Clock,
  userId: string,
  organizationId: string,
): Promise<ResolvedSession | null> {
  return withSystemContext(
    prisma,
    'resolve session context for authenticated request',
    organizationId,
    async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.organizationId !== organizationId || user.status !== 'ACTIVE') {
        return null;
      }

      const employee = await tx.employee.findUnique({ where: { userId } });
      if (!employee) {
        // A user with no employee record has no operational identity in
        // KuBi (Phase 0 §09) — they can authenticate but hold no grants.
        return {
          userId,
          organizationId,
          employeeId: null,
          displayLabel: null,
          tenancy: { organizationId, clinicIds: [], crossClinic: false },
          roleCodes: [],
        };
      }

      const now = clock.now();
      const grants = await tx.employeeRole.findMany({
        where: {
          employeeId: employee.id,
          revokedAt: null,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        },
        include: { role: true },
      });

      const crossClinic = grants.some((g) => g.clinicId === null);
      const clinicIds = [...new Set(grants.map((g) => g.clinicId).filter((c): c is string => c !== null))];
      const roleCodes = [...new Set(grants.map((g) => g.role.code))];

      return {
        userId,
        organizationId,
        employeeId: employee.id,
        displayLabel: employee.displayLabel,
        tenancy: { organizationId, clinicIds, crossClinic },
        roleCodes,
      };
    },
  );
}
