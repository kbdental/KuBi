/**
 * The KPI layer — 16 control parameters rolled into one operational score.
 *
 * Every test here guards a specific way a management dashboard lies, because
 * a dashboard that lies is worse than no dashboard: it is trusted.
 *
 *   - a parameter with nothing to measure drawn as 0%
 *   - an absence averaged into the overall score
 *   - a patient-safety failure averaged away by routine ticks
 *   - work counted as done because the doer said so
 *
 * The last one is the reason the verification layer exists at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import {
  generateOpeningTasks, generateClosingTasks, clinicLocalDate,
} from '../../apps/api/src/platform/workflow/scheduler.service.js';
import { buildOperationalHealth } from '../../apps/api/src/platform/insight/parameter-score.service.js';
import { raiseAttentionItem } from '../../apps/api/src/platform/signals/attention.service.js';
import { systemClock } from '../../apps/api/src/shared/clock.js';
import { ActivityStatus, Parameter, Priority, RagStatus } from '@kubi/contracts';

let env: DemoEnvironment;
const suffix = randomUUID().slice(0, 6);
const periodKey = () => clinicLocalDate(systemClock.now(), 'Asia/Kolkata');

const ctx = () => ({
  organizationId: env.organizationId,
  clinicIds: [env.clinicId],
  crossClinic: false,
});

const health = () => withTenantContext(prisma, ctx(), (tx) =>
  buildOperationalHealth(tx, systemClock, env.clinicId, periodKey()));

const find = (h: Awaited<ReturnType<typeof health>>, p: Parameter) =>
  h.parameters.find((x) => x.parameter === p)!;

beforeAll(async () => {
  env = await seedVs01Demo(suffix);
  await generateOpeningTasks(prisma, systemClock, env.organizationId, env.clinicId);
  await generateClosingTasks(prisma, systemClock, env.organizationId, env.clinicId);
}, 90_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('operational health', () => {
  it('reports all 16 control parameters, always', async () => {
    const h = await health();
    expect(h.parameters).toHaveLength(16);
    expect(new Set(h.parameters.map((p) => p.parameter)).size).toBe(16);
  });

  it('scores a parameter with nothing to measure as GREY, not as zero', async () => {
    const h = await health();
    // Nothing in this fixture touches the laboratory.
    const lab = find(h, Parameter.LABORATORY);
    expect(lab.total).toBe(0);
    expect(lab.percent).toBeNull();
    expect(lab.status).toBe(RagStatus.GREY);
    // A 0% on a parameter the clinic was never asked to do today accuses it of
    // failing at something that did not exist.
    expect(lab.percent).not.toBe(0);
  });

  it('leaves GREY out of the overall score rather than averaging in an absence', async () => {
    // Something has to actually score, or every parameter is 0% and dividing
    // by 16 gives the same answer as dividing by 5 — the test would pass
    // whatever the code did. Room readiness is used by no other test here.
    await withTenantContext(prisma, ctx(), (tx) =>
      tx.activityInstance.updateMany({
        where: {
          clinicId: env.clinicId, periodKey: periodKey(),
          definition: { parameter: Parameter.ROOM_CHAIR_READINESS },
        },
        data: { status: ActivityStatus.VERIFIED },
      }));

    const h = await health();
    const measured = h.parameters.filter((p) => p.percent !== null);
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.length).toBeLessThan(16);

    const sum = measured.reduce((n, p) => n + p.percent!, 0);
    expect(sum).toBeGreaterThan(0);
    expect(h.percent).toBe(Math.round(sum / measured.length));

    // The bug this guards: dividing by 16 and reporting a clinic that ran five
    // parameters well today as being at 31% health.
    expect(h.percent).toBeGreaterThan(Math.round(sum / 16));
  });

  it('counts only confirmed work as done — not work the doer merely claimed', async () => {
    const before = find(await health(), Parameter.OPENING_READINESS);

    const id = await withTenantContext(prisma, ctx(), async (tx) => {
      const inst = await tx.activityInstance.findFirstOrThrow({
        where: {
          clinicId: env.clinicId, periodKey: periodKey(),
          definition: { parameter: Parameter.OPENING_READINESS },
        },
      });
      await tx.activityInstance.update({
        where: { id: inst.id }, data: { status: ActivityStatus.COMPLETED },
      });
      return inst.id;
    });

    // COMPLETED is somebody saying they did it. It must not move the score.
    const claimed = find(await health(), Parameter.OPENING_READINESS);
    expect(claimed.done).toBe(before.done);

    await withTenantContext(prisma, ctx(), (tx) =>
      tx.activityInstance.update({
        where: { id }, data: { status: ActivityStatus.VERIFIED },
      }));

    // VERIFIED is somebody else agreeing. Now it counts.
    const confirmed = find(await health(), Parameter.OPENING_READINESS);
    expect(confirmed.done).toBe(before.done + 1);
  });

  it('never averages a patient-safety failure away', async () => {
    // Confirm every safety activity, so the arithmetic alone would say 100%.
    await withTenantContext(prisma, ctx(), (tx) =>
      tx.activityInstance.updateMany({
        where: {
          clinicId: env.clinicId, periodKey: periodKey(),
          definition: { parameter: Parameter.SAFETY_EMERGENCY },
        },
        data: { status: ActivityStatus.VERIFIED },
      }));

    const clean = find(await health(), Parameter.SAFETY_EMERGENCY);
    expect(clean.percent).toBe(100);
    expect(clean.status).toBe(RagStatus.GREEN);

    // Now one real patient-safety problem, against an activity in that
    // parameter — the missing-consent case from the requirements.
    await withTenantContext(prisma, ctx(), async (tx) => {
      const inst = await tx.activityInstance.findFirstOrThrow({
        where: {
          clinicId: env.clinicId, periodKey: periodKey(),
          definition: { parameter: Parameter.SAFETY_EMERGENCY },
        },
      });
      await raiseAttentionItem(tx, systemClock, {
        organizationId: env.organizationId,
        clinicId: env.clinicId,
        code: 'TEST.SAFETY.OPEN',
        severity: Priority.PATIENT_SAFETY,
        headline: 'SYNTHETIC emergency kit seal is broken',
        detail: null,
        sourceInstanceId: inst.id,
        ownerRoleCode: 'CLINIC_MANAGER',
      });
    });

    const after = find(await health(), Parameter.SAFETY_EMERGENCY);
    // The arithmetic is untouched — and the status is RED anyway. A number
    // that can be satisfied by ticking enough routine boxes is not a safety
    // measure, it is a way of hiding one.
    expect(after.percent).toBe(100);
    expect(after.status).toBe(RagStatus.RED);
    expect(after.patientSafetyProblems).toBe(1);
    expect(after.because).toMatch(/patient safety/i);

    // And it pulls the whole clinic red, not just its own tile.
    const h = await health();
    expect(h.status).toBe(RagStatus.RED);
    expect(h.needsAttention.critical).toBeGreaterThan(0);
  });

  it('orders parameters worst first, and sinks GREY below everything real', async () => {
    const h = await health();
    const rank = { RED: 0, AMBER: 1, GREEN: 2, GREY: 3 } as const;
    const ranks = h.parameters.map((p) => rank[p.status]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);

    // Nothing GREY may appear above something that needs acting on: an empty
    // parameter pushing a red one below the fold is the whole failure mode.
    const firstGrey = h.parameters.findIndex((p) => p.status === RagStatus.GREY);
    const lastReal = h.parameters.map((p) => p.status).lastIndexOf(RagStatus.GREEN);
    if (firstGrey !== -1 && lastReal !== -1) expect(firstGrey).toBeGreaterThan(lastReal);
  });

  it('explains itself in clinic words, and says nothing when there is nothing to say', async () => {
    const h = await health();
    for (const p of h.parameters) {
      if (p.status === RagStatus.GREEN && p.openProblems === 0) {
        expect(p.because).toBeNull();
      }
      if (p.because !== null) {
        expect(p.because).not.toMatch(/[A-Z]{4,}_[A-Z]/);   // no enum tokens
        expect(p.because).toMatch(/\.$/);                    // a sentence
      }
    }
  });
});
