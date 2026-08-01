/**
 * The six engines, and specifically the places where one engine's answer
 * becomes another engine's gate.
 *
 * Each engine on its own is a module. What makes KuBi an operating system is
 * that the Inventory engine's stock count is what the Compliance engine
 * consults before a surgery, and the Equipment engine's failed check is what
 * takes a chair out of allocation. Those joins are what these tests are about
 * — a module can pass its own tests forever while joined to nothing.
 *
 * Before this, Compliance could only evaluate consent: everything else it was
 * asked to check had no table to check against, so it returned NOT_CONFIGURED.
 * Correct under AP-1, and useless to a clinic.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import {
  recordAssetCheck, returnToService, generateMaintenanceTasks,
  completeMaintenance, categoryAvailable,
} from '../../apps/api/src/domains/operations/equipment.service.js';
import {
  stockLevels, runInventoryChecks, implantReadiness, consumeImplant,
} from '../../apps/api/src/domains/operations/inventory.service.js';
import { evaluateReadiness } from '../../apps/api/src/domains/clinical/readiness.service.js';
import { generatePreOpWork } from '../../apps/api/src/domains/clinical/followup.service.js';
import {
  AssetStatus, EvaluationResult, GateDecision, EnforcementMode, Priority,
} from '../../packages/contracts/src/enums.js';
import { FixedClock } from '../../apps/api/src/shared/clock.js';

let env: DemoEnvironment;
let patientId: string;
const suffix = randomUUID().slice(0, 6);
const clock = new FixedClock(new Date('2026-08-01T10:00:00.000Z'));

beforeAll(async () => {
  env = await seedVs01Demo(suffix);
  await inClinic(async (tx) => {
    const p = await (tx as never as typeof prisma).patient.findFirstOrThrow({
      where: { organizationId: env.organizationId },
    });
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

const newAsset = (tx: never, code: string, category: string, status = AssetStatus.OPERATIONAL) =>
  db(tx).asset.create({
    data: {
      organizationId: env.organizationId, clinicId: env.clinicId,
      code: `${code}_${suffix}`, name: code, category, status,
    },
  });

describe('the Equipment engine', () => {
  it('takes a failed asset out of service rather than filing a note', async () => {
    await inClinic(async (tx) => {
      const asset = await newAsset(tx, 'CHAIR-01', 'DENTAL_CHAIR');
      const out = await recordAssetCheck(tx, clock, asset.id, 'FAIL', {
        employeeId: env.assistant.employeeId, note: 'Suction not holding',
      });
      // The requirement's own rule: a failed chair stops being allocatable.
      expect(out.status).toBe(AssetStatus.OUT_OF_SERVICE);
      expect(out.exceptionId).toBeTruthy();

      const item = await db(tx).attentionItem.findUniqueOrThrow({ where: { id: out.exceptionId! } });
      expect(item.severity).toBe(Priority.PATIENT_SAFETY);
    });
  });

  it('does not quietly return a failed asset to service on the next good day', async () => {
    await inClinic(async (tx) => {
      const asset = await newAsset(tx, 'CHAIR-02', 'DENTAL_CHAIR');
      await recordAssetCheck(tx, clock, asset.id, 'FAIL', { note: 'Broken' });

      const tomorrow = new FixedClock(new Date('2026-08-02T10:00:00.000Z'));
      const after = await recordAssetCheck(tx, tomorrow, asset.id, 'PASS');
      // Yesterday's breakdown must not disappear because today went well.
      expect(after.status).toBe(AssetStatus.OUT_OF_SERVICE);
    });
  });

  it('refuses to let the person who reported a breakdown verify its repair', async () => {
    await inClinic(async (tx) => {
      const asset = await newAsset(tx, 'CHAIR-03', 'DENTAL_CHAIR');
      await recordAssetCheck(tx, clock, asset.id, 'FAIL', {
        employeeId: env.assistant.employeeId, note: 'Broken',
      });
      const bd = await db(tx).breakdown.findFirstOrThrow({ where: { assetId: asset.id } });

      await expect(returnToService(tx, clock, bd.id, env.manager.employeeId))
        .rejects.toThrow(/record the repair/i);

      await db(tx).breakdown.update({
        where: { id: bd.id }, data: { repairedAt: clock.now() },
      });
      await expect(returnToService(tx, clock, bd.id, env.assistant.employeeId))
        .rejects.toThrow(/cannot be the one who verifies/i);

      await returnToService(tx, clock, bd.id, env.manager.employeeId);
      const back = await db(tx).asset.findUniqueOrThrow({ where: { id: asset.id } });
      expect(back.status).toBe(AssetStatus.OPERATIONAL);
    });
  });

  it('creates a service task on the lead time, not on the due date', async () => {
    await inClinic(async (tx) => {
      const asset = await newAsset(tx, 'AUTOCLAVE-01', 'AUTOCLAVE');
      const plan = await db(tx).maintenancePlan.create({
        data: {
          organizationId: env.organizationId, assetId: asset.id,
          kind: 'SERVICE', intervalDays: 180, leadTimeDays: 7,
          // Five days out: inside the lead time, so it should appear now.
          nextDueAt: new Date('2026-08-06T10:00:00.000Z'),
        },
      });
      const r = await generateMaintenanceTasks(tx, clock, env.organizationId, env.clinicId);
      expect(r.created).toBe(1);

      // Idempotent while the same task is open.
      const again = await generateMaintenanceTasks(tx, clock, env.organizationId, env.clinicId);
      expect(again.created).toBe(0);

      const done = await completeMaintenance(tx, clock, plan.id);
      // Rolled from now, so a late service does not make the next one early.
      expect(done.nextDueAt.getTime()).toBe(clock.now().getTime() + 180 * 86_400_000);
    });
  });

  it('reports UNKNOWN for a category the clinic holds no asset in', async () => {
    await inClinic(async (tx) => {
      const answer = await categoryAvailable(tx, env.clinicId, 'NO_SUCH_CATEGORY');
      // Absence of an autoclave record is not evidence that anything is fine.
      expect(answer.result).toBe(EvaluationResult.UNKNOWN);
    });
  });
});

describe('the Inventory engine', () => {
  const newItem = (tx: never, code: string, min: number, reorder: number) =>
    db(tx).item.create({
      data: {
        organizationId: env.organizationId, clinicId: env.clinicId,
        code: `${code}_${suffix}`, name: code, category: 'CONSUMABLE', unit: 'BOX',
        minimumQty: min, reorderQty: 10, reorderLevel: reorder,
      },
    });

  it('excludes expired stock from what is available', async () => {
    await inClinic(async (tx) => {
      const item = await newItem(tx, 'GLOVES', 2, 5);
      await db(tx).stockBatch.createMany({
        data: [
          { organizationId: env.organizationId, itemId: item.id, batchRef: 'A', quantity: 6, expiryAt: new Date('2026-07-01T00:00:00Z') },
          { organizationId: env.organizationId, itemId: item.id, batchRef: 'B', quantity: 4, expiryAt: new Date('2026-12-01T00:00:00Z') },
        ],
      });
      const levels = await stockLevels(tx, clock, env.clinicId);
      const gloves = levels.find((l) => l.code.startsWith('GLOVES'))!;
      // Ten on the shelf, four usable. A clinic that believes it has ten is
      // worse off than one that knows it has four.
      expect(gloves.onHand).toBe(10);
      expect(gloves.available).toBe(4);
      expect(gloves.expired).toBe(1);
      expect(gloves.state).toBe('REORDER');
    });
  });

  it('calls below-minimum a shortage, not merely a reorder', async () => {
    await inClinic(async (tx) => {
      const item = await newItem(tx, 'MASKS', 5, 10);
      await db(tx).stockBatch.create({
        data: { organizationId: env.organizationId, itemId: item.id, batchRef: 'A', quantity: 2 },
      });
      const levels = await stockLevels(tx, clock, env.clinicId);
      expect(levels.find((l) => l.code.startsWith('MASKS'))!.state).toBe('SHORTAGE');

      const r = await runInventoryChecks(tx, clock, env.organizationId, env.clinicId);
      expect(r.shortages).toBeGreaterThan(0);

      // Crossing a threshold once must not alert every five minutes for a week.
      const again = await runInventoryChecks(tx, clock, env.organizationId, env.clinicId);
      expect(again.shortages).toBe(0);
    });
  });

  it('answers implant readiness per component, naming the missing part', async () => {
    await inClinic(async (tx) => {
      await db(tx).implantSku.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          brand: 'Nobel', line: 'Active', platform: 'NP',
          diameterMm: 3.5, lengthMm: 10, componentType: 'IMPLANT', quantity: 3,
        },
      });
      // The healing abutment is deliberately absent.
      const { ready, answers } = await implantReadiness(tx, clock, env.clinicId, [
        { componentType: 'IMPLANT', brand: 'Nobel', line: 'Active', platform: 'NP', diameterMm: 3.5, lengthMm: 10 },
        { componentType: 'HEALING_ABUTMENT', brand: 'Nobel', line: 'Active', platform: 'NP', diameterMm: 4.5, lengthMm: 5 },
      ]);
      expect(ready).toBe(false);
      expect(answers[0]!.result).toBe(EvaluationResult.PASS);
      // "10 implants available" would have said yes. This says which part.
      expect(answers[1]!.detail).toMatch(/healing abutment 4.5×5/i);
    });
  });

  it('refuses to let implant stock go negative', async () => {
    await inClinic(async (tx) => {
      const sku = await db(tx).implantSku.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          brand: 'Straumann', line: 'BLT', platform: 'RC',
          diameterMm: 4.1, lengthMm: 8, componentType: 'IMPLANT', quantity: 1,
        },
      });
      await consumeImplant(tx, sku.id, 1);
      await expect(consumeImplant(tx, sku.id, 1)).rejects.toThrow(/only 0 in stock/i);
    });
  });
});

describe('where the engines meet', () => {
  it('lets the Inventory engine block a surgery through the Compliance engine', async () => {
    await inClinic(async (tx) => {
      const proc = await db(tx).procedure.create({
        data: {
          organizationId: env.organizationId,
          code: `IMPL_${suffix}`, name: 'Implant surgery', category: 'IMPLANT_SURGERY',
          requirements: {
            create: [{
              kind: 'IMPLANT_AVAILABLE', label: 'Implant components in stock',
              enforcement: EnforcementMode.BLOCK_HARD, sortOrder: 0,
            }],
          },
        },
      });
      const pp = await db(tx).patientProcedure.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          patientId, procedureId: proc.id,
          componentRequirements: [
            { componentType: 'HEALING_ABUTMENT', brand: 'Nobel', line: 'Active', platform: 'NP', diameterMm: 4.5, lengthMm: 5 },
          ],
        },
      });

      // Nothing of that specification is on file at all. That is UNKNOWN, not
      // FAIL — "we hold no record" and "we looked and there are none" are
      // different facts, and only one of them is a stock problem. Both block.
      const unknown = await evaluateReadiness(tx, clock, pp.id);
      expect(unknown.decision).toBe(GateDecision.BLOCK_HARD);
      expect(unknown.requirements[0]!.result).toBe(EvaluationResult.UNKNOWN);
      expect(unknown.blocking[0]!.detail).toMatch(/healing abutment 4.5×5.*on file/i);

      // Now the component exists but the shelf is empty. That is a FAIL, and
      // the wording changes to match — because what reception must do about it
      // is different: order stock, rather than set the component up.
      await db(tx).implantSku.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          brand: 'Nobel', line: 'Active', platform: 'NP',
          diameterMm: 4.5, lengthMm: 5, componentType: 'HEALING_ABUTMENT', quantity: 0,
        },
      });
      const report = await evaluateReadiness(tx, clock, pp.id);
      // This is the join: stock the Inventory engine holds decides whether the
      // Compliance engine lets the surgery start.
      expect(report.decision).toBe(GateDecision.BLOCK_HARD);
      expect(report.requirements[0]!.result).toBe(EvaluationResult.FAIL);
      expect(report.blocking[0]!.detail).toMatch(/healing abutment 4.5×5 not in stock/i);
    });
  });

  it('creates the pre-op work when a case is booked, not when somebody remembers', async () => {
    await inClinic(async (tx) => {
      const proc = await db(tx).procedure.create({
        data: {
          organizationId: env.organizationId,
          code: `RCT_${suffix}`, name: 'Root canal', category: 'SURGERY',
          requirements: {
            create: [
              { kind: 'CONSENT', label: 'Signed consent', enforcement: EnforcementMode.BLOCK_HARD, sortOrder: 0 },
              { kind: 'RADIOGRAPH', label: 'Relevant radiograph', enforcement: EnforcementMode.BLOCK_OVERRIDABLE, sortOrder: 1 },
            ],
          },
        },
      });
      const pp = await db(tx).patientProcedure.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          patientId, procedureId: proc.id,
        },
      });

      const r = await generatePreOpWork(tx, clock, pp.id);
      expect(r.created).toBe(2);

      const items = await db(tx).attentionItem.findMany({
        where: { clinicId: env.clinicId, code: 'PRE_OP.REQUIREMENT.OUTSTANDING' },
      });
      const consent = items.find((i) => i.headline.includes('consent'))!;
      const radiograph = items.find((i) => i.headline.includes('radiograph'))!;
      // Seriousness is inherited from the gate: a hard-blocking consent is not
      // the same kind of outstanding item as a warning-level photograph.
      expect(consent.severity).toBe(Priority.PATIENT_SAFETY);
      expect(radiograph.severity).toBe(Priority.IMPORTANT);

      // Rebooking must not triple the reminders.
      const again = await generatePreOpWork(tx, clock, pp.id);
      expect(again.created).toBe(0);
    });
  });

  it('lets a released sterilisation batch satisfy the sterile-kit gate', async () => {
    await inClinic(async (tx) => {
      const proc = await db(tx).procedure.create({
        data: {
          organizationId: env.organizationId,
          code: `KIT_${suffix}`, name: 'Surgical extraction', category: 'SURGERY',
          requirements: {
            create: [{
              kind: 'STERILE_KIT', label: 'Surgical kit sterile',
              enforcement: EnforcementMode.BLOCK_HARD, sortOrder: 0,
            }],
          },
        },
      });
      const pp = await db(tx).patientProcedure.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          patientId, procedureId: proc.id,
        },
      });

      // Nothing released yet: unknown, and blocking.
      const before = await evaluateReadiness(tx, clock, pp.id);
      expect(before.requirements[0]!.result).toBe(EvaluationResult.UNKNOWN);
      expect(before.decision).toBe(GateDecision.BLOCK_HARD);

      await db(tx).sterilizationBatch.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          batchRef: `STER-${suffix}`, stage: 'RELEASED', cycleResult: 'PASS',
          releasedAt: clock.now(),
        },
      });

      const after = await evaluateReadiness(tx, clock, pp.id);
      expect(after.requirements[0]!.result).toBe(EvaluationResult.PASS);
      expect(after.decision).toBe(GateDecision.PROCEED);
    });
  });
});
