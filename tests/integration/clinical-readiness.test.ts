/**
 * Clinical readiness, consent and follow-up.
 *
 * These are the FRS §10 acceptance criteria made executable:
 *   "Missing mandatory consent makes procedure NOT_READY"
 *   "Surgery completion creates follow-up"
 *   "Red-flag follow-up alerts qualified clinical role"
 *
 * The tests that matter most are the ones about what CANNOT be done: a
 * BLOCK_HARD gate that no one may override, and a requirement nothing can
 * evaluate that refuses to pass. Both are AP-1, and both are the kind of rule
 * that quietly stops working the moment somebody "simplifies" the evaluator.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { seedVs01Demo, type DemoEnvironment } from '../../prisma/seed/vs01-demo.js';
import {
  evaluateReadiness, startProcedure, overrideReadiness, RequirementKind,
} from '../../apps/api/src/domains/clinical/readiness.service.js';
import {
  completeProcedure, generateFollowups, recordFollowupResponse, redFlagReason,
  Pain, Swelling, Bleeding, Medication,
} from '../../apps/api/src/domains/clinical/followup.service.js';
import {
  ReadinessStatus, GateDecision, EnforcementMode, EvaluationResult,
  ConsentType, FollowupOutcome, Priority,
} from '../../packages/contracts/src/enums.js';
import { FixedClock } from '../../apps/api/src/shared/clock.js';

let env: DemoEnvironment;
let patientId: string;
const suffix = randomUUID().slice(0, 6);
const clock = new FixedClock(new Date('2026-08-01T10:00:00.000Z'));

beforeAll(async () => {
  env = await seedVs01Demo(suffix);
  await withTenantContext(
    prisma,
    { organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false },
    async (tx) => {
      const p = await tx.patient.findFirst({ where: { organizationId: env.organizationId } });
      patientId = p!.id;
    },
  );
}, 90_000);

afterAll(async () => {
  await prisma.$disconnect();
});

function inClinic<T>(fn: (tx: never) => Promise<T>): Promise<T> {
  return withTenantContext(
    prisma,
    { organizationId: env.organizationId, clinicIds: [env.clinicId], crossClinic: false },
    fn as never,
  );
}

/**
 * A procedure protocol. Only SURGERY and IMPLANT_SURGERY are used anywhere in
 * these tests: OD-06 is open, and the Build Pack confirms no other category,
 * so seeding against one would be inventing a requirement.
 */
async function makeProcedure(
  tx: never,
  code: string,
  requirements: Array<{ kind: string; label: string; enforcement: string }>,
  followupOffsetDays: number[] = [],
) {
  return (tx as never as typeof prisma).procedure.create({
    data: {
      organizationId: env.organizationId,
      code: `${code}_${suffix}`,
      name: code === 'IMPLANT' ? 'Implant surgery' : 'Surgical extraction',
      category: code === 'IMPLANT' ? 'IMPLANT_SURGERY' : 'SURGERY',
      followupOffsetDays,
      requirements: { create: requirements.map((r, i) => ({ ...r, sortOrder: i })) },
    },
  });
}

async function bookProcedure(tx: never, procedureId: string) {
  return (tx as never as typeof prisma).patientProcedure.create({
    data: {
      organizationId: env.organizationId,
      clinicId: env.clinicId,
      patientId,
      procedureId,
    },
  });
}

