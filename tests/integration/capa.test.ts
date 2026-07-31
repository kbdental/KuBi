/**
 * CAPA — the IMPROVE stage that closes the §8 loop.
 *
 * These tests are almost entirely about what the module REFUSES, because that
 * is where the value is. An incident record you can close by typing something
 * in a box is a filing system. What makes it a learning mechanism is that you
 * cannot skip the investigation, cannot stop at correcting today, cannot mark
 * your own fix as verified, and cannot close while anything is unproven.
 *
 * Remove any one of those and the parameter still "works" in the sense that
 * rows are created — which is exactly why each has a test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import {
  raiseIncident, containIncident, investigateIncident, addAction,
  completeAction, verifyAction, closeIncident, listIncidents,
  capaRequired,
} from '../../apps/api/src/platform/quality/capa.service.js';
import {
  IncidentStatus, CapaActionType, CapaRequirement, Priority, Parameter,
} from '../../packages/contracts/src/enums.js';
import { FixedClock } from '../../apps/api/src/shared/clock.js';

let env: DemoEnvironment;
const suffix = randomUUID().slice(0, 6);
const clock = new FixedClock(new Date('2026-07-31T10:00:00.000Z'));

beforeAll(async () => {
  env = await seedVs01Demo(suffix);
}, 90_000);

afterAll(async () => {
  await prisma.$disconnect();
});

/** Runs fn inside the demo clinic's tenancy context. */
function inClinic<T>(fn: (tx: never) => Promise<T>): Promise<T> {
  return withTenantContext(
    prisma,
    { organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false },
    fn as never,
  );
}

async function newIncident(tx: never, summary = 'Crown delivery booked before the crown arrived') {
  return raiseIncident(tx, clock, {
    organizationId: env.organizationId,
    clinicId: env.clinicId,
    parameter: Parameter.QUALITY_CAPA,
    priority: Priority.IMPORTANT,
    summary,
  });
}

