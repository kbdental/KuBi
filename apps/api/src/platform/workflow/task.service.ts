/**
 * KuBi — the WORK lifecycle: start, tick, complete, report a problem, verify.
 *
 * Two rules govern everything here:
 *   1. Authorization is by RECORD RELATION, not role alone. Holding
 *      activity_instance:complete does not let you complete someone else's
 *      task.
 *   2. Reporting a problem BLOCKS the task; it does not fail it. The person
 *      who found the fault is not left holding something they cannot finish,
 *      and the cheapest path stays the honest one.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { writeAudit } from '../audit/audit.service.js';
import { raiseAttentionItem } from '../signals/attention.service.js';
import { resolveActor, type ActorRef } from './assignment-resolver.js';
import { ActivityStatus, EvaluationResult, EnforcementMode, ENFORCEMENT_MATRIX } from '@kubi/contracts';

export class TaskAuthorizationError extends Error {
  constructor(message: string) { super(message); this.name = 'TaskAuthorizationError'; }
}

/**
 * A gate said this task cannot be finished yet. Distinct from an authorization
 * failure: the person is allowed to do this work, the clinic is not ready for
 * it. `overridable` tells the caller whether a reason could unblock it.
 */
export class GateBlockedError extends Error {
  readonly overridable: boolean;
  constructor(message: string, overridable: boolean) {
    super(message);
    this.name = 'GateBlockedError';
    this.overridable = overridable;
  }
}

/** What the UI shows for a gate that could not be evaluated. Never "UNKNOWN". */
export interface GateStatus {
  requirement: string;
  result: EvaluationResult;
  /** Plain clinic language. */
  message: string;
  blocks: boolean;
  overridable: boolean;
}

/**
 * Evaluate an activity's gate. In VS-01 the two referenced requirements
 * (chair/equipment status, emergency inventory) have no backing module, so
 * they resolve NOT_CONFIGURED — which under AP-1 must never read as PASS.
 */
export async function evaluateGate(
  tx: TenantPrisma,
  organizationId: string,
  clinicId: string,
  gateRequirement: string | null,
  gateEnforcementConfigKey: string | null,
): Promise<GateStatus | null> {
  if (!gateRequirement) return null;

  // No requirement registry exists yet -> NOT_CONFIGURED, by design.
  const result = EvaluationResult.NOT_CONFIGURED;

  let enforcement: string = EnforcementMode.ADVISORY;
  if (gateEnforcementConfigKey) {
    const cfg = await tx.configValue.findFirst({
      where: { organizationId, clinicId, key: gateEnforcementConfigKey },
    });
    const configured = (cfg?.valueJson as { value?: string } | null)?.value;
    if (configured) enforcement = configured;
  }

  const decision = ENFORCEMENT_MATRIX[enforcement as keyof typeof ENFORCEMENT_MATRIX]?.[result]
    ?? 'WARN';

  return {
    requirement: gateRequirement,
    result,
    message: MESSAGES[gateRequirement] ?? "We can't confirm this yet",
    blocks: decision === 'BLOCK_HARD' || decision === 'BLOCK_OVERRIDABLE',
    overridable: decision === 'BLOCK_OVERRIDABLE',
  };
}

/** Plain-language rendering of each gate. No enum ever reaches a screen. */
const MESSAGES: Record<string, string> = {
  CHAIR_EQUIPMENT_STATUS: "We can't confirm the chair and equipment checks yet",
  EMERGENCY_INVENTORY: "We can't confirm the emergency kit list yet",
};

export async function startTask(
  tx: TenantPrisma, clock: Clock, instanceId: string, employeeId: string,
) {
  const inst = await tx.activityInstance.findUniqueOrThrow({
    where: { id: instanceId }, include: { definition: true },
  });
  if (inst.assigneeEmployeeId !== employeeId) {
    throw new TaskAuthorizationError('This task is assigned to someone else.');
  }
  const updated = await tx.activityInstance.update({
    where: { id: instanceId },
    data: { status: ActivityStatus.IN_PROGRESS, startedAt: clock.now() },
  });
  await writeAudit(tx, {
    organizationId: inst.organizationId, clinicId: inst.clinicId,
    actorEmployeeId: employeeId, action: 'TASK_STARTED',
    entityType: 'activity_instance', entityId: instanceId,
    oldValue: { status: inst.status }, newValue: { status: ActivityStatus.IN_PROGRESS },
  });
  return updated;
}

