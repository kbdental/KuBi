/**
 * Generation beyond the opening and closing sets.
 *
 * These exist because loading the real Master Activity Matrix exposed that the
 * scheduler could only ever reach two of seventeen processes. Of 28 enabled
 * definitions it generated 9; the other 19 — attendance, sterilisation,
 * equipment checks, emergency checks, audits — sat in the database, enabled,
 * producing nothing. No error, no warning. A hardcoded list does not break, it
 * just stops covering things.
 *
 * The weekly case has its own test for a specific reason: the first
 * implementation compared `clinicLocalWeekday(...) === 0` on a helper that
 * returns 1=Mon…7=Sun. `isWeekEnd` was therefore false on every day of every
 * week, and every weekly activity would have generated nothing for ever,
 * silently. Nothing but a test that runs on an actual Sunday catches that.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import { loadMatrixActivities } from '../../prisma/seed/load-opening-activities.js';
import {
  generateStandingTasks, isoWeek,
} from '../../apps/api/src/platform/workflow/scheduler.service.js';
import { FixedClock } from '../../apps/api/src/shared/clock.js';

let env: DemoEnvironment;
const suffix = randomUUID().slice(0, 6);

// 2026-08-01 is a Saturday, 08-02 a Sunday, 08-31 the last day of August.
const SATURDAY = '2026-08-01T04:00:00.000Z';
const SUNDAY = '2026-08-02T04:00:00.000Z';
const MONTH_END = '2026-08-31T04:00:00.000Z';

beforeAll(async () => {
  env = await seedVs01Demo(suffix);
  await withTenantContext(
    prisma,
    { organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false },
    (tx) => loadMatrixActivities(tx as never, env.organizationId, process.cwd()),
  );
}, 120_000);

afterAll(async () => { await prisma.$disconnect(); });

const codesFor = (clinicId: string) => withTenantContext(
  prisma,
  { organizationId: env.organizationId, clinicIds: [clinicId], crossClinic: false },
  async (tx) => {
    const rows = await tx.activityInstance.findMany({
      where: { clinicId },
      include: { definition: { select: { code: true, process: true, recurrence: true } } },
    });
    return rows.map((r) => ({
      code: r.definition.code,
      process: r.definition.process,
      recurrence: r.definition.recurrence,
      periodKey: r.periodKey,
    }));
  },
);

describe('standing daily work', () => {
  it('reaches processes the opening and closing sets never could', async () => {
    const r = await generateStandingTasks(
      prisma, new FixedClock(new Date(SATURDAY)), env.organizationId, env.clinicId,
    );
    expect(r.created).toBeGreaterThan(0);

    const made = await codesFor(env.clinicId);
    const processes = new Set(made.map((m) => m.process));
    // The whole point: not Opening Readiness and not Closing Readiness.
    expect(processes.has('Attendance')).toBe(true);
    expect(processes.size).toBeGreaterThan(2);
  });

  it('gives each activity its own due time rather than a shared anchor', async () => {
    // ATT-001 is "09:45" in the matrix — a clock time, needing no clinic
    // configuration at all. It must land at 09:45 clinic-local, not at opening.
    const made = await withTenantContext(
      prisma,
      { organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false },
      (tx) => tx.activityInstance.findFirst({
        where: { clinicId: env.clinicId, definition: { code: 'ATT-001' } },
        include: { definition: { select: { code: true } } },
      }),
    );
    expect(made).not.toBeNull();
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(made!.dueAt);
    expect(local).toBe('09:45');
  });

  it('is idempotent — a second pass on the same day creates nothing', async () => {
    const again = await generateStandingTasks(
      prisma, new FixedClock(new Date(SATURDAY)), env.organizationId, env.clinicId,
    );
    expect(again.created).toBe(0);
    expect(again.skippedExisting).toBeGreaterThan(0);
  });
});

describe('weekly and monthly work', () => {
  it('does not put a weekly audit on the list six days out of seven', async () => {
    const made = await codesFor(env.clinicId);
    // Saturday. Nothing weekly should exist yet.
    expect(made.filter((m) => m.recurrence === 'WEEKLY')).toEqual([]);
  });

  it('generates weekly work on the day the week ends', async () => {
    const r = await generateStandingTasks(
      prisma, new FixedClock(new Date(SUNDAY)), env.organizationId, env.clinicId,
    );
    expect(r.created).toBeGreaterThan(0);

    const made = await codesFor(env.clinicId);
    const weekly = made.filter((m) => m.recurrence === 'WEEKLY');
    expect(weekly.length).toBeGreaterThan(0);
    // Keyed by week, not by day — otherwise a weekly audit becomes a daily one
    // that happens to start on Sunday.
    for (const w of weekly) {
      expect(w.periodKey).toBe(`2026-W${isoWeek(new Date(SUNDAY), 'Asia/Kolkata')}`);
    }
  });

  it('generates monthly work on the last day of the month', async () => {
    await generateStandingTasks(
      prisma, new FixedClock(new Date(MONTH_END)), env.organizationId, env.clinicId,
    );
    const made = await codesFor(env.clinicId);
    const monthly = made.filter((m) => m.recurrence === 'MONTHLY');
    expect(monthly.length).toBeGreaterThan(0);
    expect(monthly[0]!.periodKey).toBe('2026-08');
  });
});

describe('what the matrix cannot schedule', () => {
  it('seeds unresolvable due rules disabled rather than inventing a time', async () => {
    const rows = await withTenantContext(
      prisma,
      { organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false },
      (tx) => tx.activityDefinition.findMany({
        where: { organizationId: env.organizationId, enabled: false },
        select: { code: true, dueRule: true },
      }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      // Every disabled definition says WHY, and carries the matrix's own words
      // so the decision can be taken against the source rather than a summary.
      const rule = r.dueRule as Record<string, unknown>;
      expect(rule.provenance).toBe('UNRESOLVED');
      expect(typeof rule.matrixPhrase).toBe('string');
    }
  });

  it('never generates from a disabled definition', async () => {
    const made = await codesFor(env.clinicId);
    const disabled = await withTenantContext(
      prisma,
      { organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false },
      (tx) => tx.activityDefinition.findMany({
        where: { organizationId: env.organizationId, enabled: false },
        select: { code: true },
      }),
    );
    const disabledCodes = new Set(disabled.map((d) => d.code));
    for (const m of made) expect(disabledCodes.has(m.code)).toBe(false);
  });
});