describe('the CAPA loop', () => {
  it('refuses to investigate before the immediate correction is recorded', async () => {
    await inClinic(async (tx) => {
      const inc = await newIncident(tx);
      // The patient in the chair cannot wait for a root cause analysis, so
      // containment comes first and is never confused with the fix.
      await expect(
        investigateIncident(tx, clock, inc.id, 'Nobody checked the lab status'),
      ).rejects.toThrow(/before asking why it happened/i);
    });
  });

  it('refuses to plan actions before a root cause is recorded', async () => {
    await inClinic(async (tx) => {
      const inc = await newIncident(tx);
      await containIncident(tx, clock, inc.id, 'Rebooked the patient for Thursday');
      // Jumping straight to a fix is the habit CAPA exists to break.
      await expect(
        addAction(tx, inc.id, {
          type: CapaActionType.CORRECTIVE,
          description: 'Tell reception to check',
          responsibleEmployeeId: env.reception.employeeId,
          dueAt: new Date('2026-08-05T10:00:00Z'),
        }),
      ).rejects.toThrow(/root cause/i);
    });
  });

  it('refuses an empty root cause, which is the same as no root cause', async () => {
    await inClinic(async (tx) => {
      const inc = await newIncident(tx);
      await containIncident(tx, clock, inc.id, 'Rebooked');
      await expect(investigateIncident(tx, clock, inc.id, '   ')).rejects.toThrow(/why it happened/i);
    });
  });

  it('will not close an incident that only corrects today', async () => {
    await inClinic(async (tx) => {
      const inc = await newIncident(tx);
      await containIncident(tx, clock, inc.id, 'Rebooked the patient for Thursday');
      await investigateIncident(tx, clock, inc.id, 'Nobody checks lab status before booking');

      const corrective = await addAction(tx, inc.id, {
        type: CapaActionType.CORRECTIVE,
        description: 'Rebook this patient once the crown passes QC',
        responsibleEmployeeId: env.reception.employeeId,
        dueAt: new Date('2026-08-05T10:00:00Z'),
      });
      await completeAction(tx, clock, corrective.id);
      await verifyAction(tx, clock, corrective.id, env.manager.employeeId);

      // This is the requirement's central point, made executable: "simply
      // correcting today's appointment doesn't solve the operational problem."
      await expect(closeIncident(tx, clock, inc.id)).rejects.toThrow(/no preventive action/i);
    });
  });

  it('refuses to let somebody verify their own fix', async () => {
    await inClinic(async (tx) => {
      const inc = await newIncident(tx);
      await containIncident(tx, clock, inc.id, 'Rebooked');
      await investigateIncident(tx, clock, inc.id, 'No gate between lab receipt and booking');
      const a = await addAction(tx, inc.id, {
        type: CapaActionType.PREVENTIVE,
        description: 'Block crown delivery booking until QC passes',
        responsibleEmployeeId: env.reception.employeeId,
        dueAt: new Date('2026-08-10T10:00:00Z'),
      });
      await completeAction(tx, clock, a.id);
      // Same reason a doer cannot confirm their own activity: a fix nobody
      // independently looked at is a claim, not a fix.
      await expect(
        verifyAction(tx, clock, a.id, env.reception.employeeId),
      ).rejects.toThrow(/other than the person responsible/i);
    });
  });

  it('will not close while any action is unverified', async () => {
    await inClinic(async (tx) => {
      const inc = await newIncident(tx);
      await containIncident(tx, clock, inc.id, 'Rebooked');
      await investigateIncident(tx, clock, inc.id, 'No gate between lab receipt and booking');
      await addAction(tx, inc.id, {
        type: CapaActionType.CORRECTIVE,
        description: 'Rebook once QC passes',
        responsibleEmployeeId: env.reception.employeeId,
        dueAt: new Date('2026-08-05T10:00:00Z'),
      });
      const prev = await addAction(tx, inc.id, {
        type: CapaActionType.PREVENTIVE,
        description: 'Block booking until QC passes',
        responsibleEmployeeId: env.manager.employeeId,
        dueAt: new Date('2026-08-10T10:00:00Z'),
      });
      await completeAction(tx, clock, prev.id);
      await verifyAction(tx, clock, prev.id, env.reception.employeeId);

      await expect(closeIncident(tx, clock, inc.id)).rejects.toThrow(/still unverified/i);
    });
  });

  it('closes only when the whole loop has actually been travelled', async () => {
    await inClinic(async (tx) => {
      const inc = await newIncident(tx);
      await containIncident(tx, clock, inc.id, 'Rebooked the patient for Thursday');
      await investigateIncident(tx, clock, inc.id, 'No gate between lab receipt and booking');

      const corr = await addAction(tx, inc.id, {
        type: CapaActionType.CORRECTIVE,
        description: 'Rebook once QC passes',
        responsibleEmployeeId: env.reception.employeeId,
        dueAt: new Date('2026-08-05T10:00:00Z'),
      });
      const prev = await addAction(tx, inc.id, {
        type: CapaActionType.PREVENTIVE,
        description: 'Block crown delivery booking until lab QC passes',
        responsibleEmployeeId: env.manager.employeeId,
        dueAt: new Date('2026-08-10T10:00:00Z'),
      });

      // Both kinds present moves it to planned, not before.
      const planned = await tx.incident.findUnique({ where: { id: inc.id } });
      expect(planned!.status).toBe(IncidentStatus.ACTIONS_PLANNED);

      await completeAction(tx, clock, corr.id);
      await completeAction(tx, clock, prev.id);
      const verifying = await tx.incident.findUnique({ where: { id: inc.id } });
      expect(verifying!.status).toBe(IncidentStatus.VERIFYING);

      await verifyAction(tx, clock, corr.id, env.manager.employeeId);
      await verifyAction(tx, clock, prev.id, env.reception.employeeId, 'Booking screen now blocks it');

      const closed = await closeIncident(tx, clock, inc.id);
      expect(closed.status).toBe(IncidentStatus.CLOSED);
      expect(closed.closedAt).not.toBeNull();
      // The learning is on the record, not just the outcome.
      expect(closed.rootCause).toBe('No gate between lab receipt and booking');
      expect(closed.immediateCorrection).toBe('Rebooked the patient for Thursday');
    });
  });

  it('tells whoever is looking what the incident is waiting for', async () => {
    await inClinic(async (tx) => {
      const inc = await newIncident(tx, 'Autoclave cycle verification missed');
      let list = await listIncidents(tx, clock, env.organizationId, env.clinicId);
      let mine = list.find((i) => i.id === inc.id)!;
      // A status word says where a thing is; it does not say what to do.
      expect(mine.blockedBy).toBe('Record what was done about it today');

      await containIncident(tx, clock, inc.id, 'Re-ran the cycle and logged it');
      list = await listIncidents(tx, clock, env.organizationId, env.clinicId);
      mine = list.find((i) => i.id === inc.id)!;
      expect(mine.blockedBy).toBe('Record why it happened');

      await investigateIncident(tx, clock, inc.id, 'Closing checklist ran before the cycle finished');
      list = await listIncidents(tx, clock, env.organizationId, env.clinicId);
      mine = list.find((i) => i.id === inc.id)!;
      expect(mine.blockedBy).toMatch(/preventive action/i);
    });
  });

  it('issues stable, per-organisation references', async () => {
    await inClinic(async (tx) => {
      const a = await newIncident(tx, 'First');
      const b = await newIncident(tx, 'Second');
      expect(a.reference).toMatch(/^INC-\d{4}-\d{4}$/);
      expect(Number(b.reference.slice(-4))).toBe(Number(a.reference.slice(-4)) + 1);
    });
  });

  it('keeps an incident inside its own clinic', async () => {
    const inc = await inClinic((tx) => newIncident(tx, 'Tenant isolation check'));
    // A colleague scoped to the group's other clinic must not see it. The
    // policy is two-level: same organisation is not enough.
    await withTenantContext(
      prisma,
      { organizationId: env.organizationId, clinicIds: [env.otherClinicId], crossClinic: false },
      async (tx) => {
        const found = await tx.incident.findUnique({ where: { id: inc.id } });
        expect(found).toBeNull();
      },
    );
  });
});

