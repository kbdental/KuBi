/**
 * VS-02 — a synthetic day's schedule.
 *
 * NO real patient data. Every name is obviously invented and every record is
 * prefixed SYNTHETIC, so a screenshot or a stray database dump can never be
 * mistaken for a real clinic's list.
 *
 * The shape of the day is deliberate rather than random: it contains the cases
 * the screens actually have to handle — someone already waiting, a back-to-back
 * pair, a cancellation, and a gap. A demo day where everything is tidy proves
 * nothing.
 */
import type { TenantPrisma } from '../../apps/api/src/platform/tenancy/rls-context.js';
import type { Clock } from '../../apps/api/src/shared/clock.js';
import {
  clinicLocalDate, clinicLocalTimeToUtc,
} from '../../apps/api/src/platform/workflow/scheduler.service.js';

interface Slot {
  uhid: string;
  label: string;
  /** Clinic-local HH:mm. */
  start: string;
  minutes: number;
  visitType: string;
  chair: string;
  status?: 'BOOKED' | 'ARRIVED' | 'CANCELLED';
  arrivedMinutesAgo?: number;
  cancelReason?: string;
}

const DAY: readonly Slot[] = [
  { uhid: 'SYN-1001', label: 'SYNTHETIC Meera J.', start: '09:30', minutes: 30, visitType: 'Check-up', chair: 'Chair 1' },
  { uhid: 'SYN-1002', label: 'SYNTHETIC Arjun P.', start: '10:00', minutes: 45, visitType: 'Root canal', chair: 'Chair 2' },
  { uhid: 'SYN-1003', label: 'SYNTHETIC Fatima S.', start: '10:00', minutes: 30, visitType: 'Scaling', chair: 'Chair 1' },
  { uhid: 'SYN-1004', label: 'SYNTHETIC Daniel R.', start: '11:00', minutes: 30, visitType: 'Filling', chair: 'Chair 1',
    status: 'CANCELLED', cancelReason: 'SYNTHETIC: patient rescheduled to next week' },
  { uhid: 'SYN-1005', label: 'SYNTHETIC Priyanka N.', start: '11:30', minutes: 60, visitType: 'Crown fitting', chair: 'Chair 2' },
  { uhid: 'SYN-1006', label: 'SYNTHETIC Imran Q.', start: '12:30', minutes: 30, visitType: 'Check-up', chair: 'Chair 1' },
];

export async function seedScheduleForToday(
  tx: TenantPrisma,
  clock: Clock,
  input: { organizationId: string; clinicId: string; timezone?: string; providerEmployeeId?: string },
): Promise<number> {
  const timezone = input.timezone ?? 'Asia/Kolkata';
  const now = clock.now();
  const periodKey = clinicLocalDate(now, timezone);

  const existing = await tx.appointment.count({
    where: { clinicId: input.clinicId, periodKey },
  });
  if (existing > 0) return 0; // idempotent, like the activity scheduler

  let created = 0;
  for (const slot of DAY) {
    // Patients are org-scoped and reused across days, so upsert on the UHID.
    let patient = await tx.patient.findFirst({
      where: { organizationId: input.organizationId, uhid: slot.uhid },
    });
    patient ??= await tx.patient.create({
      data: {
        organizationId: input.organizationId,
        clinicId: input.clinicId,
        uhid: slot.uhid,
        displayLabel: slot.label,
      },
    });

    const start = clinicLocalTimeToUtc(periodKey, slot.start, timezone);
    const end = new Date(start.getTime() + slot.minutes * 60_000);

    await tx.appointment.create({
      data: {
        organizationId: input.organizationId,
        clinicId: input.clinicId,
        patientId: patient.id,
        ...(input.providerEmployeeId ? { providerEmployeeId: input.providerEmployeeId } : {}),
        periodKey,
        scheduledStart: start,
        scheduledEnd: end,
        chairLabel: slot.chair,
        visitType: slot.visitType,
        status: slot.status ?? 'BOOKED',
        ...(slot.status === 'ARRIVED'
          ? { arrivedAt: new Date(now.getTime() - (slot.arrivedMinutesAgo ?? 5) * 60_000) }
          : {}),
        ...(slot.status === 'CANCELLED'
          ? { cancelledAt: now, cancelReason: slot.cancelReason ?? 'SYNTHETIC: cancelled' }
          : {}),
      },
    });
    created += 1;
  }
  return created;
}
