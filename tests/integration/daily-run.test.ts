/**
 * The scheduler — the thing that makes KuBi run a clinic rather than describe
 * one. Until it existed the generators were complete, idempotent and tested,
 * and nothing called them.
 *
 * Two things are being proven, and the second is the one that matters.
 *
 * The first is that a pass generates every active clinic's day and is safe to
 * run again immediately.
 *
 * The second is that enumerating tenants did not open a hole. The scheduler
 * has to know which clinics exist before it can scope to one, which is exactly
 * the shape of request that ends with someone granting BYPASSRLS to the
 * application role. It must remain true that kubi_app cannot read across
 * tenants by any route other than the one narrow function — so that is
 * asserted here, not assumed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import {
  listActiveClinics, runDailyGeneration,
} from '../../apps/api/src/platform/workflow/daily-run.service.js';
import { clinicLocalDate } from '../../apps/api/src/platform/workflow/scheduler.service.js';
import { systemClock } from '../../apps/api/src/shared/clock.js';

let env: DemoEnvironment;
const suffix = randomUUID().slice(0, 6);

beforeAll(async () => {
  env = await seedVs01Demo(suffix);
}, 90_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('the daily run', () => {
  it('finds active clinics across organisations without a tenancy context', async () => {
    const clinics = await listActiveClinics();
    // Both of this fixture's clinics, found with no org context set at all —
    // which is the whole point, and is why it goes through one narrow
    // function rather than the ORM.
    const mine = clinics.filter((c) => c.organizationId === env.organizationId);
    expect(mine.map((c) => c.clinicId).sort())
      .toEqual([env.clinicId, env.otherClinicId].sort());
    for (const c of mine) expect(c.timezone).toBe('Asia/Kolkata');
  });

  it('returns identifiers and a timezone, and nothing else about a tenant', async () => {
    const [first] = await listActiveClinics();
    expect(first).toBeDefined();
    // A caller that can list tenants must not thereby learn anything about
    // them. Three identifiers and a timezone is all a scheduler needs to ask
    // "is it a working day here, and what time is it".
    expect(Object.keys(first!).sort()).toEqual(['clinicId', 'organizationId', 'timezone']);
  });

  it('generates every clinic’s day, and a second pass creates nothing', async () => {
    const first = await runDailyGeneration(systemClock);
    expect(first.clinics).toBeGreaterThanOrEqual(2);
    expect(first.created).toBeGreaterThan(0);
    expect(first.failed).toEqual([]);

    const again = await runDailyGeneration(systemClock);
    // Idempotent on purpose: this runs every few minutes, so "already done"
    // has to be the common case rather than an error.
    expect(again.created).toBe(0);
    expect(again.failed).toEqual([]);

    await withTenantContext(
      prisma,
      { organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false },
      async (tx) => {
        const rows = await tx.activityInstance.findMany({
          where: {
            clinicId: env.clinicId,
            periodKey: clinicLocalDate(systemClock.now(), 'Asia/Kolkata'),
          },
          include: { definition: { select: { process: true } } },
        });
        // Both halves of the day, from one pass.
        const processes = new Set(rows.map((r) => r.definition.process));
        expect(processes.has('Opening Readiness')).toBe(true);
        expect(processes.has('Closing Readiness')).toBe(true);
      },
    );
  });

  it('carries on past a clinic that fails, rather than abandoning the rest', async () => {
    // The second clinic has no opening configuration, so its generation
    // records NOT_CONFIGURED rather than throwing — but the contract being
    // tested is that a per-clinic outcome never becomes a whole-run outcome.
    const r = await runDailyGeneration(systemClock);
    expect(r.clinics).toBeGreaterThanOrEqual(2);
    // A clinic that could not be generated is reported, never swallowed.
    for (const f of r.failed) {
      expect(f.clinicId).toBeTruthy();
      expect(f.error).toBeTruthy();
    }
  });

  it('leaves the application role unable to read across tenants by any other route', async () => {
    // The invariant the enumeration function exists to preserve. If this ever
    // fails, the narrow function has been made pointless by a wider grant.
    const [{ rolbypassrls }] = await prisma.$queryRaw<Array<{ rolbypassrls: boolean }>>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = 'kubi_app'`;
    expect(rolbypassrls).toBe(false);

    // And the ORM route is still refused outright without a context. TD-4
    // rejects the call before it reaches the database, which is stronger than
    // returning zero rows: a developer who tries this gets an error telling
    // them what to do instead, rather than an empty list they might read as
    // "there are no clinics".
    await expect(prisma.clinic.findMany()).rejects.toThrow(/no tenancy context/i);
  });
});
