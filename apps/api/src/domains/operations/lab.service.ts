/**
 * Laboratory case management.
 *
 * This module exists for one rule, which the requirements cite more than any
 * other:
 *
 *   Crown Delivery Appointment
 *   should require:  Lab Case Received = YES  AND  QC = PASSED
 *   Otherwise:       ⚠ CASE NOT READY FOR DELIVERY APPOINTMENT
 *
 * Booking a delivery before both are true is the worked example behind the
 * whole CAPA parameter — "crown delivery appointment given before crown
 * arrived… simply correcting today's appointment doesn't solve the operational
 * problem." `assertReadyForDelivery` is the preventive action that stops it
 * being a thing anybody has to remember.
 *
 * ---
 *
 * Two design points worth stating.
 *
 * QC is a THIRD state, not a boolean. A case that has arrived but not been
 * looked at is neither passed nor failed, and treating "not yet checked" as
 * either is how a crown reaches a patient's mouth unexamined. Received and
 * QC-passed are separate gates for the same reason the requirement writes them
 * as two conditions joined by AND.
 *
 * A remake is not a reset. The count survives, because a case on its second
 * remake is a different conversation with the vendor from one on its first —
 * and because a repeating remake is exactly the recurring failure the Exception
 * engine is meant to surface rather than absorb.
 */
import { LabCaseStatus, Priority, ExceptionStatus } from '@kubi/contracts';
import type { TenantPrisma } from '../../platform/tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';

export class LabError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'LabError';
  }
}