export async function respondToChecklist(
  tx: TenantPrisma, clock: Clock, instanceId: string, employeeId: string,
  responses: Array<{ itemId: string; checked: boolean; numericValue?: number | undefined }>,
) {
  const inst = await tx.activityInstance.findUniqueOrThrow({ where: { id: instanceId } });
  if (inst.assigneeEmployeeId !== employeeId) {
    throw new TaskAuthorizationError('This task is assigned to someone else.');
  }
  for (const r of responses) {
    await tx.checklistResponse.upsert({
      where: { instanceId_itemId: { instanceId, itemId: r.itemId } },
      create: {
        organizationId: inst.organizationId, instanceId, itemId: r.itemId,
        checked: r.checked,
        ...(r.numericValue !== undefined ? { numericValue: r.numericValue } : {}),
        respondedByEmployeeId: employeeId, respondedAt: clock.now(),
      },
      update: {
        checked: r.checked,
        ...(r.numericValue !== undefined ? { numericValue: r.numericValue } : {}),
        respondedByEmployeeId: employeeId, respondedAt: clock.now(),
      },
    });
  }
}

export interface CompleteResult {
  status: string;
  needsCheckBy: string[] | null;
  selfVerified: boolean;
  outOfRangeValues: Array<{ label: string; value: number; unit: string | null }>;
}

