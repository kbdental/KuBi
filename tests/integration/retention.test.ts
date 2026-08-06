/**
 * The retention loop, against a real database.
 *
 * The unit tests prove the thirty-day rule is right. These prove the part a
 * pure function cannot: that the list is built from what actually happened in
 * the clinic, that two doctors cannot both ring the same patient, and that
 * somebody who said no stays said-no after the process restarts.
 *
 * The last one is the whole reason there is a table. A retention list that
 * forgets a refusal is worse than no list — it turns a patient who politely
 * declined into a patient who gets rung every month.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import { RetentionService, RetentionError } from '../../apps/api/src/domains/clinical/retention.service.js';
import { OutreachOutcome, RetentionReason } from '../../packages/contracts/src/retention.js';
import { FixedClock } from '../../apps/api/src/shared/clock.js';

const NOW = new Date('2026-08-06T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

let env: DemoEnvironment;
let procedureId: string;
let employeeId: string;
const suffix = randomUUID().slice(0, 6);
const clock = new FixedClock(NOW);
const retention = new RetentionService(clock);

beforeAll(async () => {
  env = await seedVs01Demo(suffix);
  await inClinic(async (tx) => {
    // The demo seed carries no procedure protocols, so this makes one. Its
    // category is irrelevant here — retention counts statuses, not clinical
    // kinds — but inventing a category the requirements do not have would be
    // seeding a fiction, so it reuses SURGERY as the readiness tests do.
    const p = await db(tx).procedure.create({
      data: {
        organizationId: env.organizationId,
        code: `RETENTION_${suffix}`,
        name: 'Surgical extraction',
        category: 'SURGERY',
        followupOffsetDays: [],
      },
    });
    procedureId = p.id;
    const e = await db(tx).employee.findFirstOrThrow({
      where: { organizationId: env.organizationId },
    });
    employeeId = e.id;
  });
}, 90_000);

afterAll(async () => { await prisma.$disconnect(); });

function inClinic<T>(fn: (tx: never) => Promise<T>): Promise<T> {
  return withTenantContext(
    prisma,
    { organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false },
    fn as never,
  );
}
const db = (tx: never) => tx as never as typeof prisma;

/**
 * A synthetic patient with a history, built out of the same tables the clinic
 * writes to. No fixtures and no shortcut into the retention table — if the
 * list can be produced from appointments and procedures, it will work on real
 * data, and if it cannot, a fixture would have hidden that.
 */
async function patientWith(tx: never, opts: {
  lastVisitDaysAgo?: number;
  bookedInDays?: number;
  planned?: number;
  started?: number;
  completed?: number;
}): Promise<string> {
  const uhid = `SYN-${randomUUID().slice(0, 8)}`;
  const patient = await db(tx).patient.create({
    data: {
      organizationId: env.organizationId,
      clinicId: env.clinicId,
      uhid,
      displayLabel: `SYNTHETIC ${uhid}`,
    },
  });

  if (opts.lastVisitDaysAgo !== undefined) {
    const at = daysAgo(opts.lastVisitDaysAgo);
    await db(tx).appointment.create({
      data: {
        organizationId: env.organizationId,
        clinicId: env.clinicId,
        patientId: patient.id,
        periodKey: at.toISOString().slice(0, 10),
        scheduledStart: at,
        scheduledEnd: new Date(at.getTime() + 30 * 60_000),
        visitType: 'Check-up',
        status: 'COMPLETED',
      },
    });
  }

  if (opts.bookedInDays !== undefined) {
    const at = inDays(opts.bookedInDays);
    await db(tx).appointment.create({
      data: {
        organizationId: env.organizationId,
        clinicId: env.clinicId,
        patientId: patient.id,
        periodKey: at.toISOString().slice(0, 10),
        scheduledStart: at,
        scheduledEnd: new Date(at.getTime() + 30 * 60_000),
        visitType: 'Review',
        status: 'BOOKED',
      },
    });
  }

  const make = (status: string, n: number) => Array.from({ length: n }, () =>
    db(tx).patientProcedure.create({
      data: {
        organizationId: env.organizationId,
        clinicId: env.clinicId,
        patientId: patient.id,
        procedureId,
        status,
      },
    }));

  await Promise.all([
    ...make('PLANNED', opts.planned ?? 0),
    ...make('IN_PROGRESS', opts.started ?? 0),
    ...make('COMPLETED', opts.completed ?? 0),
  ]);

  return patient.id;
}

