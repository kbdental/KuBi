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
import {
  ActivityStatus, Priority, Recurrence, InstanceScope, DueRuleKind,
} from '@kubi/contracts';

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
 * What separates one daily set from another.
 *
 * Opening and closing are the same machinery pointed at a different anchor —
 * so they share one generator. Writing a second copy for closing is how the
 * two quietly drift: one gets the idempotency fix, the other keeps the bug.
 */
interface DailySet {
  /** The `process` on the activity definitions that belong to this set. */
  process: string;
  /** The automation rule code recorded against every run. */
  ruleCode: string;
  /** The config key holding the clinic-local time the set is anchored to. */
  anchorConfigKey: string;
  /** What to tell a manager when that time is not configured. */
  notConfiguredHeadline: string;
  notConfiguredDetail: string;
}

const OPENING_SET: DailySet = {
  process: 'Opening Readiness',
  ruleCode: 'A02_OPENING_GENERATION',
  anchorConfigKey: 'clinic.opening_time',
  notConfiguredHeadline: "Opening times aren't set up for this clinic",
  notConfiguredDetail:
    'KuBi cannot create the morning checklists until opening time and working days are set.',
};

const CLOSING_SET: DailySet = {
  process: 'Closing Readiness',
  ruleCode: 'A03_CLOSING_GENERATION',
  anchorConfigKey: 'clinic.closing_time',
  notConfiguredHeadline: "Closing time isn't set up for this clinic",
  notConfiguredDetail:
    'KuBi cannot create the end-of-day checks until the clinic’s closing time is set. '
    + 'Until then nobody is being asked to confirm the building was left safe.',
};

async function generateDailySet(
  set: DailySet,
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
        where: { organizationId, clinicId, key: { in: [set.anchorConfigKey, 'clinic.working_days'] } },
      });
      const anchorTime =
        (cfg.find((c) => c.key === set.anchorConfigKey)?.valueJson as { value?: string } | null)?.value ?? null;
      const workingDays =
        (cfg.find((c) => c.key === 'clinic.working_days')?.valueJson as { value?: number[] } | null)?.value ?? null;

      if (!anchorTime || !workingDays) {
        // Unconfigured is not "no tasks" — it is a setup gap someone must fix.
        await tx.automationExecution.create({
          data: {
            organizationId, clinicId, ruleCode: set.ruleCode, periodKey,
            outcome: 'NOT_CONFIGURED',
            detail: { missing: !anchorTime ? set.anchorConfigKey : 'clinic.working_days' },
          },
        });
        await raiseAttentionItem(tx, clock, {
          organizationId, clinicId,
          code: 'SYS.GATE.NOT_CONFIGURED',
          severity: Priority.CRITICAL,
          headline: set.notConfiguredHeadline,
          detail: set.notConfiguredDetail,
          ownerRoleCode: 'CLINIC_MANAGER',
        });
        return { clinicId, periodKey, created: 0, skippedExisting: 0, unassigned: 0, notAWorkingDay: false };
      }

      const weekday = clinicLocalWeekday(now, clinic.timezone);
      if (!workingDays.includes(weekday)) {
        await tx.automationExecution.create({
          data: {
            organizationId, clinicId, ruleCode: set.ruleCode, periodKey,
            outcome: 'SKIPPED_NON_WORKING_DAY', detail: { weekday },
          },
        });
        return { clinicId, periodKey, created: 0, skippedExisting: 0, unassigned: 0, notAWorkingDay: true };
      }

      const openingInstant = clinicLocalTimeToUtc(periodKey, anchorTime, clinic.timezone);
      const definitions = await tx.activityDefinition.findMany({
        where: { organizationId, enabled: true, process: set.process },
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
          organizationId, clinicId, ruleCode: set.ruleCode, periodKey,
          outcome: created > 0 ? 'CREATED' : 'NO_OP',
          detail: { created, skippedExisting, unassigned },
        },
      });

      return { clinicId, periodKey, created, skippedExisting, unassigned, notAWorkingDay: false };
    },
  );
}

/**
 * Generate today's opening tasks for one clinic. Safe to call repeatedly.
 */
export const generateOpeningTasks = (
  prisma: TenantPrisma, clock: Clock, organizationId: string, clinicId: string,
): Promise<GenerationResult> =>
  generateDailySet(OPENING_SET, prisma, clock, organizationId, clinicId);

