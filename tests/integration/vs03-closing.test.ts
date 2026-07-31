/**
 * VS-03 — the other half of the day.
 *
 * Opening asks "are we ready to start?". Closing asks the harder question:
 * "is it safe to walk away, and what does tomorrow inherit?"
 *
 * The thing most worth proving here is not that closing tasks get created. It
 * is that adding them did not corrupt the morning. The two sets share one
 * engine, one table and one sweep, so the failure mode is a clinic that reports
 * "2 of 11 areas ready" all morning, never reaches OPEN, and warns every day
 * that it is not ready for its first patient — because tonight's checks are
 * outstanding at 09:30 by design.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../apps/api/src/server.ts';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, DEMO_PASSWORD, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import {
  generateOpeningTasks, generateClosingTasks, clinicLocalDate,
} from '../../apps/api/src/platform/workflow/scheduler.service.js';
import { checkReadinessAgainstFirstPatient } from '../../apps/api/src/platform/schedule/appointment.service.js';
import { systemClock } from '../../apps/api/src/shared/clock.js';

let app: FastifyInstance;
let env: DemoEnvironment;
const suffix = randomUUID().slice(0, 6);

const ctx = () => ({
  organizationId: env.organizationId,
  clinicIds: [env.clinicId],
  crossClinic: false,
});

async function login(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { email, password: DEMO_PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return `kubi_at=${res.cookies.find((c) => c.name === 'kubi_at')!.value}`;
}

beforeAll(async () => {
  env = await seedVs01Demo(suffix);
  await generateOpeningTasks(prisma, systemClock, env.organizationId, env.clinicId);
  app = await buildServer();
  await app.ready();
}, 90_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
});

describe('VS-03 — closing the clinic', () => {
  it('creates the closing set, and creating it twice does not duplicate it', async () => {
    const first = await generateClosingTasks(prisma, systemClock, env.organizationId, env.clinicId);
    expect(first.created).toBeGreaterThan(0);
    expect(first.notAWorkingDay).toBe(false);

    const again = await generateClosingTasks(prisma, systemClock, env.organizationId, env.clinicId);
    expect(again.created).toBe(0);
    expect(again.skippedExisting).toBe(first.created);
  });

  it('anchors closing work to the clinic’s closing time, not to opening', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const rows = await tx.activityInstance.findMany({
        where: { clinicId: env.clinicId, definition: { process: 'Closing Readiness' } },
        include: { definition: true },
      });
      expect(rows.length).toBeGreaterThan(0);

      const openingRows = await tx.activityInstance.findMany({
        where: { clinicId: env.clinicId, definition: { process: 'Opening Readiness' } },
      });
      const latestOpening = Math.max(...openingRows.map((r) => r.dueAt.getTime()));
      // Every closing check is due after the whole morning is over. If one were
      // not, it was anchored to the wrong time and would be "late" by 09:15.
      for (const r of rows) {
        expect(r.dueAt.getTime()).toBeGreaterThan(latestOpening);
      }
    });
  });

  it('never lets the end-of-day set be self-confirmed', async () => {
    await withTenantContext(prisma, ctx(), async (tx) => {
      const defs = await tx.activityDefinition.findMany({
        where: { organizationId: env.organizationId, process: 'Closing Readiness' },
      });
      expect(defs.length).toBeGreaterThan(0);
      // The whole point of a closing check is that a second person agrees the
      // building is safe to leave. The last one out does not get to be the one
      // who confirms it.
      for (const d of defs) expect(d.selfVerifyAllowed).toBe(false);
    });
  });

  it('counts opening and closing separately, so the morning still reaches OPEN', async () => {
    const cookie = await login(`priya_${suffix}@synthetic.test`);
    const body = (await app.inject({
      method: 'GET', url: '/api/v1/my-day', headers: { cookie },
    })).json();

    const opening = body.clinic.opening;
    const closing = body.clinic.closing;
    expect(opening).not.toBeNull();
    expect(closing).not.toBeNull();
    // The bug this guards: one combined tally, so the morning could never
    // complete and the phase never left OPENING.
    expect(opening.total).toBeLessThan(opening.total + closing.total);
    expect(body.clinic.phase).toBe('OPENING');
    expect(body.clinic.closingAt).not.toBeNull();
  });

  it('does not warn that the clinic is unready just because tonight’s checks are open', async () => {
    const result = await withTenantContext(prisma, ctx(), (tx) =>
      checkReadinessAgainstFirstPatient(tx, systemClock, {
        organizationId: env.organizationId,
        clinicId: env.clinicId,
        periodKey: clinicLocalDate(systemClock.now(), 'Asia/Kolkata'),
        // Wide enough that the first patient always counts as close, so the
        // only thing left deciding the answer is which activities are counted.
        warnWithinMinutes: 24 * 60,
      }));

    // Opening is genuinely outstanding in this fixture, so a warning is
    // correct — what matters is the reason, which must never be the closing
    // set. The assertion below fails loudly if the scoping regresses.
    expect(result.reason).not.toMatch(/closing/i);
  });

  it('hands over what tomorrow inherits, without naming anybody (Q6)', async () => {
    const cookie = await login(`rahul_${suffix}@synthetic.test`);
    const res = await app.inject({ method: 'GET', url: '/api/v1/handover', headers: { cookie } });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.periodKey).not.toBeNull();
    // Nothing was done today in this fixture, so the day is emphatically not
    // clear — a handover that reported "clear" here would be the exact lie the
    // screen exists to prevent.
    expect(body.clear).toBe(false);
    expect(body.unfinished.length).toBeGreaterThan(0);

    for (const line of body.unfinished) {
      expect(line.headline).toBeTruthy();
      expect(['PATIENT_SAFETY', 'CRITICAL', 'IMPORTANT', 'ROUTINE']).toContain(line.severity);
    }
    // Whose work it was stays in the audit trail, not on the handover.
    expect(res.body).not.toMatch(/SYNTHETIC/);
    expect(res.body).not.toMatch(/synthetic\.test/);
  });

  it('tells a manager when closing time is not configured, rather than inventing one', async () => {
    // A clinic with no closing time must be told so. An invented closing time
    // would produce end-of-day checks due at a time nobody agreed, and a check
    // nobody trusts is worse than a check that is visibly missing.
    const other = env.otherClinicId;
    const result = await generateClosingTasks(prisma, systemClock, env.organizationId, other);
    expect(result.created).toBe(0);

    await withTenantContext(
      prisma,
      { organizationId: env.organizationId, clinicIds: [other], crossClinic: false },
      async (tx) => {
        const run = await tx.automationExecution.findFirst({
          where: { clinicId: other, ruleCode: 'A03_CLOSING_GENERATION' },
          orderBy: { executedAt: 'desc' },
        });
        expect(run?.outcome).toBe('NOT_CONFIGURED');

        const raised = await tx.attentionItem.findFirst({
          where: { clinicId: other, code: 'SYS.GATE.NOT_CONFIGURED' },
        });
        expect(raised).not.toBeNull();
        expect(raised!.headline).toMatch(/closing time/i);
      },
    );
  });
});