/** LAB-YYYY-NNNN, unique per organisation and stable once issued. */
async function nextReference(client: TenantPrisma, orgId: string, now: Date): Promise<string> {
  const prefix = `LAB-${now.getUTCFullYear()}-`;
  const last = await client.labCase.findFirst({
    where: { organizationId: orgId, reference: { startsWith: prefix } },
    orderBy: { reference: 'desc' },
    select: { reference: true },
  });
  const n = last ? Number(last.reference.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(n).padStart(4, '0')}`;
}

export interface CreateLabCaseInput {
  organizationId: string;
  clinicId: string;
  patientId: string;
  vendor: string;
  workType: string;
  toothRef: string;
  shade?: string;
  material?: string;
}

/** LAB-001. Vendor, work type and tooth are mandatory: a case that cannot be
 *  identified cannot be chased, matched on return, or QC'd against anything. */
export async function createLabCase(
  client: TenantPrisma,
  clock: Clock,
  input: CreateLabCaseInput,
) {
  for (const [field, value] of Object.entries({
    vendor: input.vendor, workType: input.workType, toothRef: input.toothRef,
  })) {
    if (!value?.trim()) {
      throw new LabError(`A lab case needs a ${field.replace(/([A-Z])/g, ' $1').toLowerCase()}.`, 'MISSING_FIELD');
    }
  }
  return client.labCase.create({
    data: {
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      reference: await nextReference(client, input.organizationId, clock.now()),
      patientId: input.patientId,
      vendor: input.vendor,
      workType: input.workType,
      toothRef: input.toothRef,
      shade: input.shade ?? null,
      material: input.material ?? null,
      status: LabCaseStatus.CREATED,
    },
  });
}

/**
 * LAB-002 / LAB-007. Dispatch, with a mandatory expected return date.
 *
 * Without one the case can never be late, which is indistinguishable from
 * never being chased — and "lab work overdue" is one of the requirement's
 * named exceptions.
 */
export async function dispatchLabCase(
  client: TenantPrisma,
  clock: Clock,
  labCaseId: string,
  expectedReturnAt: Date,
) {
  const c = await mustFind(client, labCaseId);
  if (c.status !== LabCaseStatus.CREATED && c.status !== LabCaseStatus.REMAKE) {
    throw new LabError(`${c.reference} has already been dispatched.`, 'ALREADY_DISPATCHED');
  }
  const now = clock.now();
  if (expectedReturnAt <= now) {
    throw new LabError('The expected return date must be in the future.', 'BAD_RETURN_DATE');
  }
  return client.labCase.update({
    where: { id: labCaseId },
    data: {
      status: LabCaseStatus.IN_PROGRESS_VENDOR,
      dispatchedAt: now,
      expectedReturnAt,
      // A re-dispatched remake carries no verdict until it is checked again.
      // Leaving the old FAIL would make the second attempt unbookable even
      // after it passed, and leaving a stale PASS would be far worse.
      qcResult: null, qcAt: null, qcByEmployeeId: null,
    },
  });
}

/** LAB-004. Receipt puts the case into QC_PENDING, never straight to ready. */
export async function receiveLabCase(client: TenantPrisma, clock: Clock, labCaseId: string) {
  const c = await mustFind(client, labCaseId);
  if (c.status !== LabCaseStatus.IN_PROGRESS_VENDOR && c.status !== LabCaseStatus.DISPATCHED) {
    throw new LabError(`${c.reference} is not out with the laboratory.`, 'NOT_DISPATCHED');
  }
  return client.labCase.update({
    where: { id: labCaseId },
    data: { status: LabCaseStatus.QC_PENDING, receivedAt: clock.now() },
  });
}

/**
 * LAB-005 / LAB-006. Doctor QC.
 *
 * A pass moves the case to PATIENT_READY, which is the only status from which
 * a delivery appointment may be booked. A failure moves it to REMAKE, raises a
 * patient-safety exception and increments the count — the requirement wants
 * "reason + responsibility + corrective action" recorded, and a remake with no
 * reason is a vendor conversation nobody can have.
 */
export async function recordQc(
  client: TenantPrisma,
  clock: Clock,
  labCaseId: string,
  result: 'PASS' | 'FAIL',
  employeeId: string,
  note?: string,
): Promise<{ status: string; exceptionId?: string }> {
  const c = await mustFind(client, labCaseId);
  if (c.status !== LabCaseStatus.QC_PENDING) {
    throw new LabError(
      `${c.reference} must be received before it can be checked.`,
      'NOT_RECEIVED',
    );
  }
  if (result === 'FAIL' && !note?.trim()) {
    throw new LabError('A failed check must say what is wrong with the case.', 'NO_QC_REASON');
  }

  const now = clock.now();
  if (result === 'PASS') {
    await client.labCase.update({
      where: { id: labCaseId },
      data: {
        status: LabCaseStatus.PATIENT_READY,
        qcResult: 'PASS', qcByEmployeeId: employeeId, qcAt: now, qcNote: note ?? null,
      },
    });
    return { status: LabCaseStatus.PATIENT_READY };
  }

  const updated = await client.labCase.update({
    where: { id: labCaseId },
    data: {
      status: LabCaseStatus.REMAKE,
      qcResult: 'FAIL', qcByEmployeeId: employeeId, qcAt: now, qcNote: note ?? null,
      remakeCount: { increment: 1 },
      // Cleared so the case cannot be received again on the old dates.
      dispatchedAt: null, expectedReturnAt: null, receivedAt: null,
    },
  });

  const item = await client.attentionItem.create({
    data: {
      organizationId: c.organizationId,
      clinicId: c.clinicId,
      code: 'LAB.QC.FAILED',
      // A repeat remake is worse than a first: the same case failing twice is
      // a vendor or prescription problem, not bad luck.
      severity: updated.remakeCount > 1 ? Priority.CRITICAL : Priority.IMPORTANT,
      headline: `${c.reference} failed check — remake needed`,
      detail: `${c.workType}, tooth ${c.toothRef}, ${c.vendor}. ${note}`,
      status: ExceptionStatus.OPEN,
      dueAt: now,
    },
  });
  return { status: LabCaseStatus.REMAKE, exceptionId: item.id };
}

export interface DeliveryReadiness {
  ready: boolean;
  reason: string | null;
}

/**
 * THE rule. Received AND QC passed, or the appointment cannot be booked.
 *
 * Returns rather than throws, so a booking screen can show why before somebody
 * tries — a control that refuses without explaining reads as broken.
 */
export function deliveryReadiness(c: {
  reference: string; status: string; receivedAt: Date | null; qcResult: string | null;
}): DeliveryReadiness {
  // Checked BEFORE arrival, because a remade case has legitimately not
  // arrived — it was sent back — and reporting "has not arrived yet" would be
  // true while hiding the only fact that matters: it failed and is being
  // redone. Reception needs to chase a remake, not wonder where the post is.
  if (c.status === LabCaseStatus.REMAKE || c.qcResult === 'FAIL') {
    return { ready: false, reason: `${c.reference} failed its check and is being remade.` };
  }
  if (!c.receivedAt) {
    return { ready: false, reason: `${c.reference} has not arrived from the laboratory yet.` };
  }
  if (c.qcResult === null) {
    // Neither passed nor failed. Treating "not yet checked" as either is how a
    // crown reaches a patient unexamined.
    return { ready: false, reason: `${c.reference} has arrived but has not been checked.` };
  }
  if (c.status !== LabCaseStatus.PATIENT_READY && c.status !== LabCaseStatus.DELIVERED) {
    return { ready: false, reason: `${c.reference} is not ready for the patient.` };
  }
  return { ready: true, reason: null };
}

/** Server-side enforcement of the same rule. A UI check is a courtesy. */
export async function assertReadyForDelivery(
  client: TenantPrisma,
  labCaseId: string,
): Promise<void> {
  const c = await mustFind(client, labCaseId);
  const { ready, reason } = deliveryReadiness(c);
  if (!ready) throw new LabError(`Case not ready for delivery appointment. ${reason}`, 'NOT_READY');
}

/** LAB-008. Delivery closes the case. */
export async function deliverLabCase(client: TenantPrisma, clock: Clock, labCaseId: string) {
  await assertReadyForDelivery(client, labCaseId);
  return client.labCase.update({
    where: { id: labCaseId },
    data: { status: LabCaseStatus.DELIVERED, deliveredAt: clock.now() },
  });
}

/**
 * LAB-003, automation A10. Cases past their expected return.
 *
 * Idempotent per case while the exception is open: a case a fortnight late
 * should be one loud item, not fourteen quiet ones.
 */
export async function sweepOverdueLabCases(
  client: TenantPrisma,
  clock: Clock,
  organizationId: string,
  clinicId: string,
): Promise<{ overdue: number }> {
  const now = clock.now();
  const late = await client.labCase.findMany({
    where: {
      organizationId, clinicId,
      status: { in: [LabCaseStatus.IN_PROGRESS_VENDOR, LabCaseStatus.DISPATCHED] },
      expectedReturnAt: { lt: now },
    },
  });

  let overdue = 0;
  for (const c of late) {
    const headline = `${c.reference} is overdue from ${c.vendor}`;
    const already = await client.attentionItem.findFirst({
      where: {
        organizationId, clinicId, code: 'LAB.DEADLINE.OVERDUE', headline,
        status: {
          in: [ExceptionStatus.OPEN, ExceptionStatus.ACKNOWLEDGED, ExceptionStatus.ACTION_IN_PROGRESS],
        },
      },
    });
    if (already) continue;

    const daysLate = Math.floor((now.getTime() - c.expectedReturnAt!.getTime()) / 86_400_000);
    await client.attentionItem.create({
      data: {
        organizationId, clinicId,
        code: 'LAB.DEADLINE.OVERDUE',
        severity: Priority.IMPORTANT,
        headline,
        detail: `${c.workType}, tooth ${c.toothRef}. Expected ${daysLate === 0 ? 'today' : `${daysLate} day${daysLate === 1 ? '' : 's'} ago`}.`,
        status: ExceptionStatus.OPEN,
        dueAt: c.expectedReturnAt!,
      },
    });
    overdue += 1;
  }
  return { overdue };
}

/** The list reception works from, with each case's next step spelled out. */
export async function listLabCases(client: TenantPrisma, clock: Clock, clinicId: string) {
  const rows = await client.labCase.findMany({
    where: { clinicId, status: { notIn: [LabCaseStatus.DELIVERED, LabCaseStatus.CANCELLED] } },
    orderBy: [{ expectedReturnAt: 'asc' }, { createdAt: 'asc' }],
  });
  const now = clock.now();
  return rows.map((c) => ({
    ...c,
    overdue: !!c.expectedReturnAt && c.expectedReturnAt < now && !c.receivedAt,
    delivery: deliveryReadiness(c),
    // A status word says where a thing is; this says what to do about it.
    nextStep: nextStepFor(c),
  }));
}

function nextStepFor(c: { status: string; qcResult: string | null }): string | null {
  switch (c.status) {
    case LabCaseStatus.CREATED: return 'Dispatch to the laboratory';
    case LabCaseStatus.REMAKE: return 'Re-dispatch for remake';
    case LabCaseStatus.IN_PROGRESS_VENDOR:
    case LabCaseStatus.DISPATCHED: return 'Waiting on the laboratory';
    case LabCaseStatus.QC_PENDING: return 'Doctor to check the case';
    case LabCaseStatus.PATIENT_READY: return 'Book the delivery appointment';
    default: return null;
  }
}

async function mustFind(client: TenantPrisma, id: string) {
  const c = await client.labCase.findUnique({ where: { id } });
  if (!c) throw new LabError('No such lab case.', 'NO_CASE');
  return c;
}
