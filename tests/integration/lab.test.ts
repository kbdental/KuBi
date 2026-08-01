/**
 * Laboratory cases, and the gate the requirements cite more than anything else:
 *
 *   Crown Delivery Appointment requires Lab Received = YES AND QC = PASSED.
 *
 * That AND is the whole test file. Every way of satisfying only half of it —
 * arrived but unchecked, checked but failed, checked but still being remade —
 * has to be refused separately, because each is a plausible-looking state that
 * a booking screen could easily treat as good enough.
 *
 * It is also the worked example behind the CAPA parameter: "crown delivery
 * appointment given before crown arrived… simply correcting today's
 * appointment doesn't solve the operational problem." This is the preventive
 * action.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import {
  createLabCase, dispatchLabCase, receiveLabCase, recordQc,
  assertReadyForDelivery, deliverLabCase, sweepOverdueLabCases, listLabCases,
} from '../../apps/api/src/domains/operations/lab.service.js';
import { LabCaseStatus, Priority } from '../../packages/contracts/src/enums.js';
import { FixedClock } from '../../apps/api/src/shared/clock.js';

let env: DemoEnvironment;
let patientId: string;
const suffix = randomUUID().slice(0, 6);
const clock = new FixedClock(new Date('2026-08-01T10:00:00.000Z'));
const IN_TEN_DAYS = new Date('2026-08-11T10:00:00.000Z');

beforeAll(async () => {
  env = await seedVs01Demo(suffix);
  await inClinic(async (tx) => {
    const p = await db(tx).patient.findFirstOrThrow({ where: { organizationId: env.organizationId } });
    patientId = p.id;
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

const newCase = (tx: never, workType = 'Crown') => createLabCase(tx, clock, {
  organizationId: env.organizationId,
  clinicId: env.clinicId,
  patientId,
  vendor: 'SYNTHETIC Precision Dental Lab',
  workType,
  toothRef: '26',
  shade: 'A2',
});

describe('the crown delivery gate', () => {
  it('refuses a delivery appointment before the case has arrived', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx);
      await dispatchLabCase(tx, clock, c.id, IN_TEN_DAYS);
      await expect(assertReadyForDelivery(tx, c.id))
        .rejects.toThrow(/not ready for delivery appointment.*not arrived/i);
    });
  });

  it('refuses one for a case that arrived but was never checked', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx);
      await dispatchLabCase(tx, clock, c.id, IN_TEN_DAYS);
      await receiveLabCase(tx, clock, c.id);
      // Arrived is half the rule. "Not yet checked" is neither pass nor fail,
      // and treating it as a pass is how a crown reaches a patient unexamined.
      await expect(assertReadyForDelivery(tx, c.id))
        .rejects.toThrow(/arrived but has not been checked/i);
    });
  });

  it('refuses one for a case that failed its check', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx);
      await dispatchLabCase(tx, clock, c.id, IN_TEN_DAYS);
      await receiveLabCase(tx, clock, c.id);
      await recordQc(tx, clock, c.id, 'FAIL', env.manager.employeeId, 'Margin is short buccally');
      await expect(assertReadyForDelivery(tx, c.id))
        .rejects.toThrow(/failed its check and is being remade/i);
    });
  });

  it('allows one only when the case has arrived AND passed', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx);
      await dispatchLabCase(tx, clock, c.id, IN_TEN_DAYS);
      await receiveLabCase(tx, clock, c.id);
      const qc = await recordQc(tx, clock, c.id, 'PASS', env.manager.employeeId);
      expect(qc.status).toBe(LabCaseStatus.PATIENT_READY);

      await assertReadyForDelivery(tx, c.id);
      const delivered = await deliverLabCase(tx, clock, c.id);
      expect(delivered.status).toBe(LabCaseStatus.DELIVERED);
    });
  });
});

describe('the case lifecycle', () => {
  it('will not dispatch without an expected return date in the future', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx);
      // A case that can never be late is indistinguishable from one nobody
      // chases, and "lab work overdue" is a named exception.
      await expect(dispatchLabCase(tx, clock, c.id, new Date('2026-07-01T10:00:00Z')))
        .rejects.toThrow(/must be in the future/i);
    });
  });

  it('will not check a case that has not been received', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx);
      await dispatchLabCase(tx, clock, c.id, IN_TEN_DAYS);
      await expect(recordQc(tx, clock, c.id, 'PASS', env.manager.employeeId))
        .rejects.toThrow(/must be received before it can be checked/i);
    });
  });

  it('will not accept a failure with no reason', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx);
      await dispatchLabCase(tx, clock, c.id, IN_TEN_DAYS);
      await receiveLabCase(tx, clock, c.id);
      // A remake with no reason is a vendor conversation nobody can have.
      await expect(recordQc(tx, clock, c.id, 'FAIL', env.manager.employeeId))
        .rejects.toThrow(/say what is wrong/i);
    });
  });

  it('counts remakes rather than resetting them', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx);
      await dispatchLabCase(tx, clock, c.id, IN_TEN_DAYS);
      await receiveLabCase(tx, clock, c.id);
      const first = await recordQc(tx, clock, c.id, 'FAIL', env.manager.employeeId, 'Shade wrong');
      expect(first.status).toBe(LabCaseStatus.REMAKE);

      let row = await db(tx).labCase.findUniqueOrThrow({ where: { id: c.id } });
      expect(row.remakeCount).toBe(1);
      // Receipt dates cleared, so the case cannot be received on the old ones.
      expect(row.receivedAt).toBeNull();

      await dispatchLabCase(tx, clock, c.id, IN_TEN_DAYS);
      await receiveLabCase(tx, clock, c.id);
      const second = await recordQc(tx, clock, c.id, 'FAIL', env.manager.employeeId, 'Shade wrong again');

      row = await db(tx).labCase.findUniqueOrThrow({ where: { id: c.id } });
      expect(row.remakeCount).toBe(2);

      // A second remake is a vendor or prescription problem, not bad luck, and
      // is raised louder than the first.
      const item = await db(tx).attentionItem.findUniqueOrThrow({
        where: { id: second.exceptionId! },
      });
      expect(item.severity).toBe(Priority.CRITICAL);
    });
  });
});

describe('overdue cases', () => {
  it('raises one loud item rather than one per day late', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx, 'Bridge');
      await dispatchLabCase(tx, clock, c.id, new Date('2026-08-05T10:00:00Z'));

      const later = new FixedClock(new Date('2026-08-09T10:00:00.000Z'));
      const first = await sweepOverdueLabCases(tx, later, env.organizationId, env.clinicId);
      expect(first.overdue).toBeGreaterThan(0);

      // Four days late must be one item, not four.
      const again = await sweepOverdueLabCases(tx, later, env.organizationId, env.clinicId);
      expect(again.overdue).toBe(0);
    });
  });

  it('stops being overdue once the case arrives', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx, 'Inlay');
      await dispatchLabCase(tx, clock, c.id, new Date('2026-08-05T10:00:00Z'));
      await receiveLabCase(tx, clock, c.id);

      const later = new FixedClock(new Date('2026-08-09T10:00:00.000Z'));
      const list = await listLabCases(tx, later, env.clinicId);
      const mine = list.find((l) => l.id === c.id)!;
      expect(mine.overdue).toBe(false);
    });
  });

  it('tells whoever is looking what each case is waiting for', async () => {
    await inClinic(async (tx) => {
      const c = await newCase(tx, 'Veneer');
      let list = await listLabCases(tx, clock, env.clinicId);
      expect(list.find((l) => l.id === c.id)!.nextStep).toBe('Dispatch to the laboratory');

      await dispatchLabCase(tx, clock, c.id, IN_TEN_DAYS);
      await receiveLabCase(tx, clock, c.id);
      list = await listLabCases(tx, clock, env.clinicId);
      expect(list.find((l) => l.id === c.id)!.nextStep).toBe('Doctor to check the case');

      await recordQc(tx, clock, c.id, 'PASS', env.manager.employeeId);
      list = await listLabCases(tx, clock, env.clinicId);
      const ready = list.find((l) => l.id === c.id)!;
      expect(ready.nextStep).toBe('Book the delivery appointment');
      expect(ready.delivery.ready).toBe(true);
    });
  });
});
