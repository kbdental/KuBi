/**
 * KuBi — task generation. The TRIGGER half of the operating loop.
 *
 * Evaluated in CLINIC-LOCAL time (DST-aware via the IANA zone on the clinic
 * row), never server-local. Every evaluation writes an automation_execution
 * row INCLUDING no-ops, so "why didn't my task appear?" is answerable.
 *
 * Idempotency is the DB unique constraint (definitionId, scopeKey, periodKey)
 * plus ON CONFLICT DO NOTHING — running the scheduler twice cannot duplicate
 * a task, and that guarantee does not depend on application logic being right.
 */
import type { TenantPrisma } from '../tenancy/rls-context.js';
import { withTenantContext } from '../tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { resolveActor, type ActorRef } from './assignment-resolver.js';
import { raiseAttentionItem } from '../signals/attention.service.js';
import { checkReadinessAgainstFirstPatient } from '../schedule/appointment.service.js';
import { ActivityStatus, Priority } from '@kubi/contracts';

/** Clinic-local calendar date, e.g. "2026-07-28". */
export function clinicLocalDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Clinic-local weekday, 1=Mon … 7=Sun. */
export function clinicLocalWeekday(instant: Date, timezone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(instant);
  return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[name] ?? 1;
}

/**
 * Resolve a clinic-local wall-clock time on a given local date to a UTC
 * instant. Uses the offset actually in effect on that date, so it stays
 * correct across DST transitions rather than assuming a fixed offset.
 */