describe('procedure readiness', () => {
  it('makes a procedure NOT_READY when mandatory consent is missing', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT1`, [
        { kind: RequirementKind.CONSENT, label: 'Signed consent', enforcement: EnforcementMode.BLOCK_HARD },
      ]);
      const pp = await bookProcedure(tx, proc.id);

      const report = await evaluateReadiness(tx, clock, pp.id);
      // FRS §10, verbatim.
      expect(report.status).toBe(ReadinessStatus.NOT_READY);
      expect(report.decision).toBe(GateDecision.BLOCK_HARD);
      expect(report.blocking[0]!.detail).toMatch(/no signed consent/i);
      // The doctor is told what is missing, not that "readiness failed".
      expect(report.blocking[0]!.label).toBe('Signed consent');
    });
  });

  it('refuses to start, and refuses to let anyone override a hard block', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT2`, [
        { kind: RequirementKind.CONSENT, label: 'Signed consent', enforcement: EnforcementMode.BLOCK_HARD },
      ]);
      const pp = await bookProcedure(tx, proc.id);

      await expect(startProcedure(tx, clock, pp.id)).rejects.toThrow(/cannot start/i);
      // ADR-004: BLOCK_HARD has no override path. Not "an override that checks
      // a permission" — no permission exists to grant.
      await expect(
        overrideReadiness(tx, clock, pp.id, env.manager.employeeId, 'Patient is waiting'),
      ).rejects.toThrow(/cannot be overridden by anyone/i);
    });
  });

  it('becomes READY once the consent is actually signed', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT3`, [
        { kind: RequirementKind.CONSENT, label: 'Signed consent', enforcement: EnforcementMode.BLOCK_HARD },
      ]);
      const pp = await bookProcedure(tx, proc.id);
      await (tx as never as typeof prisma).consent.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          patientId, patientProcedureId: pp.id,
          consentType: ConsentType.CLINICAL_PROCEDURE,
          templateCode: 'SURG-EXT', templateVersion: 3,
          signedAt: new Date('2026-08-01T09:00:00.000Z'),
        },
      });

      const report = await evaluateReadiness(tx, clock, pp.id);
      expect(report.status).toBe(ReadinessStatus.READY);
      expect(report.decision).toBe(GateDecision.PROCEED);
      // The version signed is part of the record: consent is only evidence of
      // what the patient actually saw.
      expect(report.requirements[0]!.detail).toContain('v3');

      const started = await startProcedure(tx, clock, pp.id);
      expect(started.status).toBe(ReadinessStatus.READY);
    });
  });

  it('stops satisfying its gate once the consent is withdrawn', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT4`, [
        { kind: RequirementKind.CONSENT, label: 'Signed consent', enforcement: EnforcementMode.BLOCK_HARD },
      ]);
      const pp = await bookProcedure(tx, proc.id);
      const consent = await (tx as never as typeof prisma).consent.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          patientId, patientProcedureId: pp.id,
          consentType: ConsentType.CLINICAL_PROCEDURE,
          templateCode: 'SURG-EXT', templateVersion: 3,
          signedAt: new Date('2026-08-01T09:00:00.000Z'),
        },
      });
      expect((await evaluateReadiness(tx, clock, pp.id)).status).toBe(ReadinessStatus.READY);

      await (tx as never as typeof prisma).consent.update({
        where: { id: consent.id },
        data: { withdrawnAt: new Date('2026-08-01T09:30:00.000Z') },
      });
      // A stored READY is a cache, never the authority — which is exactly why
      // starting re-evaluates.
      await expect(startProcedure(tx, clock, pp.id)).rejects.toThrow(/cannot start/i);
    });
  });

  it('never treats a requirement it cannot evaluate as met', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `IMPLANT`, [
        { kind: RequirementKind.CONSENT, label: 'Signed consent', enforcement: EnforcementMode.BLOCK_HARD },
        { kind: RequirementKind.IMPLANT_AVAILABLE, label: 'Implant components in stock', enforcement: EnforcementMode.BLOCK_OVERRIDABLE },
      ]);
      const pp = await bookProcedure(tx, proc.id);
      await (tx as never as typeof prisma).consent.create({
        data: {
          organizationId: env.organizationId, clinicId: env.clinicId,
          patientId, patientProcedureId: pp.id,
          consentType: ConsentType.CLINICAL_PROCEDURE,
          templateCode: 'IMPL', templateVersion: 1,
          signedAt: new Date('2026-08-01T09:00:00.000Z'),
        },
      });

      const report = await evaluateReadiness(tx, clock, pp.id);
      const implant = report.requirements.find((r) => r.kind === RequirementKind.IMPLANT_AVAILABLE)!;
      // AP-1: no evaluator is NOT_CONFIGURED, which blocks. It is emphatically
      // not PASS and not NOT_APPLICABLE.
      expect(implant.result).toBe(EvaluationResult.NOT_CONFIGURED);
      expect(implant.decision).toBe(GateDecision.BLOCK_OVERRIDABLE);
      // And the whole procedure is PENDING, not READY and not NOT_READY:
      // "could not be determined" is its own answer.
      expect(report.status).toBe(ReadinessStatus.PENDING);
    });
  });

  it('allows an overridable block to be overridden, on the record', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT5`, [
        { kind: RequirementKind.RADIOGRAPH, label: 'Pre-op radiograph', enforcement: EnforcementMode.BLOCK_OVERRIDABLE },
      ]);
      const pp = await bookProcedure(tx, proc.id);

      await expect(startProcedure(tx, clock, pp.id)).rejects.toThrow(/not ready/i);
      // An override with no reason is not an override; it is a shrug.
      await expect(
        overrideReadiness(tx, clock, pp.id, env.manager.employeeId, '  '),
      ).rejects.toThrow(/why it was safe/i);

      const out = await overrideReadiness(
        tx, clock, pp.id, env.manager.employeeId, 'Radiograph taken last week, on file',
      );
      expect(out.status).toBe(ReadinessStatus.OVERRIDDEN);
      const row = await (tx as never as typeof prisma).patientProcedure.findUnique({ where: { id: pp.id } });
      expect(row!.overrideReason).toMatch(/on file/);
      expect(row!.overriddenByEmployeeId).toBe(env.manager.employeeId);

      // Only now may it start.
      await startProcedure(tx, clock, pp.id);
    });
  });

  it('refuses to call an unconfigured protocol ready', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT6`, []);
      const pp = await bookProcedure(tx, proc.id);
      const report = await evaluateReadiness(tx, clock, pp.id);
      // A protocol with no requirements has not been set up. Reporting READY
      // would be the most dangerous thing the engine could say.
      expect(report.status).toBe(ReadinessStatus.PENDING);
      expect(report.decision).toBe(GateDecision.BLOCK_OVERRIDABLE);
    });
  });
});