const find = (items: Array<{ patientId: string }>, id: string) =>
  items.find((i) => i.patientId === id);

describe('the list, built from what actually happened', () => {
  it('raises a patient who stopped mid-treatment', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 45, started: 1 });
      const items = await retention.list(tx, env.clinicId);
      const mine = find(items, id);
      expect(mine).toBeDefined();
      expect(mine!.reason).toBe(RetentionReason.STOPPED_MID_TREATMENT);
      expect(mine!.daysSinceLastVisit).toBe(45);
      // The label comes from the patient record, so a doctor sees a person.
      expect(mine!.patientLabel).toMatch(/^SYNTHETIC /);
    });
  });

  it('raises a patient who never began their plan', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 90, planned: 2 });
      const mine = find(await retention.list(tx, env.clinicId), id);
      expect(mine!.reason).toBe(RetentionReason.NEVER_STARTED);
      expect(mine!.stake).toBe('2 planned treatments never begun');
    });
  });

  it('leaves out a patient who is booked in', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 200, started: 1, bookedInDays: 3 });
      expect(find(await retention.list(tx, env.clinicId), id)).toBeUndefined();
    });
  });

  it('leaves out a patient whose treatment finished', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 200, completed: 2 });
      expect(find(await retention.list(tx, env.clinicId), id)).toBeUndefined();
    });
  });

  it('leaves out a patient inside the thirty days', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 20, started: 1 });
      expect(find(await retention.list(tx, env.clinicId), id)).toBeUndefined();
    });
  });

  it('puts unfinished treatment above unstarted plans', async () => {
    await inClinic(async (tx) => {
      const plan = await patientWith(tx, { lastVisitDaysAgo: 300, planned: 1 });
      const stopped = await patientWith(tx, { lastVisitDaysAgo: 31, started: 1 });
      const items = await retention.list(tx, env.clinicId);
      const at = (id: string) => items.findIndex((i) => i.patientId === id);
      expect(at(stopped)).toBeLessThan(at(plan));
    });
  });
});

describe('two doctors, one patient', () => {
  it('lets the first claim it and refuses the second', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 40, started: 1 });
      await retention.open(tx, env.clinicId, env.organizationId, id);
      // The second is stopped by a partial unique index, not by a check that
      // two simultaneous requests could both pass.
      await expect(retention.open(tx, env.clinicId, env.organizationId, id))
        .rejects.toThrow(RetentionError);
    });
  });

  it('shows the claim on the list, so the second doctor sees it before dialling', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 40, started: 1 });
      await retention.open(tx, env.clinicId, env.organizationId, id);
      const mine = find(await retention.list(tx, env.clinicId), id);
      expect(mine!.outreach).not.toBeNull();
      expect(mine!.outreach!.contactedAt).toBeNull();
    });
  });

  it('refuses to claim a patient who booked in the meantime', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 40, started: 1, bookedInDays: 2 });
      // The doctor's screen may be minutes old. The rule is re-checked at the
      // moment of claiming, not trusted from the list.
      await expect(retention.open(tx, env.clinicId, env.organizationId, id))
        .rejects.toThrow(/no longer dormant/i);
    });
  });
});