/**
 * Generate today's closing checks for one clinic. Safe to call repeatedly.
 *
 * Anchored to the clinic's closing time, so the definitions' negative offsets
 * mean "before we close" — a sterilisation run started at closing time is a run
 * nobody waits for. Generated in the same pass as opening rather than late in
 * the day: a closing check nobody can see until 19:00 is a check nobody plans
 * their afternoon around.
 */
export const generateClosingTasks = (
  prisma: TenantPrisma, clock: Clock, organizationId: string, clinicId: string,
): Promise<GenerationResult> =>
  generateDailySet(CLOSING_SET, prisma, clock, organizationId, clinicId);

/**
 * Everything else the clinic owes today.
 *
 * The opening and closing generators above are anchored to one configured time
 * each and filter on one named process each. That was correct while KuBi had
 * nine activities in two processes. Loading the real Master Activity Matrix
 * exposed what it costs: of 28 enabled definitions, the two named sets could
 * reach 9. Nineteen — attendance, sterilisation, follow-up calls, equipment
 * checks, emergency checks, audits — existed in the database, were enabled,
 * and generated nothing at all. Silently: no error, no warning, just a clinic
 * that never saw the work.
 *
 * That is the failure mode a hardcoded list always has. It does not break, it
 * just stops covering things, and nothing tells you.
 *
 * So this generates every remaining DAILY, clinic-scoped definition, each due
 * at ITS OWN time rather than at a shared anchor:
 *
 *   CLOCK        — a clinic-local time the matrix states outright (ATT-001 at
 *                  09:45). Needs no interpretation.
 *   CLINIC_EVENT — anchored to opening or closing plus an offset, read from
 *                  the clinic's own configuration.
 *
 * Anything else is skipped rather than guessed, and counted so the skip is
 * visible. A definition whose due rule KuBi cannot resolve must not acquire a
 * plausible-looking deadline on the way through a scheduler.
 */
const NAMED_SETS = [OPENING_SET.process, CLOSING_SET.process];