describe('the follow-up engine', () => {
  it('creates the protocol follow-ups when the procedure completes', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT7`, [], [1, 7]);
      const pp = await bookProcedure(tx, proc.id);

      const { created } = await completeProcedure(tx, clock, pp.id);
      expect(created).toBe(2);

      const rows = await (tx as never as typeof prisma).followup.findMany({
        where: { patientProcedureId: pp.id }, orderBy: { dueAt: 'asc' },
      });
      // FUP-002: the day-after call is not optional for surgery.
      expect(rows[0]!.dueAt.toISOString()).toBe('2026-08-02T10:00:00.000Z');
      expect(rows[1]!.dueAt.toISOString()).toBe('2026-08-08T10:00:00.000Z');
    });
  });

  it('does not double a patient’s calls when completion arrives twice', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT8`, [], [1]);
      const pp = await bookProcedure(tx, proc.id);
      await completeProcedure(tx, clock, pp.id);
      const again = await generateFollowups(tx, clock, pp.id);
      expect(again.created).toBe(0);
    });
  });

  it('refuses to generate follow-ups before the procedure is complete', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT9`, [], [1]);
      const pp = await bookProcedure(tx, proc.id);
      await expect(generateFollowups(tx, clock, pp.id)).rejects.toThrow(/not before it/i);
    });
  });

  it('raises a patient-safety alert on a red-flag response', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT10`, [], [1]);
      const pp = await bookProcedure(tx, proc.id);
      await completeProcedure(tx, clock, pp.id);
      const followup = await (tx as never as typeof prisma).followup.findFirstOrThrow({
        where: { patientProcedureId: pp.id },
      });

      const out = await recordFollowupResponse(tx, clock, followup.id, {
        pain: Pain.SEVERE, swelling: Swelling.EXCESSIVE,
        bleeding: Bleeding.NO, medication: Medication.TAKING,
      });

      expect(out.redFlag).toBe(true);
      expect(out.outcome).toBe(FollowupOutcome.RED_FLAG);
      // The alert says what is wrong, not merely that something is.
      expect(out.reason).toBe('Severe pain with excessive swelling');

      const item = await (tx as never as typeof prisma).attentionItem.findUniqueOrThrow({
        where: { id: out.attentionItemId! },
      });
      expect(item.severity).toBe(Priority.PATIENT_SAFETY);
      expect(item.headline).toMatch(/clinical review needed/i);
    });
  });

  it('records a well patient without raising anything', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT11`, [], [1]);
      const pp = await bookProcedure(tx, proc.id);
      await completeProcedure(tx, clock, pp.id);
      const followup = await (tx as never as typeof prisma).followup.findFirstOrThrow({
        where: { patientProcedureId: pp.id },
      });
      const out = await recordFollowupResponse(tx, clock, followup.id, {
        pain: Pain.MILD, swelling: Swelling.EXPECTED,
        bleeding: Bleeding.NO, medication: Medication.TAKING,
      });
      expect(out.redFlag).toBe(false);
      expect(out.outcome).toBe(FollowupOutcome.CONTACTED_WELL);
    });
  });

  it('keeps the symptoms, not just the verdict', async () => {
    await inClinic(async (tx) => {
      const proc = await makeProcedure(tx, `EXT12`, [], [1]);
      const pp = await bookProcedure(tx, proc.id);
      await completeProcedure(tx, clock, pp.id);
      const f = await (tx as never as typeof prisma).followup.findFirstOrThrow({
        where: { patientProcedureId: pp.id },
      });
      await recordFollowupResponse(tx, clock, f.id, {
        pain: Pain.MODERATE, swelling: Swelling.EXPECTED,
        bleeding: Bleeding.NO, medication: Medication.TAKING,
      });
      const row = await (tx as never as typeof prisma).followup.findUniqueOrThrow({ where: { id: f.id } });
      // A "called" tick throws away everything the patient said. This is the
      // whole reason the response is structured.
      expect(row.pain).toBe(Pain.MODERATE);
      expect(row.swelling).toBe(Swelling.EXPECTED);
      expect(row.contactedAt).not.toBeNull();
    });
  });
});

describe('what counts as a red flag', () => {
  // Pure function, so every combination is cheap to state. The engine decides
  // this, never the person who made the call — recording symptoms is within
  // anyone's competence; judging them clinically is not.
  it('fires on the documented combination', () => {
    expect(redFlagReason({
      pain: Pain.SEVERE, swelling: Swelling.EXCESSIVE, bleeding: Bleeding.NO, medication: Medication.TAKING,
    })).toBe('Severe pain with excessive swelling');
  });

  it('fires on bleeding even when the patient is comfortable', () => {
    // A rule that only fired on the documented pair would miss this patient.
    expect(redFlagReason({
      pain: Pain.NONE, swelling: Swelling.EXPECTED, bleeding: Bleeding.YES, medication: Medication.TAKING,
    })).toBe('Bleeding reported');
  });

  it('fires on a medication problem', () => {
    expect(redFlagReason({
      pain: Pain.MILD, swelling: Swelling.EXPECTED, bleeding: Bleeding.NO, medication: Medication.PROBLEM,
    })).toBe('Problem with medication');
  });

  it('stays quiet for an ordinary recovery', () => {
    expect(redFlagReason({
      pain: Pain.MILD, swelling: Swelling.EXPECTED, bleeding: Bleeding.NO, medication: Medication.TAKING,
    })).toBeNull();
  });
});
