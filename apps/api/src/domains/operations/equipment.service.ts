/**
 * The Equipment engine.
 *
 * Two halves, and the second is the one that matters clinically.
 *
 * TIME: "if next service date = today, the app automatically creates the
 * service task." Generated on a lead time rather than on the day itself — a
 * service task that appears on the morning it is due is a service that happens
 * tomorrow.
 *
 * EVENT: a failed daily check does not produce a note. It changes the asset's
 * status, which is what takes a chair out of allocation. The requirement is
 * explicit — "if OPEN-004 dental chair = FAIL, that chair becomes NOT
 * AVAILABLE FOR PATIENT ALLOCATION" — and that only works if availability is
 * DERIVED from the asset record rather than remembered by whoever was there.
 *
 * The whole point of an engine, as opposed to a form, is that nobody has to
 * remember the consequence.
 */
import { AssetStatus, Priority, ExceptionStatus, EvaluationResult } from '@kubi/contracts';
import type { TenantPrisma } from '../../platform/tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { clinicLocalDate } from '../../platform/workflow/scheduler.service.js';

export class EquipmentError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'EquipmentError';
  }
}

/** Statuses in which an asset may be used on a patient. */
const USABLE: readonly string[] = [AssetStatus.OPERATIONAL];

/**
 * Record a daily functional check (EQP-001).
 *
 * A FAIL restricts the asset and raises a patient-safety exception in the same
 * transaction as the check itself. Splitting those apart is how an asset ends
 * up failed on paper and in use in the room.
 */
export async function recordAssetCheck(
  client: TenantPrisma,
  clock: Clock,
  assetId: string,
  result: 'PASS' | 'FAIL',
  opts: { employeeId?: string; note?: string } = {},
): Promise<{ status: string; exceptionId?: string }> {
  const asset = await client.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw new EquipmentError('No such asset.', 'NO_ASSET');

  const now = clock.now();
  const clinic = await client.clinic.findUniqueOrThrow({ where: { id: asset.clinicId } });
  const periodKey = clinicLocalDate(now, clinic.timezone);

  await client.assetCheck.upsert({
    where: { assetId_periodKey: { assetId, periodKey } },
    create: {
      organizationId: asset.organizationId,
      assetId,
      periodKey,
      result,
      note: opts.note ?? null,
      checkedByEmployeeId: opts.employeeId ?? null,
      checkedAt: now,
    },
    update: {
      result,
      note: opts.note ?? null,
      checkedByEmployeeId: opts.employeeId ?? null,
      checkedAt: now,
    },
  });

  if (result === 'PASS') {
    // A pass does NOT return a failed asset to service. That needs a repair
    // and somebody's signature (EQP-006) — otherwise yesterday's breakdown
    // disappears because today's check happened to go well.
    return { status: asset.status };
  }

  await client.asset.update({
    where: { id: assetId },
    data: { status: AssetStatus.OUT_OF_SERVICE },
  });

  const breakdown = await client.breakdown.create({
    data: {
      organizationId: asset.organizationId,
      assetId,
      reportedAt: now,
      reportedByEmployeeId: opts.employeeId ?? null,
      description: opts.note || `Daily functional check failed for ${asset.code}`,
    },
  });

  const item = await client.attentionItem.create({
    data: {
      organizationId: asset.organizationId,
      clinicId: asset.clinicId,
      code: 'EQP.PHYSICAL_FAILURE.CHECK_FAILED',
      severity: Priority.PATIENT_SAFETY,
      headline: `${asset.name} is out of service`,
      detail: `${asset.code} failed its daily check and cannot be used until repaired and verified.`,
      status: ExceptionStatus.OPEN,
      dueAt: now,
      ownerEmployeeId: asset.responsibleEmployeeId,
    },
  });

  return { status: AssetStatus.OUT_OF_SERVICE, exceptionId: item.id, ...{ breakdownId: breakdown.id } };
}

/**
 * Return an asset to service (EQP-006).
 *
 * Refused unless somebody other than the reporter verifies it — the same rule
 * as every other verification in KuBi. "It seems fine now" is not a repair.
 */