export async function generateStandingTasks(
  prisma: TenantPrisma,
  clock: Clock,
  organizationId: string,
  clinicId: string,
): Promise<GenerationResult & { unscheduled: number }> {
  const now = clock.now();
  // withTenantContext, not $transaction: the RLS context is transaction-scoped
  // and a bare $transaction establishes none, so every query inside it is
  // refused. TD-4 caught this the first time it ran against real data.
  return withTenantContext(
    prisma,
    { organizationId, clinicIds: [clinicId], crossClinic: false },
    async (tx) => {
    const clinic = await tx.clinic.findUnique({ where: { id: clinicId } });
    if (!clinic) {
      return {
        clinicId, periodKey: '', created: 0, skippedExisting: 0,
        unassigned: 0, notAWorkingDay: false, unscheduled: 0,
      };
    }
    const periodKey = clinicLocalDate(now, clinic.timezone);

    const cfg = await tx.configValue.findMany({
      where: {
        organizationId, clinicId,
        key: { in: ['clinic.opening_time', 'clinic.closing_time'] },
      },
    });
    const anchorTime = (key: string) =>
      (cfg.find((c) => c.key === key)?.valueJson as { value?: string } | null)?.value ?? null;

    const definitions = await tx.activityDefinition.findMany({
      where: {
        organizationId,
        enabled: true,
        // WEEKLY and MONTHLY are here too, not in a separate pass. A weekly
        // audit is the same generation with a different period key, and a
        // second copy of this loop is how the two drift apart.
        recurrence: { in: [Recurrence.DAILY, Recurrence.WEEKLY, Recurrence.MONTHLY] },
        instanceScope: InstanceScope.CLINIC_DAY,
        process: { notIn: NAMED_SETS },
      },
      orderBy: { code: 'asc' },
    });

    // Whether today closes a week or a month, in the CLINIC's timezone.
    // Sunday closes the week: the matrix says "week end", and the clinic's own
    // working-days configuration decides which days it is open, not which day
    // the week ends on.
    // 7 is Sunday. clinicLocalWeekday is 1=Mon…7=Sun, NOT JavaScript's
    // 0=Sun — comparing against 0 here made isWeekEnd permanently false, so
    // every weekly activity generated nothing, for ever, without an error.
    const isWeekEnd = clinicLocalWeekday(now, clinic.timezone) === 7;
    const tomorrow = clinicLocalDate(new Date(now.getTime() + 86_400_000), clinic.timezone);
    const isMonthEnd = tomorrow.slice(0, 7) !== periodKey.slice(0, 7);

    let created = 0, skippedExisting = 0, unassigned = 0, unscheduled = 0;

    for (const def of definitions) {
      const rule = def.dueRule as {
        kind?: string; time?: string; anchor?: string; offsetMinutes?: number;
      };

      // A weekly activity is not due six days out of seven, and generating it
      // daily would put an audit on the list every morning until somebody
      // stopped reading the list.
      if (def.recurrence === Recurrence.WEEKLY && !isWeekEnd) continue;
      if (def.recurrence === Recurrence.MONTHLY && !isMonthEnd) continue;

      // Its own period, so a weekly audit is one row per week rather than one
      // per day — the idempotency key is what makes that true.
      const instancePeriodKey = def.recurrence === Recurrence.WEEKLY
        ? `${periodKey.slice(0, 4)}-W${isoWeek(now, clinic.timezone)}`
        : def.recurrence === Recurrence.MONTHLY
          ? periodKey.slice(0, 7)
          : periodKey;

      let dueAt: Date | null = null;
      if (rule.kind === DueRuleKind.CLOCK && rule.time) {
        dueAt = clinicLocalTimeToUtc(periodKey, rule.time, clinic.timezone);
      } else if (rule.kind === DueRuleKind.PERIOD_END) {
        // Due at the clinic's closing time on the day the period ends. Without
        // a closing time there is no honest moment to place it.
        const t = anchorTime('clinic.closing_time');
        if (t) dueAt = clinicLocalTimeToUtc(periodKey, t, clinic.timezone);
      } else if (rule.kind === DueRuleKind.CLINIC_EVENT) {
        const key = rule.anchor === 'CLOSING' ? 'clinic.closing_time' : 'clinic.opening_time';
        const t = anchorTime(key);
        if (t) {
          dueAt = new Date(
            clinicLocalTimeToUtc(periodKey, t, clinic.timezone).getTime()
            + (rule.offsetMinutes ?? 0) * 60_000,
          );
        }
      }

      // No resolvable time is not a reason to invent one.
      if (!dueAt) { unscheduled++; continue; }

      const existing = await tx.activityInstance.findUnique({
        where: {
          definitionId_scopeKey_periodKey: {
            definitionId: def.id, scopeKey: clinicId, periodKey: instancePeriodKey,
          },
        },
      });
      if (existing) { skippedExisting++; continue; }

      const assignment = def.assignmentRule as unknown as { doer: ActorRef };
      const doer = await resolveActor(tx, clock, organizationId, clinicId, assignment.doer);

      await tx.activityInstance.create({
        data: {
          organizationId, clinicId,
          definitionId: def.id,
          definitionVersion: def.version,
          scopeKey: clinicId,
          periodKey: instancePeriodKey,
          status: ActivityStatus.DUE,
          assigneeEmployeeId: doer.employeeIds[0] ?? null,
          dueAt,
        },
      });
      created++;
      if (doer.unresolved) unassigned++;
    }

    return {
      clinicId, periodKey, created, skippedExisting, unassigned,
      notAWorkingDay: false, unscheduled,
    };
    },
  );
}

/**
 * Move past-due, incomplete tasks to OVERDUE and raise a PROBLEM.
 * Implements A29 (task overdue) for every daily set — each instance is judged
 * against its own dueAt, so a closing check is late at its own deadline and not
 * at the morning's.
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
          // The prefix says which half of the day it belongs to, because the
          // code is what deduplication matches on and what a report groups by.
          code: `${inst.definition.process === 'Closing Readiness' ? 'CLS' : 'OPN'}`
            + `.OVERDUE.${inst.definition.code.replace('-', '_')}`,
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

/**
 * ISO week number in the clinic's timezone, zero-padded.
 *
 * Its own function because "which week is it" is a question with a wrong
 * answer that looks right for fifty weeks a year: a naive day-of-year/7 puts
 * the days either side of New Year in the same bucket, so a January audit
 * silently satisfies December's.
 */
export function isoWeek(instant: Date, timezone: string): string {
  const local = clinicLocalDate(instant, timezone);
  const [y, m, d] = local.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  // Shift to the Thursday of this week; ISO weeks are numbered by the Thursday.
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return String(week).padStart(2, '0');
}
