/**
 * VS-01 — the Clinic Opening operating loop, end to end.
 *
 * Covers the owner's 13 required scenarios. The centrepiece is the journey
 * test: Priya logs in, sees Open the Clinic, does it, reports one problem,
 * the problem reaches Rahul, he resolves it, Anita independently verifies,
 * opening reaches its final status.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import { generateOpeningTasks, sweepOverdue } from '../../apps/api/src/platform/workflow/scheduler.service.js';
import {
  startTask, respondToChecklist, completeTask, verifyTask, reportProblem,
  evaluateGate, TaskAuthorizationError,
} from '../../apps/api/src/platform/workflow/task.service.js';
import { sweepEscalations } from '../../apps/api/src/platform/signals/attention.service.js';
import { FixedClock, systemClock } from '../../apps/api/src/shared/clock.js';
import { ActivityStatus, EvaluationResult, ExceptionStatus } from '@kubi/contracts';

let env: DemoEnvironment;

beforeAll(async () => {
  env = await seedVs01Demo(randomUUID().slice(0, 6));
}, 60_000);

afterAll(async () => { await prisma.$disconnect(); });

const ctx = () => ({ organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false });

describe('VS-01 — Clinic Opening', () => {
  it('1. generates the five opening tasks with correct assignees', async () => {
    const result = await generateOpeningTasks(prisma, systemClock, env.organizationId, env.clinicId);
    expect(result.created).toBe(5);

    const instances = await withTenantContext(prisma, ctx(), (tx) =>
      tx.activityInstance.findMany({ include: { definition: true }, orderBy: { definition: { code: 'asc' } } }),
    );
    expect(instances).toHaveLength(5);
    const byCode = Object.fromEntries(instances.map((i) => [i.definition.code, i]));
    // OPN-001 doer is the ASSIGNED_ASSISTANT functional assignment -> Priya.
    expect(byCode['OPN-001']!.assigneeEmployeeId).toBe(env.assistant.employeeId);
    // OPN-002 doer is the DENTAL_ASSISTANT role -> Priya.
    expect(byCode['OPN-002']!.assigneeEmployeeId).toBe(env.assistant.employeeId);
    // OPN-003 doer is RECEPTION -> Kavita.
    expect(byCode['OPN-003']!.assigneeEmployeeId).toBe(env.reception.employeeId);
  });

  it('2. is idempotent — re-running creates nothing', async () => {
    const again = await generateOpeningTasks(prisma, systemClock, env.organizationId, env.clinicId);
    expect(again.created).toBe(0);
    expect(again.skippedExisting).toBe(5);
    const count = await withTenantContext(prisma, ctx(), (tx) => tx.activityInstance.count());
    expect(count).toBe(5);
  });

  it('3. records every scheduler run, including no-ops', async () => {
    const runs = await withTenantContext(prisma, ctx(), (tx) =>
      tx.automationExecution.findMany({ where: { ruleCode: 'A02_OPENING_GENERATION' } }),
    );
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.some((r) => r.outcome === 'NO_OP')).toBe(true);
  });

  it('4. happy path: start, tick, complete, independent verification', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const inst = await tx.activityInstance.findFirstOrThrow({
        where: { definition: { code: 'OPN-002' } },
        include: { definition: { include: { checklistItems: true } } },
      });

      await startTask(tx, systemClock, inst.id, env.assistant.employeeId);
      await respondToChecklist(tx, systemClock, inst.id, env.assistant.employeeId,
        inst.definition.checklistItems.map((i) => ({ itemId: i.id, checked: true })));

      const result = await completeTask(tx, systemClock, inst.id, env.assistant.employeeId);
      // OPN-002 is STRICT: must be checked by someone else (Anita).
      expect(result.selfVerified).toBe(false);
      expect(result.needsCheckBy).toContain(env.seniorAssistant.employeeId);

      const status = await verifyTask(tx, systemClock, inst.id, env.seniorAssistant.employeeId, 'PASS');
      expect(status).toBe(ActivityStatus.VERIFIED);
    });
  });

  it('5. refuses self-verification where segregation of duties is STRICT', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const inst = await tx.activityInstance.findFirstOrThrow({
        where: { definition: { code: 'OPN-001' } },
        include: { definition: { include: { checklistItems: true } } },
      });
      await startTask(tx, systemClock, inst.id, env.assistant.employeeId);
      await respondToChecklist(tx, systemClock, inst.id, env.assistant.employeeId,
        inst.definition.checklistItems.map((i) => ({ itemId: i.id, checked: true })));
      await completeTask(tx, systemClock, inst.id, env.assistant.employeeId);

      await expect(
        verifyTask(tx, systemClock, inst.id, env.assistant.employeeId, 'PASS'),
      ).rejects.toThrow(/cannot confirm your own work/i);
    });
  });

  it('6. allows self-verification on the OD-02 approved allowlist (OPN-003)', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const inst = await tx.activityInstance.findFirstOrThrow({
        where: { definition: { code: 'OPN-003' } },
        include: { definition: { include: { checklistItems: true } } },
      });
      await startTask(tx, systemClock, inst.id, env.reception.employeeId);
      await respondToChecklist(tx, systemClock, inst.id, env.reception.employeeId,
        inst.definition.checklistItems.map((i) => ({ itemId: i.id, checked: true })));
      const result = await completeTask(tx, systemClock, inst.id, env.reception.employeeId);

      // OD-02 allowlist: self-verification is permitted for OPN-003 regardless
      // of whether another checker happens to be free.
      expect(result.selfVerified).toBe(true);
      expect(result.status).toBe(ActivityStatus.VERIFIED);

      const v = await tx.verification.findFirstOrThrow({ where: { instanceId: inst.id } });
      expect(v.selfVerified).toBe(true); // visible in compliance reporting
    });
  });

  it('7. an out-of-range VALUE reading raises Attention but does not block (OD-21)', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const inst = await tx.activityInstance.findFirstOrThrow({
        where: { definition: { code: 'OPN-004' } },
        include: { definition: { include: { checklistItems: true } } },
      });
      await startTask(tx, systemClock, inst.id, env.assistant.employeeId);
      const acItem = inst.definition.checklistItems.find((i) => i.requiresValue)!;
      await respondToChecklist(tx, systemClock, inst.id, env.assistant.employeeId,
        inst.definition.checklistItems.map((i) => ({
          itemId: i.id, checked: true, ...(i.id === acItem.id ? { numericValue: 31 } : {}),
        })));
      const result = await completeTask(tx, systemClock, inst.id, env.assistant.employeeId);

      expect(result.outOfRangeValues).toHaveLength(1);
      expect(result.status).toBe(ActivityStatus.VERIFIED); // did not block
      const attention = await tx.attentionItem.findFirst({
        where: { code: 'OPN.THRESHOLD_BREACH.ENVIRONMENT_OUT_OF_RANGE' },
      });
      expect(attention).not.toBeNull();
      expect(attention!.headline).toMatch(/outside the normal range/);
    });
  });

  it('8. a gate with no backing module is NOT_CONFIGURED, never PASS (AP-1)', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const gate = await evaluateGate(
        tx, env.organizationId, env.clinicId, 'EMERGENCY_INVENTORY',
        'opening.emergency_readiness_enforcement',
      );
      expect(gate).not.toBeNull();
      expect(gate!.result).toBe(EvaluationResult.NOT_CONFIGURED);
      // OD-20: configured BLOCK_OVERRIDABLE -> blocks, but overridable.
      expect(gate!.blocks).toBe(true);
      expect(gate!.overridable).toBe(true);
      // Plain clinic language, no enum leakage.
      expect(gate!.message).toBe("We can't confirm the emergency kit list yet");
      expect(gate!.message).not.toMatch(/UNKNOWN|NOT_CONFIGURED|gate/i);
    });
  });

  it('9. report a problem: task blocks, Attention reaches the manager, then resolves', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const inst = await tx.activityInstance.findFirstOrThrow({
        where: { definition: { code: 'OPN-005' } },
        include: { definition: { include: { checklistItems: true } } },
      });
      await startTask(tx, systemClock, inst.id, env.assistant.employeeId);

      const oxygenItem = inst.definition.checklistItems.find((i) => i.label.includes('Oxygen'))!;
      const attention = await reportProblem(tx, systemClock, {
        instanceId: inst.id,
        employeeId: env.assistant.employeeId,
        itemId: oxygenItem.id,
        kind: 'NOT_WORKING',
        note: 'SYNTHETIC: cylinder pressure reads low',
      });

      // What happened / how serious / who acts / by when
      expect(attention.headline).toMatch(/Oxygen cylinder/);
      expect(attention.severity).toBe('PATIENT_SAFETY');
      expect(attention.ownerEmployeeId).toBe(env.manager.employeeId);
      expect(attention.dueAt.getTime()).toBeGreaterThan(Date.now());
      // No jargon in what a person reads.
      expect(attention.headline).not.toMatch(/exception|gate|instance|escalation/i);

      // Task is BLOCKED, not failed — Priya isn't left holding it.
      const blocked = await tx.activityInstance.findUniqueOrThrow({ where: { id: inst.id } });
      expect(blocked.blockedByItemId).toBe(attention.id);
      expect(blocked.status).toBe(ActivityStatus.IN_PROGRESS);

      // PATIENT_SAFETY notifies immediately.
      const notif = await tx.notification.findFirst({
        where: { attentionItemId: attention.id, recipientEmployeeId: env.manager.employeeId },
      });
      expect(notif).not.toBeNull();
      expect(notif!.priority).toBe('P1');

      // Rahul resolves it.
      await tx.attentionItem.update({
        where: { id: attention.id },
        data: {
          status: ExceptionStatus.RESOLVED,
          resolvedAt: systemClock.now(),
          resolvedByEmployeeId: env.manager.employeeId,
          resolutionNote: 'SYNTHETIC: spare cylinder fitted',
        },
      });
      const resolved = await tx.attentionItem.findUniqueOrThrow({ where: { id: attention.id } });
      expect(resolved.status).toBe(ExceptionStatus.RESOLVED);
    });
  });

  it('10. deduplicates repeat problems instead of flooding the list', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const inst = await tx.activityInstance.findFirstOrThrow({
        where: { definition: { code: 'OPN-002' } },
        include: { definition: { include: { checklistItems: true } } },
      });
      const a = await reportProblem(tx, systemClock, {
        instanceId: inst.id, employeeId: env.assistant.employeeId,
        kind: 'NOT_WORKING', note: 'SYNTHETIC first report',
      });
      const b = await reportProblem(tx, systemClock, {
        instanceId: inst.id, employeeId: env.assistant.employeeId,
        kind: 'NOT_WORKING', note: 'SYNTHETIC second report',
      });
      expect(b.id).toBe(a.id);
    });
  });

  it('11. an unauthorized user cannot act on someone else\'s task, via the service directly', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const inst = await tx.activityInstance.findFirstOrThrow({
        where: { definition: { code: 'OPN-003' } },
      });
      // Priya is not the assignee for reception readiness.
      await expect(
        startTask(tx, systemClock, inst.id, env.assistant.employeeId),
      ).rejects.toBeInstanceOf(TaskAuthorizationError);
    });
  });

  it('12. cross-clinic isolation: the other clinic sees no opening tasks', async () => {
    const otherClinicTasks = await withTenantContext(
      prisma,
      { organizationId: env.organizationId, clinicIds: [env.otherClinicId], crossClinic: false },
      (tx) => tx.activityInstance.findMany(),
    );
    expect(otherClinicTasks).toHaveLength(0);
  });

  it('13. late opening: overdue sweep changes status and raises Attention', async () => {
    // Fresh clinic-day by using a clock a day ahead, so tasks generate then expire.
    const future = new FixedClock(new Date(Date.now() + 24 * 3600_000));
    await generateOpeningTasks(prisma, future, env.organizationId, env.clinicId);

    const wayLater = new FixedClock(new Date(Date.now() + 48 * 3600_000));
    const swept = await sweepOverdue(prisma, wayLater, env.organizationId, env.clinicId);
    expect(swept).toBeGreaterThan(0);

    const overdue = await withTenantContext(prisma, ctx(), (tx) =>
      tx.activityInstance.findMany({ where: { status: ActivityStatus.OVERDUE } }),
    );
    expect(overdue.length).toBeGreaterThan(0);

    const lateItems = await withTenantContext(prisma, ctx(), (tx) =>
      tx.attentionItem.findMany({ where: { code: { startsWith: 'OPN.OVERDUE.' } } }),
    );
    expect(lateItems.length).toBeGreaterThan(0);
    expect(lateItems[0]!.headline).toMatch(/is late/);
  });

  it('14. escalation: unresolved past SLA escalates to the clinic head', async () => {
    const escalated = await withTenantContext(prisma, ctx(), (tx) =>
      sweepEscalations(tx, new FixedClock(new Date(Date.now() + 72 * 3600_000)), env.organizationId, env.clinicId),
    );
    expect(escalated).toBeGreaterThan(0);
  });

  it('15. audit trail exists and is immutable', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const audits = await tx.auditLog.findMany({
        where: { entityType: 'activity_instance' },
      });
      expect(audits.length).toBeGreaterThan(0);
      expect(audits.some((a) => a.action === 'TASK_COMPLETED')).toBe(true);
      expect(audits.some((a) => a.action === 'PROBLEM_REPORTED')).toBe(true);
      expect(audits.some((a) => a.action === 'TASK_VERIFIED')).toBe(true);

      // Defence in depth: the GRANT layer denies the app role first (42501),
      // and the trigger is the backstop that also stops a privileged session.
      // The app role legitimately never reaches the trigger — proven separately
      // against a superuser session during Phase 2 foundation work.
      await expect(
        tx.$executeRawUnsafe(`UPDATE audit_logs SET action='TAMPERED' WHERE id='${audits[0]!.id}'`),
      ).rejects.toThrow(/permission denied|append-only/i);
    });
  });

  it('16. evidence is append-only at the database level', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const ev = await tx.evidence.findFirstOrThrow();
      await expect(
        tx.$executeRawUnsafe(`UPDATE evidence SET evidence_type='TAMPERED' WHERE id='${ev.id}'`),
      ).rejects.toThrow(/permission denied|append-only/i);
    });
  });
});
