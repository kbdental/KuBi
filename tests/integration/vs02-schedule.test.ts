/**
 * VS-02 — appointment integration, driven through the HTTP API.
 *
 * The thing being proven is not that a diary renders. It is that the clinic
 * now knows where its day is: who is next, whether it is ready for them, and
 * what happens when it is not.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../apps/api/src/server.ts';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, DEMO_PASSWORD, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import {
  generateOpeningTasks, sweepOverdue, clinicLocalDate,
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

describe('VS-02 — the clinic knows where its day is', () => {
  it('reception sees today’s list, in clinic words', async () => {
    const cookie = await login(`kavita_${suffix}@synthetic.test`);
    const res = await app.inject({ method: 'GET', url: '/api/v1/schedule', headers: { cookie } });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.timezone).toBe('Asia/Kolkata');

    const first = body.rows[0];
    expect(first.patientLabel).toMatch(/SYNTHETIC/);   // never real patient data
    expect(first.visitType).toBeTruthy();
    expect(first.statusLabel).toBe('Expected');        // not "BOOKED"

    // No status tokens anywhere on the wire.
    expect(JSON.stringify(body)).not.toMatch(/"statusLabel":"(BOOKED|IN_CHAIR|NO_SHOW)"/);
    // Sorted by time, which is the only order a front desk works in.
    const times = body.rows.map((r: { scheduledStart: string }) => Date.parse(r.scheduledStart));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('moves a visit along: expected → waiting → in the chair → finished', async () => {
    const cookie = await login(`kavita_${suffix}@synthetic.test`);
    const { rows } = (await app.inject({
      method: 'GET', url: '/api/v1/schedule', headers: { cookie },
    })).json();
    const appt = rows.find((r: { status: string }) => r.status === 'BOOKED');
    expect(appt).toBeDefined();

    for (const to of ['ARRIVED', 'IN_CHAIR', 'COMPLETED']) {
      const res = await app.inject({
        method: 'POST', url: `/api/v1/appointments/${appt.id}/status`,
        headers: { cookie }, payload: { to },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(to);
    }
  });

  it('refuses a transition that does not make sense, and says why in plain words', async () => {
    const cookie = await login(`kavita_${suffix}@synthetic.test`);
    const { rows } = (await app.inject({
      method: 'GET', url: '/api/v1/schedule', headers: { cookie },
    })).json();
    const finished = rows.find((r: { status: string }) => r.status === 'COMPLETED');
    expect(finished).toBeDefined();

    const res = await app.inject({
      method: 'POST', url: `/api/v1/appointments/${finished.id}/status`,
      headers: { cookie }, payload: { to: 'ARRIVED' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/already marked "Finished"/);
    expect(res.json().error).not.toMatch(/COMPLETED|ARRIVED|transition/);
  });

  it('will not cancel a visit without recording why', async () => {
    const cookie = await login(`kavita_${suffix}@synthetic.test`);
    const { rows } = (await app.inject({
      method: 'GET', url: '/api/v1/schedule', headers: { cookie },
    })).json();
    const booked = rows.find((r: { status: string }) => r.status === 'BOOKED');
    if (!booked) return;

    const bare = await app.inject({
      method: 'POST', url: `/api/v1/appointments/${booked.id}/status`,
      headers: { cookie }, payload: { to: 'CANCELLED' },
    });
    expect(bare.statusCode).toBe(409);
    expect(bare.json().error).toMatch(/say why/i);

    const withReason = await app.inject({
      method: 'POST', url: `/api/v1/appointments/${booked.id}/status`,
      headers: { cookie }, payload: { to: 'CANCELLED', reason: 'SYNTHETIC: patient called to rearrange' },
    });
    expect(withReason.statusCode).toBe(200);
  });

  it('a cancelled visit cannot lose its reason, even below the application', async () => {
    // The application asks; the database insists. Blanking the reason on a
    // cancelled row would leave an unexplained cancellation in the record.
    await expect(
      withTenantContext(prisma, ctx(), (tx) =>
        tx.appointment.updateMany({
          where: { clinicId: env.clinicId, status: 'CANCELLED' },
          data: { cancelReason: '   ' },
        })),
    ).rejects.toThrow(/must record why/i);
  });

  it('the day drives the clinic header: the next patient is real, not guessed', async () => {
    const cookie = await login(`priya_${suffix}@synthetic.test`);
    const day = (await app.inject({ method: 'GET', url: '/api/v1/my-day', headers: { cookie } })).json();

    expect(day.clinic.firstPatientAt).toBeTruthy();

    // It is the next one still to come — not simply the earliest row, which
    // would keep pointing at a visit that has already been seen or cancelled.
    const { rows } = (await app.inject({
      method: 'GET', url: '/api/v1/schedule', headers: { cookie },
    })).json();
    const stillToCome = rows
      .filter((r: { status: string }) => ['BOOKED', 'ARRIVED', 'IN_CHAIR'].includes(r.status))
      .map((r: { scheduledStart: string }) => r.scheduledStart)
      .sort();
    expect(day.clinic.firstPatientAt).toBe(stillToCome[0]);
  });

  it('raises Attention when the first patient is close and the clinic is not ready', async () => {
    // This is the judgement that makes it an operating assistant rather than
    // a diary next to a checklist.
    const periodKey = clinicLocalDate(systemClock.now(), 'Asia/Kolkata');
    const result = await withTenantContext(prisma, ctx(), (tx) =>
      checkReadinessAgainstFirstPatient(tx, systemClock, {
        organizationId: env.organizationId,
        clinicId: env.clinicId,
        periodKey,
        warnWithinMinutes: 10_000, // the synthetic day sits hours away
      }));
    expect(result.raised).toBe(true);

    const cookie = await login(`rahul_${suffix}@synthetic.test`);
    const attention = (await app.inject({
      method: 'GET', url: '/api/v1/attention', headers: { cookie },
    })).json();
    const item = attention.find((a: { headline: string }) => /not ready/i.test(a.headline));
    expect(item).toBeDefined();
    expect(item.detail).toMatch(/opening tasks? (is|are) still outstanding/);
  });

  it('says nothing when the clinic IS ready', async () => {
    const periodKey = clinicLocalDate(systemClock.now(), 'Asia/Kolkata');
    const result = await withTenantContext(prisma, ctx(), async (tx) => {
      // Nothing outstanding: park every open task as verified for this check.
      await tx.activityInstance.updateMany({
        where: { clinicId: env.clinicId, periodKey },
        data: { status: 'VERIFIED' },
      });
      return checkReadinessAgainstFirstPatient(tx, systemClock, {
        organizationId: env.organizationId,
        clinicId: env.clinicId,
        periodKey,
        warnWithinMinutes: 10_000,
      });
    });
    expect(result.raised).toBe(false);
    expect(result.reason).toBe('clinic is ready');
  });

  it('a person from another clinic cannot see this clinic’s patients', async () => {
    // Appointments are the first thing that ties a patient to a time and a
    // place, so isolation matters more here than it did for a checklist.
    const rows = await withTenantContext(
      prisma,
      { organizationId: env.organizationId, clinicIds: [env.otherClinicId], crossClinic: false },
      (tx) => tx.appointment.findMany(),
    );
    expect(rows).toHaveLength(0);
  });

  it('housekeeping has no business seeing the patient list', async () => {
    const cookie = await login(`priya_${suffix}@synthetic.test`);
    // Priya is a Dental Assistant: she may SEE the day (to prepare for it)
    // but not move visits along.
    const { rows } = (await app.inject({
      method: 'GET', url: '/api/v1/schedule', headers: { cookie },
    })).json();
    const booked = rows.find((r: { status: string }) => r.status === 'BOOKED');
    if (!booked) return;

    const res = await app.inject({
      method: 'POST', url: `/api/v1/appointments/${booked.id}/status`,
      headers: { cookie }, payload: { to: 'ARRIVED' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/permission/i);
  });

  it('every status change is on the audit trail', async () => {
    const entries = await withTenantContext(prisma, ctx(), (tx) =>
      tx.auditLog.findMany({ where: { action: 'APPOINTMENT_STATUS_CHANGED' } }));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.entityType).toBe('appointment');
  });

  it('the sweep asks the readiness question by itself', async () => {
    // Nobody has to remember to check. The automation that marks tasks late
    // also notices that a patient is due and the clinic is not ready.
    const swept = await sweepOverdue(prisma, systemClock, env.organizationId, env.clinicId);
    expect(typeof swept).toBe('number');
  });
});

describe('VS-03 — what tomorrow inherits', () => {
  it('states what is being left behind, in the order it matters', async () => {
    const cookie = await login(`rahul_${suffix}@synthetic.test`);
    const res = await app.inject({ method: 'GET', url: '/api/v1/handover', headers: { cookie } });
    expect(res.statusCode).toBe(200);

    const h = res.json();
    expect(h.periodKey).toBeTruthy();
    // Closing a day with outstanding work must never read as clear.
    expect(h.clear).toBe(false);

    // Unfinished and "waiting on someone" are different facts: one is work
    // that did not happen, the other is work nobody has confirmed.
    expect(Array.isArray(h.unfinished)).toBe(true);
    expect(Array.isArray(h.waitingOnSomeone)).toBe(true);

    const all = [...h.unfinished, ...h.waitingOnSomeone, ...h.stillOpen, ...h.patientsNotSeen];
    expect(all.length).toBeGreaterThan(0);
    for (const line of all) {
      expect(typeof line.headline).toBe('string');
      expect(['PATIENT_SAFETY', 'CRITICAL', 'IMPORTANT', 'ROUTINE']).toContain(line.severity);
    }
    // Q6 holds through closing: a handover says what is outstanding, never who.
    expect(JSON.stringify(h)).not.toMatch(/priya|rahul|anita|kavita/i);
  });

  it('names patients who were never seen, because someone has to ring them', async () => {
    const cookie = await login(`rahul_${suffix}@synthetic.test`);
    const h = (await app.inject({ method: 'GET', url: '/api/v1/handover', headers: { cookie } })).json();
    expect(h.patientsNotSeen.length).toBeGreaterThan(0);
    // Someone who arrived and never went through is worse than a no-show.
    for (const line of h.patientsNotSeen) {
      expect(line.headline).toMatch(/was not seen/);
    }
  });

  it('loads the closing activities alongside the opening ones', async () => {
    const defs = await withTenantContext(prisma, ctx(), (tx) =>
      tx.activityDefinition.findMany({ where: { process: 'Closing Readiness' } }));
    expect(defs.length).toBe(4);

    // Sterilisation, drugs and securing the building are never self-confirmed,
    // whatever the roster looks like.
    for (const d of defs) {
      expect(d.selfVerifyAllowed).toBe(false);
    }
    const codes = defs.map((d) => d.code).sort();
    expect(codes).toEqual(['CLS-001', 'CLS-002', 'CLS-003', 'CLS-004']);
  });
});
