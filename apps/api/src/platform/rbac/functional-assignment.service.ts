/**
 * KuBi — functional assignment evaluation. Phase 0.5 D2: a named clinic
 * responsibility (Assigned Opening Staff, Reception Lead, ...), independent
 * of role, resolved per clinic.
 *
 * Three-valued, not two: absence of ANY assignment of a type at a clinic is
 * a configuration gap (NOT_CONFIGURED) — nobody has decided who holds this
 * responsibility yet — which is different from "assignments exist, but not
 * for this person" (FAIL). Collapsing those would hide a setup gap behind
 * an ordinary-looking access denial.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { EvaluationResult, type FunctionalAssignmentType } from '@kubi/contracts';

export async function evaluateFunctionalAssignment(
  tx: TenantPrisma,
  clock: Clock,
  input: {
    employeeId: string;
    clinicId: string;
    assignmentType: (typeof FunctionalAssignmentType)[keyof typeof FunctionalAssignmentType];
    scopeRef?: string | null;
  },
): Promise<EvaluationResult> {
  const now = clock.now();
  const anyAtClinic = await tx.functionalAssignment.findFirst({
    where: {
      clinicId: input.clinicId,
      assignmentType: input.assignmentType,
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
  });
  if (!anyAtClinic) {
    return EvaluationResult.NOT_CONFIGURED;
  }

  const mine = await tx.functionalAssignment.findFirst({
    where: {
      employeeId: input.employeeId,
      clinicId: input.clinicId,
      assignmentType: input.assignmentType,
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      ...(input.scopeRef !== undefined ? { scopeRef: input.scopeRef } : {}),
    },
  });

  return mine ? EvaluationResult.PASS : EvaluationResult.FAIL;
}

export async function whoHoldsAssignment(
  tx: TenantPrisma,
  clock: Clock,
  clinicId: string,
  assignmentType: (typeof FunctionalAssignmentType)[keyof typeof FunctionalAssignmentType],
): Promise<string[]> {
  const now = clock.now();
  const rows = await tx.functionalAssignment.findMany({
    where: {
      clinicId,
      assignmentType,
      revokedAt: null,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    select: { employeeId: true },
  });
  return rows.map((r) => r.employeeId);
}
