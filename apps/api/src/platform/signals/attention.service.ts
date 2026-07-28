/**
 * KuBi — PROBLEM (internally) / "Attention" (to staff).
 *
 * Every item answers the five questions the owner specified, in this order:
 *   What happened?     -> headline (plain clinic language, no jargon)
 *   How serious?       -> severity
 *   Who needs to act?  -> ownerEmployeeId
 *   What next?         -> the resolving action, supplied by the UI per code
 *   By when?           -> dueAt, from the OD-23 escalation defaults
 *
 * The taxonomy `code` is internal and never rendered. `headline` is what a
 * person reads, and it must always be a sentence about the clinic, not the
 * system.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { ESCALATION_DEFAULTS } from '../../../../../prisma/seed/opening-activities.js';
import { ExceptionStatus, NotificationPriority, EscalationLevel } from '@kubi/contracts';

export interface RaiseAttentionInput {
  organizationId: string;
  clinicId: string;
  code: string;
  severity: string;
  headline: string;
  detail?: string | null;
  sourceInstanceId?: string | null;
  ownerEmployeeId?: string | null;
  /** Fallback when no explicit owner: resolve anyone holding this role. */
  ownerRoleCode?: string | null;
}

function escalationFor(severity: string) {
  return (
    ESCALATION_DEFAULTS[severity as keyof typeof ESCALATION_DEFAULTS] ?? ESCALATION_DEFAULTS.ROUTINE
  );
}

export async function raiseAttentionItem(
  tx: TenantPrisma,
  clock: Clock,
  input: RaiseAttentionInput,
) {
  const now = clock.now();
  const policy = escalationFor(input.severity);

  // Deduplicate: the same code, for the same source, still open, becomes one
  // item rather than fifty. Fifty rows for one broken chair is how an
  // attention list becomes wallpaper.
  const existing = await tx.attentionItem.findFirst({
    where: {
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      code: input.code,
      sourceInstanceId: input.sourceInstanceId ?? null,
      status: { in: [ExceptionStatus.OPEN, ExceptionStatus.ACKNOWLEDGED, ExceptionStatus.ACTION_IN_PROGRESS] },
    },
  });
  if (existing) return existing;

  let ownerEmployeeId = input.ownerEmployeeId ?? null;
  if (!ownerEmployeeId && input.ownerRoleCode) {
    const grant = await tx.employeeRole.findFirst({
      where: {
        organizationId: input.organizationId,
        revokedAt: null,
        role: { code: input.ownerRoleCode },
        OR: [{ clinicId: input.clinicId }, { clinicId: null }],
      },
      select: { employeeId: true },
    });
    ownerEmployeeId = grant?.employeeId ?? null;
  }

  const item = await tx.attentionItem.create({
    data: {
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      code: input.code,
      severity: input.severity,
      headline: input.headline,
      detail: input.detail ?? null,
      sourceInstanceId: input.sourceInstanceId ?? null,
      ownerEmployeeId,
      status: ExceptionStatus.OPEN,
      dueAt: new Date(now.getTime() + policy.escalateAfterMinutes * 60_000),
      escalationLevel: EscalationLevel.INITIAL,
    },
  });

  if (ownerEmployeeId && policy.notifyImmediately) {
    await tx.notification.create({
      data: {
        organizationId: input.organizationId,
        recipientEmployeeId: ownerEmployeeId,
        priority:
          input.severity === 'PATIENT_SAFETY' ? NotificationPriority.P1 : NotificationPriority.P2,
        headline: input.headline,
        attentionItemId: item.id,
      },
    });
  }

  return item;
}

/** Escalate anything past its SLA that nobody has acted on (OD-23). */
export async function sweepEscalations(
  tx: TenantPrisma,
  clock: Clock,
  organizationId: string,
  clinicId: string,
): Promise<number> {
  const now = clock.now();
  const breached = await tx.attentionItem.findMany({
    where: {
      organizationId, clinicId,
      status: ExceptionStatus.OPEN, // acknowledging pauses the ladder
      dueAt: { lt: now },
      escalationLevel: EscalationLevel.INITIAL,
    },
  });

  for (const item of breached) {
    await tx.attentionItem.update({
      where: { id: item.id },
      data: { escalationLevel: EscalationLevel.L1, escalatedAt: now },
    });
    const head = await tx.employeeRole.findFirst({
      where: {
        organizationId,
        revokedAt: null,
        role: { code: 'CLINIC_HEAD' },
        OR: [{ clinicId }, { clinicId: null }],
      },
      select: { employeeId: true },
    });
    if (head) {
      await tx.notification.create({
        data: {
          organizationId,
          recipientEmployeeId: head.employeeId,
          priority: NotificationPriority.P1,
          headline: `Still unresolved: ${item.headline}`,
          attentionItemId: item.id,
        },
      });
    }
  }
  return breached.length;
}