export async function completeTask(
  tx: TenantPrisma, clock: Clock, instanceId: string, employeeId: string,
  override?: { reason: string },
): Promise<CompleteResult> {
  const inst = await tx.activityInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: { definition: { include: { checklistItems: true } }, responses: true },
  });
  if (inst.assigneeEmployeeId !== employeeId) {
    throw new TaskAuthorizationError('This task is assigned to someone else.');
  }

  const now = clock.now();
  const def = inst.definition;

  // The gate is enforced HERE, not in the screen that renders it. `cantConfirm`
  // on the task sheet is a courtesy; this is the rule. Without this check a
  // direct API call finishes a task whose gate blocks -- which is precisely
  // the enforcement hole the journey test closes for authorization.
  const gate = await evaluateGate(
    tx, inst.organizationId, inst.clinicId, def.gateRequirement, def.gateEnforcement,
  );
  if (gate?.blocks) {
    if (!gate.overridable) {
      // BLOCK_HARD has no override path at all -- not a permission someone
      // could be granted, not a reason someone could type. ADR-004.
      throw new GateBlockedError(
        `${gate.message}. This has to be sorted out before the task can be finished.`,
        false,
      );
    }
    if (!override?.reason?.trim()) {
      throw new GateBlockedError(
        `${gate.message}. Report a problem, or record why it is safe to go ahead.`,
        true,
      );
    }
    // Going ahead anyway is a management act, and it is never silent: it is
    // audited AND raised as Attention, so a manager sees it even if nobody
    // reports it. OD-20 chose BLOCK_OVERRIDABLE precisely so this path exists.
    await writeAudit(tx, {
      organizationId: inst.organizationId, clinicId: inst.clinicId,
      actorEmployeeId: employeeId, action: 'GATE_OVERRIDDEN',
      entityType: 'activity_instance', entityId: instanceId,
      reason: override.reason,
      newValue: { requirement: gate.requirement, result: gate.result },
    });
    await raiseAttentionItem(tx, clock, {
      organizationId: inst.organizationId, clinicId: inst.clinicId,
      code: 'OPN.GATE_OVERRIDE.PROCEEDED_WITHOUT_CONFIRMATION',
      severity: def.priority,
      headline: `${def.title} was finished before ${gate.message.replace(/^We can't confirm /, '')}`,
      detail: override.reason,
      sourceInstanceId: inst.id,
      ownerRoleCode: 'CLINIC_MANAGER',
    });
  }

  // Out-of-range VALUE readings raise Attention (OD-21) but do not block.
  const outOfRange: CompleteResult['outOfRangeValues'] = [];
  for (const item of def.checklistItems.filter((i) => i.requiresValue)) {
    const resp = inst.responses.find((r) => r.itemId === item.id);
    if (resp?.numericValue == null) continue;
    const below = item.valueMin != null && resp.numericValue < item.valueMin;
    const above = item.valueMax != null && resp.numericValue > item.valueMax;
    if (below || above) {
      outOfRange.push({ label: item.label, value: resp.numericValue, unit: item.valueUnit });
      await raiseAttentionItem(tx, clock, {
        organizationId: inst.organizationId, clinicId: inst.clinicId,
        code: 'OPN.THRESHOLD_BREACH.ENVIRONMENT_OUT_OF_RANGE',
        severity: def.priority,
        headline: `${item.label} is outside the normal range (${resp.numericValue}${item.valueUnit ?? ''})`,
        sourceInstanceId: inst.id,
        ownerRoleCode: 'CLINIC_MANAGER',
      });
    }
  }

  await tx.evidence.create({
    data: {
      organizationId: inst.organizationId, instanceId,
      evidenceType: def.evidenceType,
      payload: {
        checklist: inst.responses.map((r) => ({
          itemId: r.itemId, checked: r.checked, value: r.numericValue,
        })),
      },
      capturedByEmployeeId: employeeId, capturedAt: now,
    },
  });

  await tx.activityInstance.update({
    where: { id: instanceId },
    data: {
      status: ActivityStatus.COMPLETED,
      completedAt: now,
      completedByEmployeeId: employeeId,
    },
  });

  await writeAudit(tx, {
    organizationId: inst.organizationId, clinicId: inst.clinicId,
    actorEmployeeId: employeeId, action: 'TASK_COMPLETED',
    entityType: 'activity_instance', entityId: instanceId,
    oldValue: { status: inst.status }, newValue: { status: ActivityStatus.COMPLETED },
  });

  // Route the CHECK. The doer is never asked to find their own verifier.
  const rule = def.assignmentRule as unknown as { checker: ActorRef };
  const checker = await resolveActor(tx, clock, inst.organizationId, inst.clinicId, rule.checker);
  const others = checker.employeeIds.filter((id) => id !== employeeId);

  if (def.selfVerifyAllowed) {
    // OD-02 / OD-21: the allowlist IS the decision that this activity needs no
    // independent counter-check — not a fallback for when nobody else is free.
    // OD-21 is explicit that a routine environment reading "does not require
    // daily manager counter-verification", so routing it to an available
    // manager anyway would reintroduce exactly the ceremony that decision
    // removed. Self-verification is still recorded as such and stays visible
    // in compliance reporting (KPI-SYS-03 Verification Independence %).
    await tx.verification.create({
      data: {
        organizationId: inst.organizationId, instanceId,
        verifierEmployeeId: employeeId, result: 'PASS',
        selfVerified: true, verifiedAt: now,
      },
    });
    await tx.activityInstance.update({
      where: { id: instanceId },
      data: { status: ActivityStatus.VERIFIED, verifiedAt: now },
    });
    await writeAudit(tx, {
      organizationId: inst.organizationId, clinicId: inst.clinicId,
      actorEmployeeId: employeeId, action: 'TASK_SELF_VERIFIED',
      entityType: 'activity_instance', entityId: instanceId,
      reason: 'Self-verification permitted for this activity (OD-02 allowlist)',
    });
    return { status: ActivityStatus.VERIFIED, needsCheckBy: null, selfVerified: true, outOfRangeValues: outOfRange };
  }

  for (const verifierId of others) {
    await tx.notification.create({
      data: {
        organizationId: inst.organizationId,
        recipientEmployeeId: verifierId,
        priority: 'P3',
        headline: `Please check: ${def.title}`,
      },
    });
  }

  return {
    status: ActivityStatus.COMPLETED,
    needsCheckBy: others.length > 0 ? others : null,
    selfVerified: false,
    outOfRangeValues: outOfRange,
  };
}

