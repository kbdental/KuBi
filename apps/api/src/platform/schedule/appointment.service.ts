/**
 * VS-02 — the clinic's day, driven by patients rather than by a task list.
 *
 * The point of integrating the schedule is not to display a diary. It is that
 * "are we ready?" only means something relative to "who is arriving, and
 * when". Opening at 09:00 matters because someone is sitting down at 09:30.
 *
 * Scope is deliberately the SCHEDULE and nothing else: no treatment, no
 * billing, no clinical record. KuBi needs to know where the day is; it does
 * not need to know what was done to a tooth.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { writeAudit } from '../audit/audit.service.js';
import { raiseAttentionItem } from '../signals/attention.service.js';

/** Where an appointment is, in the words a receptionist would use. */
export const AppointmentStatus = {
  BOOKED: 'BOOKED',
  ARRIVED: 'ARRIVED',
  IN_CHAIR: 'IN_CHAIR',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

/**
 * The only transitions that exist. Written as a table rather than a pile of
 * ifs so that "can this happen?" has one answer in one place — and so that
 * adding a state later forces a decision about every edge into it.
 *
 * COMPLETED and CANCELLED are terminal. Reopening a finished visit is not a
 * status change, it is a new appointment.
 */
const ALLOWED: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  BOOKED: ['ARRIVED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['IN_CHAIR', 'CANCELLED', 'NO_SHOW'],
  IN_CHAIR: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export class AppointmentTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppointmentTransitionError';
  }
}

/** Plain-language labels. No status token ever reaches a screen. */
export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  BOOKED: 'Expected',
  ARRIVED: 'Waiting',
  IN_CHAIR: 'In the chair',
  COMPLETED: 'Finished',
  CANCELLED: 'Cancelled',
  NO_SHOW: "Didn't come",
};

/** Statuses that still occupy the day — the ones "who's next" cares about. */
const STILL_TO_COME: readonly AppointmentStatus[] = ['BOOKED', 'ARRIVED', 'IN_CHAIR'];

export interface ScheduleRow {
  id: string;
  patientLabel: string;
  patientUhid: string;
  visitType: string;
  chairLabel: string | null;
  scheduledStart: Date;
  scheduledEnd: Date;
  status: AppointmentStatus;
  statusLabel: string;
  /** Waiting longer than they should be. Reception's actual question. */
  waitingMinutes: number | null;
  arrivedAt: Date | null;
}

export async function getSchedule(
  tx: TenantPrisma, clock: Clock, clinicId: string, periodKey: string,
): Promise<ScheduleRow[]> {
  const rows = await tx.appointment.findMany({
    where: { clinicId, periodKey },
    orderBy: { scheduledStart: 'asc' },
  });
  const patients = await tx.patient.findMany({
    where: { id: { in: rows.map((r) => r.patientId) } },
  });
  const now = clock.now();

  return rows.map((r) => {
    const p = patients.find((x) => x.id === r.patientId);
    const status = r.status as AppointmentStatus;
    return {
      id: r.id,
      patientLabel: p?.displayLabel ?? 'Unknown patient',
      patientUhid: p?.uhid ?? '',
      visitType: r.visitType,
      chairLabel: r.chairLabel,
      scheduledStart: r.scheduledStart,
      scheduledEnd: r.scheduledEnd,
      status,
      statusLabel: STATUS_LABEL[status] ?? 'Expected',
      waitingMinutes: r.arrivedAt && status === 'ARRIVED'
        ? Math.max(0, Math.round((now.getTime() - r.arrivedAt.getTime()) / 60_000))
        : null,
      arrivedAt: r.arrivedAt,
    };
  });
}

/**
 * The next patient the clinic has to be ready for.
 *
 * Not simply "the earliest appointment": one that has been cancelled, marked
 * a no-show, or already finished is not something to get ready for. Returns
 * null when there is nothing left today, which is a real answer and must not
 * be dressed up as a time.
 */
export async function nextPatientAt(
  tx: TenantPrisma, clinicId: string, periodKey: string,
): Promise<Date | null> {
  const row = await tx.appointment.findFirst({
    where: { clinicId, periodKey, status: { in: [...STILL_TO_COME] } },
    orderBy: { scheduledStart: 'asc' },
  });
  return row?.scheduledStart ?? null;
}