describe('when a failure must raise an incident', () => {
  // The wire that was missing: capaPolicy existed as a column with no
  // consumer, so the loop's last stage was declared and never reached.
  it('ALWAYS raises regardless of priority or history', () => {
    expect(capaRequired(CapaRequirement.ALWAYS, Priority.ROUTINE, 0)).toBe(true);
  });

  it('REQUIRED_ON_CRITICAL raises for critical and patient-safety only', () => {
    expect(capaRequired(CapaRequirement.REQUIRED_ON_CRITICAL, Priority.PATIENT_SAFETY, 0)).toBe(true);
    expect(capaRequired(CapaRequirement.REQUIRED_ON_CRITICAL, Priority.CRITICAL, 0)).toBe(true);
    expect(capaRequired(CapaRequirement.REQUIRED_ON_CRITICAL, Priority.ROUTINE, 9)).toBe(false);
  });

  it('REQUIRED_ON_REPEAT raises on the second occurrence, not the first', () => {
    // The second failure is the one that proves the first fix did not work.
    expect(capaRequired(CapaRequirement.REQUIRED_ON_REPEAT, Priority.IMPORTANT, 0)).toBe(false);
    expect(capaRequired(CapaRequirement.REQUIRED_ON_REPEAT, Priority.IMPORTANT, 1)).toBe(true);
  });

  it('NONE never raises', () => {
    expect(capaRequired(CapaRequirement.NONE, Priority.PATIENT_SAFETY, 5)).toBe(false);
  });
});