export async function verifyTask(
  tx: TenantPrisma, clock: Clock, instanceId: string, verifierEmployeeId: string,
  result: 'PASS' | 'FAIL', comment?: string,
) {
  const inst = await tx.activityInstance.findUniqueOrThrow({
    where: { id: instanceId }, include: { definition: true },
  });
  const def = inst.definition;

  // Segregation of duties, enforced server-side.
  if (inst.completedByEmployeeId === verifierEmployeeId && !def.selfVerifyAllowed) {
    throw new TaskAuthorizationError('You cannot confirm your own work on this task.');
  }
  const rule = def.assignmentRule as unknown as { checker: ActorRef };
  const checker = await resolveActor(tx, clock, inst.organizationId, inst.clinicId, rule.checker);
  if (!checker.employeeIds.includes(verifierEmployeeId)) {
    throw new TaskAuthorizationError('You are not one of the people who can check this task.');
  }

  const now = clock.now();
  await tx.verification.create({
    data: {
      organizationId: inst.organizationId, instanceId,
      verifierEmployeeId, result,
      selfVerified: inst.completedByEmployeeId === verifierEmployeeId,
      ...(comment ? { comment } : {}),
      verifiedAt: now,
    },
  });

  const newStatus = result === 'PASS' ? ActivityStatus.VERIFIED : ActivityStatus.FAILED_VERIFICATION;
  await tx.activityInstance.update({
    where: { id: instanceId },
    data: {
      status: newStatus,
      ...(result === 'PASS' ? { verifiedAt: now } : {}),
    },
  });

  await writeAudit(tx, {
    organizationId: inst.organizationId, clinicId: inst.clinicId,
    actorEmployeeId: verifierEmployeeId,
    action: result === 'PASS' ? 'TASK_VERIFIED' : 'TASK_VERIFICATION_FAILED',
    entityType: 'activity_instance', entityId: instanceId,
    newValue: { status: newStatus }, ...(comment ? { reason: comment } : {}),
  });

  if (result === 'FAIL') {
    await raiseAttentionItem(tx, clock, {
      organizationId: inst.organizationId, clinicId: inst.clinicId,
      code: `OPN.VERIFICATION_FAILED.${def.code.replace('-', '_')}`,
      severity: def.priority,
      headline: `"${def.title}" was sent back — it needs doing again`,
      detail: comment ?? null,
      sourceInstanceId: inst.id,
      ownerEmployeeId: inst.completedByEmployeeId,
    });
  }
  return newStatus;
}

export const PROBLEM_KINDS = [
  { key: 'NOT_WORKING', label: 'Not working' },
  { key: 'MISSING', label: 'Missing' },
  { key: 'NOT_CLEAN', label: 'Not clean' },
  { key: 'OTHER', label: 'Something else' },
] as const;

export async function reportProblem(
  tx: TenantPrisma, clock: Clock,
  input: {
    instanceId: string; employeeId: string; itemId?: string | null;
    kind: string; note?: string | null;
  },
) {
  const inst = await tx.activityInstance.findUniqueOrThrow({
    where: { id: input.instanceId },
    include: { definition: { include: { checklistItems: true } } },
  });
  const def = inst.definition;
  const item = input.itemId ? def.checklistItems.find((i) => i.id === input.itemId) : null;
  const kindLabel = PROBLEM_KINDS.find((k) => k.key === input.kind)?.label ?? 'Problem';

  const headline = item
    ? `${item.label} — ${kindLabel.toLowerCase()}`
    : `${def.title} — ${kindLabel.toLowerCase()}`;

  const attention = await raiseAttentionItem(tx, clock, {
    organizationId: inst.organizationId, clinicId: inst.clinicId,
    code: `OPN.PHYSICAL_FAILURE.${def.code.replace('-', '_')}`,
    severity: def.priority,
    headline,
    detail: input.note ?? null,
    sourceInstanceId: inst.id,
    ownerRoleCode: 'CLINIC_MANAGER',
  });

  // BLOCKED, not FAILED — the reporter is not left holding it.
  await tx.activityInstance.update({
    where: { id: input.instanceId },
    data: { blockedByItemId: attention.id },
  });

  await writeAudit(tx, {
    organizationId: inst.organizationId, clinicId: inst.clinicId,
    actorEmployeeId: input.employeeId, action: 'PROBLEM_REPORTED',
    entityType: 'activity_instance', entityId: input.instanceId,
    newValue: { attentionItemId: attention.id, kind: input.kind },
    ...(input.note ? { reason: input.note } : {}),
  });

  return attention;
}
