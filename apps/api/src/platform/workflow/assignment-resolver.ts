/**
 * KuBi — resolves an activity's doer/checker/owner to actual employees.
 *
 * Phase 0.5 D2's actor kinds, made executable. If a rule resolves to NOBODY,
 * the task is still created (unassigned) and a PROBLEM is raised to the
 * Clinic Manager — work is never silently dropped because a rota gap exists.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';

export interface ActorRef {
  kind: string; // ROLE | ANY_ROLE | FUNCTIONAL_ASSIGNMENT
  value: string | string[];
}

export interface ResolvedActors {
  employeeIds: string[];
  /** True when the rule is well-formed but nobody currently satisfies it. */
  unresolved: boolean;
  reason?: string;
}

export async function resolveActor(
  tx: TenantPrisma,
  clock: Clock,
  organizationId: string,
  clinicId: string,
  ref: ActorRef,
): Promise<ResolvedActors> {
  const now = clock.now();

  if (ref.kind === 'FUNCTIONAL_ASSIGNMENT') {
    const rows = await tx.functionalAssignment.findMany({
      where: {
        clinicId,
        assignmentType: ref.value as string,
        revokedAt: null,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      select: { employeeId: true },
    });
    return rows.length > 0
      ? { employeeIds: rows.map((r) => r.employeeId), unresolved: false }
      : {
          employeeIds: [],
          unresolved: true,
          reason: `Nobody at this clinic is set up as ${humaniseAssignment(ref.value as string)}`,
        };
  }

  const roleCodes = ref.kind === 'ANY_ROLE' ? (ref.value as string[]) : [ref.value as string];
  const grants = await tx.employeeRole.findMany({
    where: {
      organizationId,
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      AND: [{ OR: [{ clinicId }, { clinicId: null }] }],
      role: { code: { in: roleCodes } },
    },
    select: { employeeId: true },
  });
  const employeeIds = [...new Set(grants.map((g) => g.employeeId))];
  return employeeIds.length > 0
    ? { employeeIds, unresolved: false }
    : {
        employeeIds: [],
        unresolved: true,
        reason: `Nobody at this clinic currently holds the ${roleCodes.map(humaniseRole).join(' or ')} role`,
      };
}

/** Plain clinic language for a PROBLEM headline — never the enum token. */
function humaniseRole(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function humaniseAssignment(code: string): string {
  return humaniseRole(code);
}