export async function setAppointmentStatus(
  tx: TenantPrisma,
  clock: Clock,
  input: {
    appointmentId: string;
    to: AppointmentStatus;
    employeeId: string;
    organizationId: string;
    reason?: string | null;
  },
) {
  const appt = await tx.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
  const from = appt.status as AppointmentStatus;

  if (!ALLOWED[from]?.includes(input.to)) {
    // Says what is true now and why the request does not fit, in clinic words.
    throw new AppointmentTransitionError(
      `This visit is already marked "${STATUS_LABEL[from]}", so it cannot be changed to "${STATUS_LABEL[input.to]}".`,
    );
  }
  if (input.to === 'CANCELLED' && !input.reason?.trim()) {
    throw new AppointmentTransitionError('Please say why this visit is being cancelled.');
  }

  const now = clock.now();
  const updated = await tx.appointment.update({
    where: { id: input.appointmentId },
    data: {
      status: input.to,
      ...(input.to === 'ARRIVED' ? { arrivedAt: now } : {}),
      ...(input.to === 'IN_CHAIR' ? { seatedAt: now } : {}),
      ...(input.to === 'COMPLETED' ? { completedAt: now } : {}),
      ...(input.to === 'CANCELLED'
        ? { cancelledAt: now, cancelReason: input.reason?.trim() ?? null }
        : {}),
    },
  });

  await writeAudit(tx, {
    organizationId: input.organizationId,
    clinicId: appt.clinicId,
    actorEmployeeId: input.employeeId,
    action: 'APPOINTMENT_STATUS_CHANGED',
    entityType: 'appointment',
    entityId: appt.id,
    oldValue: { status: from },
    newValue: { status: input.to },
    ...(input.reason ? { reason: input.reason } : {}),
  });

  return updated;
}

/**
 * The judgement that makes this an operating assistant rather than a diary:
 * the first patient is nearly here and the clinic is not ready yet.
 *
 * Raised once (deduplicated on code + day), owned by the clinic manager, and
 * only while it is still actionable — telling someone the clinic was not ready
 * for a patient who has already been seen is noise, and an attention list that
 * fills with noise stops being read.
 */
export async function checkReadinessAgainstFirstPatient(
  tx: TenantPrisma,
  clock: Clock,
  input: {
    organizationId: string;
    clinicId: string;
    periodKey: string;
    /** How close the first patient has to be before this is worth saying. */
    warnWithinMinutes?: number;
  },
): Promise<{ raised: boolean; reason: string }> {
  const warnWithin = input.warnWithinMinutes ?? 30;
  const now = clock.now();

  const firstAt = await nextPatientAt(tx, input.clinicId, input.periodKey);
  if (!firstAt) return { raised: false, reason: 'no patients left to prepare for' };

  const minutes = Math.round((firstAt.getTime() - now.getTime()) / 60_000);
  if (minutes > warnWithin) return { raised: false, reason: 'first patient is not close yet' };

  const outstanding = await tx.activityInstance.count({
    where: {
      clinicId: input.clinicId,
      periodKey: input.periodKey,
      status: { in: ['DUE', 'IN_PROGRESS', 'OVERDUE'] },
    },
  });
  if (outstanding === 0) return { raised: false, reason: 'clinic is ready' };

  await raiseAttentionItem(tx, clock, {
    organizationId: input.organizationId,
    clinicId: input.clinicId,
    code: 'SCH.READINESS.FIRST_PATIENT_IMMINENT',
    severity: 'CRITICAL',
    headline: minutes >= 0
      ? `First patient in ${minutes} min and the clinic is not ready yet`
      : 'First patient is due and the clinic is not ready yet',
    detail: `${outstanding} opening ${outstanding === 1 ? 'task is' : 'tasks are'} still outstanding.`,
    ownerRoleCode: 'CLINIC_MANAGER',
  });

  return { raised: true, reason: `${outstanding} outstanding with ${minutes} min to go` };
}
