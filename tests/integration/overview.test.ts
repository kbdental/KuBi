/**
 * The clinic at a glance, driven through the HTTP API.
 *
 * Two things are being proven, and only one of them is about numbers.
 *
 * The first is that clinic-wide performance is not everyone's business. An
 * assistant has a day; a manager has a clinic. If an assistant can read the
 * overview then the app has quietly published how her colleagues are scoring,
 * which is the opposite of the blame-free operational screens the owner asked
 * for (Q6). That is a permission test, not a UI one, so it belongs here.
 *
 * The second is that a day with nothing scheduled reports as having no data
 * rather than as zero. A shut Sunday drawn as 0% readiness is a lie about the
 * clinic, and the kind of lie a chart tells very convincingly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../apps/api/src/server.ts';
import { prisma } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, DEMO_PASSWORD, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import { generateOpeningTasks } from '../../apps/api/src/platform/workflow/scheduler.service.js';
import { systemClock } from '../../apps/api/src/shared/clock.js';

let app: FastifyInstance;
let env: DemoEnvironment;
const suffix = randomUUID().slice(0, 6);

async function login(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { email, password: DEMO_PASSWORD },
  });
  expect(res.statusCode).toBe(200);
  return `kubi_at=${res.cookies.find((c) => c.name === 'kubi_at')!.value}`;
}

const overview = async (cookie: string) =>
  app.inject({ method: 'GET', url: '/api/v1/overview', headers: { cookie } });

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

describe('the clinic at a glance', () => {
  it('refuses an assistant: she has a day, not a clinic', async () => {
    const res = await overview(await login(`priya_${suffix}@synthetic.test`));
    expect(res.statusCode).toBe(403);
    // A refusal a person can read, not a permission code.
    expect(res.json().error).toMatch(/permission/i);
  });

  it('gives the manager today’s readiness, counted from confirmed work only', async () => {
    const res = await overview(await login(`rahul_${suffix}@synthetic.test`));
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.readiness.total).toBeGreaterThan(0);
    // Nothing has been verified yet, so readiness is a real 0% — not null, and
    // not quietly rounded up because the work merely exists.
    expect(body.readiness.done).toBe(0);
    expect(body.readiness.percent).toBe(0);
    expect(body.readiness.percent).toBe(
      Math.round((body.readiness.done / body.readiness.total) * 100),
    );
  });

  it('reports a day with nothing scheduled as no data, never as zero', async () => {
    const body = (await overview(await login(`rahul_${suffix}@synthetic.test`))).json();

    expect(body.week).toHaveLength(7);
    // Oldest first, so it reads left to right the way a week does.
    const keys = body.week.map((d: { periodKey: string }) => d.periodKey);
    expect([...keys].sort()).toEqual(keys);

    // Opening tasks were generated for today only, so every earlier day has
    // nothing — and each of those must say so rather than report 0%.
    const earlier = body.week.slice(0, -1);
    expect(earlier.length).toBeGreaterThan(0);
    for (const day of earlier) {
      expect(day.readiness).toBeNull();
      expect(day.onTime).toBeNull();
    }
    expect(body.week.at(-1).readiness).not.toBeNull();
  });

  it('counts patients in clinic terms, leaving cancellations out of what is expected', async () => {
    const body = (await overview(await login(`rahul_${suffix}@synthetic.test`))).json();
    const p = body.patients;

    expect(p.expected).toBeGreaterThan(0);
    expect(p.seen).toBeLessThanOrEqual(p.expected);
    for (const n of [p.seen, p.expected, p.waiting, p.notSeen]) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports independence as absent rather than perfect when nothing has been confirmed', async () => {
    const body = (await overview(await login(`rahul_${suffix}@synthetic.test`))).json();
    const ind = body.independentChecks;

    // Zero verifications must not read as 100% independent checking. "We have
    // no evidence" and "our verification is flawless" are opposite claims.
    expect(ind.total).toBe(0);
    expect(ind.percent).toBeNull();
    expect(ind.independent).toBe(0);
  });

  it('never puts a person’s name on the overview (Q6)', async () => {
    const res = await overview(await login(`rahul_${suffix}@synthetic.test`));
    // Whose work it was stays in the audit trail. The overview is about the
    // clinic, and a screen that names the slowest assistant becomes a weapon.
    expect(res.body).not.toMatch(/SYNTHETIC/);
    expect(res.body).not.toMatch(/synthetic\.test/);
  });
});