export function clinicLocalTimeToUtc(localDate: string, hhmm: string, timezone: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  // Start from the naive UTC interpretation, then correct by the zone offset
  // that applies at that moment.
  const naive = new Date(`${localDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const asLocal = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(naive);
  const get = (t: string) => Number(asLocal.find((p) => p.type === t)?.value ?? 0);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = shown - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}

export interface GenerationResult {
  clinicId: string;
  periodKey: string;
  created: number;
  skippedExisting: number;
  unassigned: number;
  notAWorkingDay: boolean;
}

/**
 * Generate today's opening tasks for one clinic. Safe to call repeatedly.
 */
export async function generateOpeningTasks(
  prisma: TenantPrisma,
  clock: Clock,
  organizationId: string,
  clinicId: string,
): Promise<GenerationResult> {
  return withTenantContext(
    prisma,
    { organizationId, clinicIds: [clinicId], crossClinic: false },
    async (tx) => {
      const clinic = await tx.clinic.findUniqueOrThrow({ where: { id: clinicId } });
      const now = clock.now();
      const periodKey = clinicLocalDate(now, clinic.timezone);

      const cfg = await tx.configValue.findMany({
        where: { organizationId, clinicId, key: { in: ['clinic.opening_time', 'clinic.working_days'] } },
      });
      const openingTime =
        (cfg.find((c) => c.key === 'clinic.opening_time')?.valueJson as { value?: string } | null)?.value ?? null;
      const workingDays =
        (cfg.find((c) => c.key === 'clinic.working_days')?.valueJson as { value?: number[] } | null)?.value ?? null;

      if (!openingTime || !workingDays) {
        // Unconfigured is not "no tasks" — it is a setup gap someone must fix.
        await tx.automationExecution.create({
          data: {
            organizationId, clinicId, ruleCode: 'A02_OPENING_GENERATION', periodKey,
            outcome: 'NOT_CONFIGURED',
            detail: { missing: !openingTime ? 'clinic.opening_time' : 'clinic.working_days' },
          },
        });
        await raiseAttentionItem(tx, clock, {
          organizationId, clinicId,
          code: 'SYS.GATE.NOT_CONFIGURED',
          severity: Priority.CRITICAL,
          headline: "Opening times aren't set up for this clinic",
          detail: 'KuBi cannot create the morning checklists until opening time and working days are set.',
          ownerRoleCode: 'CLINIC_MANAGER',
        });
        return { clinicId, periodKey, created: 0, skippedExisting: 0, unassigned: 0, notAWorkingDay: false };
      }

      const weekday = clinicLocalWeekday(now, clinic.timezone);
      if (!workingDays.includes(weekday)) {
        await tx.automationExecution.create({
          data: {
            organizationId, clinicId, ruleCode: 'A02_OPENING_GENERATION', periodKey,
            outcome: 'SKIPPED_NON_WORKING_DAY', detail: { weekday },
          },
        });
        return { clinicId, periodKey, created: 0, skippedExisting: 0, unassigned: 0, notAWorkingDay: true };
      }

      const openingInstant = clinicLocalTimeToUtc(periodKey, openingTime, clinic.timezone);
      const definitions = await tx.activityDefinition.findMany({
        where: { organizationId, enabled: true, process: 'Opening Readiness' },
        orderBy: { code: 'asc' },
      });

      let created = 0, skippedExisting = 0, unassigned = 0;

      for (const def of definitions) {
        const existing = await tx.activityInstance.findUnique({
          where: {
            definitionId_scopeKey_periodKey: {
              definitionId: def.id, scopeKey: clinicId, periodKey,
            },
          },
        });
        if (existing) { skippedExisting++; continue; }

        const rule = def.assignmentRule as unknown as { doer: ActorRef };
        const doer = await resolveActor(tx, clock, organizationId, clinicId, rule.doer);

        const dueRule = def.dueRule as { offsetMinutes?: number };
        const dueAt = new Date(openingInstant.getTime() + (dueRule.offsetMinutes ?? 0) * 60_000);

        await tx.activityInstance.create({
          data: {
            organizationId, clinicId,
            definitionId: def.id,
            definitionVersion: def.version,
            scopeKey: clinicId,
            periodKey,
            status: ActivityStatus.DUE,
            assigneeEmployeeId: doer.employeeIds[0] ?? null,
            dueAt,
          },
        });
        created++;

        if (doer.unresolved) {
          unassigned++;
          await raiseAttentionItem(tx, clock, {
            organizationId, clinicId,
            code: 'SYS.DATA_INCOMPLETE.NO_ASSIGNEE',
            severity: Priority.IMPORTANT,
            headline: `Nobody is assigned to "${def.title}"`,
            detail: doer.reason ?? null,
            ownerRoleCode: 'CLINIC_MANAGER',
          });
        }
      }

      await tx.automationExecution.create({
        data: {
          organizationId, clinicId, ruleCode: 'A02_OPENING_GENERATION', periodKey,
          outcome: created > 0 ? 'CREATED' : 'NO_OP',
          detail: { created, skippedExisting, unassigned },
        },
      });

      return { clinicId, periodKey, created, skippedExisting, unassigned, notAWorkingDay: false };
    },
  );
}

/**
 * Move past-due, incomplete tasks to OVERDUE and raise a PROBLEM.
 * Implements A29 (task overdue) for the opening set.
 */
export async function sweepOverdue(
  prisma: TenantPrisma,
  clock: Clock,
  organizationId: string,
  clinicId: string,
): Promise<number> {
  return withTenantContext(
    prisma,
    { organizationId, clinicIds: [clinicId], crossClinic: false },
    async (tx) => {
      const now = clock.now();
      const stale = await tx.activityInstance.findMany({
        where: {
          organizationId, clinicId,
          status: { in: [ActivityStatus.DUE, ActivityStatus.IN_PROGRESS] },
          dueAt: { lt: now },
        },
        include: { definition: true },
      });

      for (const inst of stale) {
        await tx.activityInstance.update({
          where: { id: inst.id },
          data: { status: ActivityStatus.OVERDUE },
        });
        await raiseAttentionItem(tx, clock, {
          organizationId, clinicId,
          code: `OPN.OVERDUE.${inst.definition.code.replace('-', '_')}`,
          severity: inst.definition.priority,
          headline: `"${inst.definition.title}" is late`,
          detail: inst.definition.failureDefinition,
          sourceInstanceId: inst.id,
          ownerEmployeeId: inst.assigneeEmployeeId,
          ownerRoleCode: 'CLINIC_MANAGER',
        });
      }
      // VS-02: the sweep also asks the question that makes this an operating
      // assistant rather than a task tracker -- is the first patient nearly
      // here while the clinic is still not ready? Deduplicated by the
      // attention service, so a sweep every few minutes does not flood anyone.
      const clinic = await tx.clinic.findUnique({ where: { id: clinicId } });
      if (clinic) {
        await checkReadinessAgainstFirstPatient(tx, clock, {
          organizationId,
          clinicId,
          periodKey: clinicLocalDate(now, clinic.timezone),
        });
      }

      return stale.length;
    },
  );
}