describe('what the patient said, and whether it sticks', () => {
  it('takes a patient off the list when they decline', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 60, planned: 1 });
      const { id: outreachId } = await retention.open(tx, env.clinicId, env.organizationId, id);
      await retention.record(
        tx, env.clinicId, outreachId, OutreachOutcome.DECLINED, employeeId,
        'Moving city. Will find a clinic there.',
      );

      expect(find(await retention.list(tx, env.clinicId), id)).toBeUndefined();
    });
  });

  it('keeps them on the list when nobody answered', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 60, planned: 1 });
      const { id: outreachId } = await retention.open(tx, env.clinicId, env.organizationId, id);
      await retention.record(
        tx, env.clinicId, outreachId, OutreachOutcome.NO_ANSWER, employeeId,
      );

      // An unanswered phone is not a decision the patient made.
      const mine = find(await retention.list(tx, env.clinicId), id);
      expect(mine).toBeDefined();
      expect(mine!.outreach!.outcome).toBe(OutreachOutcome.NO_ANSWER);
      expect(mine!.outreach!.contactedAt).not.toBeNull();
    });
  });

  it('keeps what they said, in their words', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 60, planned: 1 });
      const { id: outreachId } = await retention.open(tx, env.clinicId, env.organizationId, id);
      const said = 'The crown cost more than the car repair that month.';
      await retention.record(
        tx, env.clinicId, outreachId, OutreachOutcome.NO_ANSWER, employeeId, said,
      );

      // The reason the list is worth keeping. "Declined" is a category;
      // this is a fact somebody can act on.
      const row = await db(tx).retentionOutreach.findUniqueOrThrow({ where: { id: outreachId } });
      expect(row.note).toBe(said);
      expect(row.contactedByEmployeeId).toBe(employeeId);
    });
  });

  it('refuses to record twice against a closed follow-up', async () => {
    await inClinic(async (tx) => {
      const id = await patientWith(tx, { lastVisitDaysAgo: 60, planned: 1 });
      const { id: outreachId } = await retention.open(tx, env.clinicId, env.organizationId, id);
      await retention.record(tx, env.clinicId, outreachId, OutreachOutcome.RETURNING, employeeId);
      await expect(
        retention.record(tx, env.clinicId, outreachId, OutreachOutcome.DECLINED, employeeId),
      ).rejects.toThrow(/already closed/i);
    });
  });

  it('survives the process, because a refusal is a fact and not a cache', async () => {
    let patientId = '';
    await inClinic(async (tx) => {
      patientId = await patientWith(tx, { lastVisitDaysAgo: 60, planned: 1 });
      const { id } = await retention.open(tx, env.clinicId, env.organizationId, patientId);
      await retention.record(tx, env.clinicId, id, OutreachOutcome.DECLINED, employeeId);
    });

    // A separate transaction, a separate connection, a fresh service — the
    // closest a test gets to a restart. The patient stays off the list.
    const fresh = new RetentionService(new FixedClock(NOW));
    await inClinic(async (tx) => {
      expect(find(await fresh.list(tx, env.clinicId), patientId)).toBeUndefined();
    });
  });
});

describe('the numbers a manager would ask for', () => {
  it('counts the dormant, the mid-treatment, and what came of the calls', async () => {
    await inClinic(async (tx) => {
      const before = await retention.summary(tx, env.clinicId);

      await patientWith(tx, { lastVisitDaysAgo: 50, started: 1 });
      const planOnly = await patientWith(tx, { lastVisitDaysAgo: 50, planned: 1 });
      const { id } = await retention.open(tx, env.clinicId, env.organizationId, planOnly);
      await retention.record(tx, env.clinicId, id, OutreachOutcome.RETURNING, employeeId);

      const after = await retention.summary(tx, env.clinicId);
      // One added to the list, one added and then closed by booking.
      expect(after.dormant).toBe(before.dormant + 1);
      expect(after.midTreatment).toBe(before.midTreatment + 1);
      expect(after.contactedThisMonth).toBe(before.contactedThisMonth + 1);
      expect(after.returningThisMonth).toBe(before.returningThisMonth + 1);
    });
  });
});