export async function returnToService(
  client: TenantPrisma,
  clock: Clock,
  breakdownId: string,
  verifierEmployeeId: string,
): Promise<void> {
  const breakdown = await client.breakdown.findUnique({ where: { id: breakdownId } });
  if (!breakdown) throw new EquipmentError('No such breakdown.', 'NO_BREAKDOWN');
  if (!breakdown.repairedAt) {
    throw new EquipmentError('Record the repair before returning the asset to service.', 'NOT_REPAIRED');
  }
  if (breakdown.reportedByEmployeeId && breakdown.reportedByEmployeeId === verifierEmployeeId) {
    throw new EquipmentError(
      'The person who reported the breakdown cannot be the one who verifies the repair.',
      'SELF_VERIFICATION',
    );
  }

  const now = clock.now();
  await client.breakdown.update({
    where: { id: breakdownId },
    data: { verifiedByEmployeeId: verifierEmployeeId, verifiedAt: now },
  });
  await client.asset.update({
    where: { id: breakdown.assetId },
    data: { status: AssetStatus.OPERATIONAL },
  });
}

/**
 * Create maintenance tasks for plans coming due (EQP-002, automation A16).
 *
 * Idempotent per plan per due date: the scheduler runs every few minutes and
 * must not produce a service task each time.
 */
export async function generateMaintenanceTasks(
  client: TenantPrisma,
  clock: Clock,
  organizationId: string,
  clinicId: string,
): Promise<{ created: number }> {
  const now = clock.now();
  const plans = await client.maintenancePlan.findMany({
    where: { organizationId, asset: { clinicId } },
    include: { asset: true },
  });

  let created = 0;
  for (const plan of plans) {
    const leadMs = plan.leadTimeDays * 86_400_000;
    if (plan.nextDueAt.getTime() - now.getTime() > leadMs) continue;

    const headline = `${plan.asset.name} — ${plan.kind.toLowerCase()} due`;
    const already = await client.attentionItem.findFirst({
      where: {
        organizationId, clinicId,
        code: 'EQP.MAINTENANCE.DUE',
        headline,
        status: { in: [ExceptionStatus.OPEN, ExceptionStatus.ACKNOWLEDGED, ExceptionStatus.ACTION_IN_PROGRESS] },
      },
    });
    if (already) continue;

    await client.attentionItem.create({
      data: {
        organizationId, clinicId,
        code: 'EQP.MAINTENANCE.DUE',
        // Calibration keeps a machine honest; a service keeps it running. The
        // first is a patient-safety matter, the second an operational one.
        severity: plan.kind === 'CALIBRATION' ? Priority.PATIENT_SAFETY : Priority.CRITICAL,
        headline,
        detail: `Due ${plan.nextDueAt.toISOString().slice(0, 10)}. Asset ${plan.asset.code}.`,
        status: ExceptionStatus.OPEN,
        dueAt: plan.nextDueAt,
        ownerEmployeeId: plan.asset.responsibleEmployeeId,
      },
    });
    created += 1;
  }
  return { created };
}

/** Record a completed service and roll the plan forward. */
export async function completeMaintenance(
  client: TenantPrisma,
  clock: Clock,
  planId: string,
): Promise<{ nextDueAt: Date }> {
  const plan = await client.maintenancePlan.findUnique({ where: { id: planId } });
  if (!plan) throw new EquipmentError('No such maintenance plan.', 'NO_PLAN');
  const now = clock.now();
  // Rolled from NOW rather than from the previous due date: a service done
  // three weeks late does not make the next one three weeks early.
  const nextDueAt = new Date(now.getTime() + plan.intervalDays * 86_400_000);
  await client.maintenancePlan.update({
    where: { id: planId },
    data: { lastServicedAt: now, nextDueAt },
  });
  return { nextDueAt };
}

/**
 * Whether a named asset category is usable in this clinic right now.
 *
 * This is what the Compliance engine calls, and what stops an out-of-service
 * chair being allocated. UNKNOWN when the clinic holds no such asset at all —
 * absence of an autoclave record is not evidence that sterilisation is fine.
 */
export async function categoryAvailable(
  client: TenantPrisma,
  clinicId: string,
  category: string,
): Promise<{ result: EvaluationResult; detail: string }> {
  const assets = await client.asset.findMany({ where: { clinicId, category } });
  if (assets.length === 0) {
    return {
      result: EvaluationResult.UNKNOWN,
      detail: `No ${category.toLowerCase()} is registered for this clinic.`,
    };
  }
  const usable = assets.filter((a) => USABLE.includes(a.status));
  if (usable.length === 0) {
    const worst = assets[0]!;
    return {
      result: EvaluationResult.FAIL,
      detail: `${worst.name} is ${worst.status.toLowerCase().replace(/_/g, ' ')}.`,
    };
  }
  return {
    result: EvaluationResult.PASS,
    detail: `${usable.length} of ${assets.length} in service.`,
  };
}
