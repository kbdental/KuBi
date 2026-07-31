/**
 * The clinic at a glance — the screen an owner opens rather than a task list.
 *
 * Everything here is derived from what the clinic already recorded. Nothing is
 * estimated, nothing is smoothed, and a day with no data is reported as having
 * no data rather than as a zero — a 0% readiness on a Sunday would be a lie
 * about a day the clinic was shut.
 *
 * Kept deliberately small: four numbers a person can act on and one trend.
 * A dashboard that shows everything gets read as wallpaper.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { ActivityStatus, ExceptionStatus } from '@kubi/contracts';
import { clinicLocalDate } from '../workflow/scheduler.service.js';

export interface DayPoint {
  periodKey: string;
  /** Null when the clinic had no activities that day — shut, not failing. */
  readiness: number | null;
  onTime: boolean | null;
}

export interface Overview {
  /** Today's readiness as a percentage of the day's activities confirmed. */
  readiness: { done: number; total: number; percent: number | null };
  patients: { seen: number; expected: number; waiting: number; notSeen: number };
  problems: { open: number; patientSafety: number; overdue: number };
  /** Oldest first, so it reads left to right like a week does. */
  week: DayPoint[];
  /** Confirmed by someone other than the doer, as a share of all confirmed. */
  independentChecks: { independent: number; total: number; percent: number | null };
}

const DAYS_BACK = 7;

/** The last N clinic-local dates, oldest first. */
function recentDays(now: Date, timezone: string, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(clinicLocalDate(new Date(now.getTime() - i * 86_400_000), timezone));
  }
  return out;
}

export async function buildOverview(
  tx: TenantPrisma,
  clock: Clock,
  clinicId: string,
  timezone: string,
): Promise<Overview> {
  const now = clock.now();
  const days = recentDays(now, timezone, DAYS_BACK);
  const today = days[days.length - 1]!;

  // Readiness means "is this clinic ready to see patients?", so it is the
  // opening set and only the opening set. Folding the end-of-day checks in
  // would cap readiness in the low sixties every morning and never recover:
  // the closing work is not late at 09:30, it simply has not happened yet.
  // Whether the clinic closed properly is a different question, and it has its
  // own screen — the handover.
  const instances = await tx.activityInstance.findMany({
    where: {
      clinicId, periodKey: { in: days },
      definition: { process: 'Opening Readiness' },
    },
    select: { periodKey: true, status: true, dueAt: true, completedAt: true },
  });

  const confirmed = (s: string) => s === ActivityStatus.VERIFIED;

  // ---- today ----
  const todays = instances.filter((i) => i.periodKey === today);
  const doneToday = todays.filter((i) => confirmed(i.status)).length;

  // ---- the week ----
  const week: DayPoint[] = days.map((periodKey) => {
    const forDay = instances.filter((i) => i.periodKey === periodKey);
    if (forDay.length === 0) {
      // No activities is not zero readiness. It is a day with nothing to
      // report, and the chart must be able to say so.
      return { periodKey, readiness: null, onTime: null };
    }
    const done = forDay.filter((i) => confirmed(i.status)).length;
    const late = forDay.some(
      (i) => i.completedAt === null || (i.dueAt && i.completedAt > i.dueAt),
    );
    return {
      periodKey,
      readiness: Math.round((done / forDay.length) * 100),
      onTime: !late,
    };
  });

  // ---- patients ----
  const visits = await tx.appointment.findMany({
    where: { clinicId, periodKey: today },
    select: { status: true },
  });
  const count = (s: string) => visits.filter((v) => v.status === s).length;

  // ---- problems ----
  const openItems = await tx.attentionItem.findMany({
    where: {
      clinicId,
      status: {
        in: [ExceptionStatus.OPEN, ExceptionStatus.ACKNOWLEDGED, ExceptionStatus.ACTION_IN_PROGRESS],
      },
    },
    select: { severity: true, dueAt: true },
  });

  // ---- how independent the checking actually is ----
  // The number that says whether verification is real or a formality. Counted
  // over the week, because one day is noise.
  const verifications = await tx.verification.findMany({
    where: { instance: { clinicId, periodKey: { in: days } } },
    select: { selfVerified: true },
  });
  const independent = verifications.filter((v) => !v.selfVerified).length;

  return {
    readiness: {
      done: doneToday,
      total: todays.length,
      percent: todays.length === 0 ? null : Math.round((doneToday / todays.length) * 100),
    },
    patients: {
      seen: count('COMPLETED'),
      expected: visits.length - count('CANCELLED'),
      waiting: count('ARRIVED'),
      notSeen: count('NO_SHOW'),
    },
    problems: {
      open: openItems.length,
      patientSafety: openItems.filter((i) => i.severity === 'PATIENT_SAFETY').length,
      overdue: openItems.filter((i) => i.dueAt !== null && i.dueAt < now).length,
    },
    week,
    independentChecks: {
      independent,
      total: verifications.length,
      percent: verifications.length === 0
        ? null
        : Math.round((independent / verifications.length) * 100),
    },
  };
}
