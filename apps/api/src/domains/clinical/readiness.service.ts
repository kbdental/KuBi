/**
 * Procedure readiness — the Compliance engine.
 *
 * The Operations App calls this the point where "KuBi becomes significantly
 * more useful than ordinary clinic software", and the reason is that the
 * SELECTED PROCEDURE decides what must be true. An RCT asks for a medical
 * history, a radiograph, a consent and a treatment plan. An implant surgery
 * asks for all of that plus pre-op records, implant availability, a sterile
 * kit and emergency readiness. Nobody has to remember which.
 *
 * ---
 *
 * Three rules from the working agreement do the real work here, and each is a
 * test:
 *
 *   AP-1 — absence of information is UNKNOWN or NOT_CONFIGURED, never
 *   NOT_APPLICABLE and never PASS. A requirement nothing can check is not a
 *   requirement that is met; it is a question nobody asked, and it must behave
 *   at least as strictly as a known failure.
 *
 *   The enforcement matrix decides what a non-PASS result DOES. That is data
 *   on the requirement, not a branch in this file: a missing consent blocks
 *   hard, a missing pre-op photograph warns, and changing which is a
 *   configuration change rather than a deployment.
 *
 *   BLOCK_HARD has no override path. Not "an override that checks a
 *   permission" — no permission to grant. That is enforced by the permission
 *   catalogue; the refusal here is the second lock, not the first.
 *
 * The readiness stored on the row is a cache of the last evaluation and never
 * the authority. `startProcedure` re-evaluates, because a READY computed an
 * hour ago is not evidence that anything is ready now — a consent can be
 * withdrawn and a sterile kit can be used on somebody else.
 */
import {
  EvaluationResult, EnforcementMode, GateDecision, ReadinessStatus,
  ENFORCEMENT_MATRIX, resolveComposite, ConsentType,
} from '@kubi/contracts';
import type { TenantPrisma } from '../../platform/tenancy/rls-context.js';
import type { Clock } from '../../shared/clock.js';
import { categoryAvailable } from '../operations/equipment.service.js';
import { implantReadiness, type ComponentRequirement } from '../operations/inventory.service.js';

export class ReadinessError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ReadinessError';
  }
}

/** What a requirement can ask for. Extended as the remaining engines land. */
export const RequirementKind = {
  CONSENT: 'CONSENT',
  MEDICAL_HISTORY: 'MEDICAL_HISTORY',
  RADIOGRAPH: 'RADIOGRAPH',
  PRE_OP_RECORDS: 'PRE_OP_RECORDS',
  PRE_OP_INSTRUCTIONS: 'PRE_OP_INSTRUCTIONS',
  IMPLANT_AVAILABLE: 'IMPLANT_AVAILABLE',
  STERILE_KIT: 'STERILE_KIT',
  EMERGENCY_READY: 'EMERGENCY_READY',
} as const;
export type RequirementKind = (typeof RequirementKind)[keyof typeof RequirementKind];

export interface RequirementResult {
  kind: string;
  label: string;
  enforcement: string;
  result: EvaluationResult;
  decision: GateDecision;
  /** Plain-language reason, for the screen. Never engine vocabulary. */
  detail: string;
}

export interface ReadinessReport {
  patientProcedureId: string;
  procedureName: string;
  status: ReadinessStatus;
  /** What the caller may do right now. */
  decision: GateDecision;
  requirements: RequirementResult[];
  /** Requirements that are not PASS, worst first. The list a doctor reads. */
  blocking: RequirementResult[];
  overridable: boolean;
}

/**
 * Evaluate one requirement.
 *
 * Any branch that cannot find what it needs returns UNKNOWN or NOT_CONFIGURED
 * rather than FAIL, and the difference matters: FAIL means "we looked and it is
 * not there", the others mean "we could not tell". All three block; only one is
 * a reproach to the clinic, and conflating them makes the eventual CAPA
 * meaningless — a recurring UNKNOWN is an engineering defect, a recurring FAIL
 * is a behaviour problem, and they need different fixes.
 */
async function evaluateRequirement(
  client: TenantPrisma,
  clock: Clock,
  pp: { id: string; patientId: string; clinicId: string; componentRequirements?: unknown },
  req: { kind: string; label: string },
): Promise<{ result: EvaluationResult; detail: string }> {
  switch (req.kind) {
    case RequirementKind.CONSENT: {
      const consent = await client.consent.findFirst({
        where: {
          patientProcedureId: pp.id,
          consentType: ConsentType.CLINICAL_PROCEDURE,
          withdrawnAt: null,
        },
        orderBy: { signedAt: 'desc' },
      });
      if (!consent) {
        return { result: EvaluationResult.FAIL, detail: 'No signed consent for this procedure.' };
      }
      if (consent.signedAt > clock.now()) {
        // A signature dated in the future is not evidence of anything; it is a
        // data problem, and guessing which way it should fall would be worse.
        return { result: EvaluationResult.UNKNOWN, detail: 'Consent timestamp is in the future.' };
      }
      return {
        result: EvaluationResult.PASS,
        detail: `Signed ${consent.templateCode} v${consent.templateVersion}.`,
      };
    }

    case RequirementKind.IMPLANT_AVAILABLE: {
      // Answered per component, so the block names the missing part rather
      // than sending somebody to go and look.
      const required = (pp.componentRequirements ?? []) as ComponentRequirement[];
      if (required.length === 0) {
        return {
          result: EvaluationResult.UNKNOWN,
          detail: 'No component list recorded for this case, so availability cannot be checked.',
        };
      }
      const { ready, answers } = await implantReadiness(client, clock, pp.clinicId, required);
      if (ready) return { result: EvaluationResult.PASS, detail: 'All components in stock and in date.' };
      const worst = answers.find((a) => a.result === EvaluationResult.FAIL) ?? answers[0]!;
      return { result: worst.result, detail: worst.detail };
    }

    case RequirementKind.STERILE_KIT: {
      // A released batch is the evidence. Sheet L is explicit that a failed
      // cycle cannot release packs, so "released" already carries the cycle
      // result — this does not re-derive it.
      const released = await client.sterilizationBatch.findFirst({
        where: { clinicId: pp.clinicId, stage: 'RELEASED' },
        orderBy: { releasedAt: 'desc' },
      });
      if (!released) {
        return {
          result: EvaluationResult.UNKNOWN,
          detail: 'No sterilisation batch has been released for this clinic.',
        };
      }
      return {
        result: EvaluationResult.PASS,
        detail: `Batch ${released.batchRef} released.`,
      };
    }

    case RequirementKind.EMERGENCY_READY: {
      const answer = await categoryAvailable(client, pp.clinicId, 'EMERGENCY');
      return answer;
    }

    // Everything else is declared and not yet evaluable. Returning
    // NOT_CONFIGURED rather than PASS is the whole of AP-1: a requirement
    // nothing can check must not quietly succeed, and under every enforcement
    // mode it behaves at least as strictly as a failure.
    default:
      return {
        result: EvaluationResult.NOT_CONFIGURED,
        detail: `${req.label} cannot be confirmed yet — no evaluator.`,
      };
  }
}

const SEVERITY: Record<GateDecision, number> = {
  BLOCK_HARD: 0, BLOCK_OVERRIDABLE: 1, WARN: 2, PROCEED: 3,
};

/**
 * Evaluate a patient procedure against its protocol.
 *
 * Read-only as far as clinical facts go: it computes and reports. Callers that
 * intend to act call `startProcedure`, which evaluates again. Two evaluations
 * is the point — the screen shows what is missing, the gate decides at the
 * moment it matters.
 */
export async function evaluateReadiness(
  client: TenantPrisma,
  clock: Clock,
  patientProcedureId: string,
): Promise<ReadinessReport> {
  const pp = await client.patientProcedure.findUnique({
    where: { id: patientProcedureId },
    include: { procedure: { include: { requirements: { orderBy: { sortOrder: 'asc' } } } } },
  });
  if (!pp) throw new ReadinessError('No such patient procedure.', 'NO_PROCEDURE');

  const requirements: RequirementResult[] = [];
  for (const req of pp.procedure.requirements) {
    const { result, detail } = await evaluateRequirement(client, clock, pp, req);
    // An unrecognised enforcement mode falls to the stricter reading, never to
    // ADVISORY. A typo in configuration must not open a gate.
    const mode = (req.enforcement in ENFORCEMENT_MATRIX
      ? req.enforcement
      : EnforcementMode.BLOCK_OVERRIDABLE) as EnforcementMode;
    requirements.push({
      kind: req.kind,
      label: req.label,
      enforcement: mode,
      result,
      decision: ENFORCEMENT_MATRIX[mode][result],
      detail,
    });
  }

  const composite = resolveComposite(requirements.map((r) => r.result));

  // A protocol with no requirements is not "ready" — it is unconfigured, and
  // reporting READY would be the most dangerous thing this file could say.
  const decision = requirements.length === 0
    ? GateDecision.BLOCK_OVERRIDABLE
    : requirements.reduce<GateDecision>(
      (worst, r) => (SEVERITY[r.decision] < SEVERITY[worst] ? r.decision : worst),
      GateDecision.PROCEED,
    );

  const blocking = requirements
    .filter((r) => r.decision !== GateDecision.PROCEED)
    .sort((a, b) => SEVERITY[a.decision] - SEVERITY[b.decision]);

  const status: ReadinessStatus = (() => {
    if (pp.overriddenAt) return ReadinessStatus.OVERRIDDEN;
    if (requirements.length === 0) return ReadinessStatus.PENDING;
    if (decision === GateDecision.PROCEED) return ReadinessStatus.READY;
    if (composite === EvaluationResult.UNKNOWN || composite === EvaluationResult.NOT_CONFIGURED) {
      // Could not be determined. Deliberately not NOT_READY, which would claim
      // knowledge nobody has.
      return ReadinessStatus.PENDING;
    }
    return requirements.some((r) => r.result === EvaluationResult.PASS)
      ? ReadinessStatus.PARTIAL
      : ReadinessStatus.NOT_READY;
  })();

  await client.patientProcedure.update({
    where: { id: patientProcedureId },
    data: { readiness: status, readinessEvaluatedAt: clock.now() },
  });

  return {
    patientProcedureId,
    procedureName: pp.procedure.name,
    status,
    decision,
    requirements,
    blocking,
    // BLOCK_HARD is never overridable. There is no permission to grant.
    overridable: decision === GateDecision.BLOCK_OVERRIDABLE,
  };
}

/**
 * Start the procedure, or refuse.
 *
 * Re-evaluates rather than trusting the stored readiness, which is a cache of
 * an answer to a question asked earlier.
 */
export async function startProcedure(
  client: TenantPrisma,
  clock: Clock,
  patientProcedureId: string,
): Promise<ReadinessReport> {
  const report = await evaluateReadiness(client, clock, patientProcedureId);

  if (report.decision === GateDecision.BLOCK_HARD) {
    throw new ReadinessError(
      `${report.procedureName} cannot start: ${report.blocking[0]?.detail ?? 'a mandatory requirement is not met'}`,
      'BLOCK_HARD',
    );
  }
  if (report.decision === GateDecision.BLOCK_OVERRIDABLE) {
    const pp = await client.patientProcedure.findUniqueOrThrow({
      where: { id: patientProcedureId },
    });
    if (!pp.overriddenAt) {
      throw new ReadinessError(
        `${report.procedureName} is not ready: ${report.blocking[0]?.detail ?? 'a requirement is not met'}`,
        'NOT_READY',
      );
    }
  }

  await client.patientProcedure.update({
    where: { id: patientProcedureId },
    data: { status: 'IN_PROGRESS', startedAt: clock.now() },
  });
  return report;
}

/**
 * Override a BLOCK_OVERRIDABLE gate, with a reason that goes on the record.
 *
 * Refuses BLOCK_HARD outright. The requirement is not that this check exists —
 * it is that no permission to override those gates exists anywhere in the
 * catalogue, so no role can be granted one. This refusal is the second lock.
 */
export async function overrideReadiness(
  client: TenantPrisma,
  clock: Clock,
  patientProcedureId: string,
  employeeId: string,
  reason: string,
): Promise<ReadinessReport> {
  if (!reason.trim()) {
    throw new ReadinessError('An override must record why it was safe.', 'EMPTY_REASON');
  }
  const report = await evaluateReadiness(client, clock, patientProcedureId);
  if (report.decision === GateDecision.BLOCK_HARD) {
    throw new ReadinessError(
      'This requirement cannot be overridden by anyone.',
      'BLOCK_HARD_NOT_OVERRIDABLE',
    );
  }
  if (report.decision === GateDecision.PROCEED) {
    throw new ReadinessError('Nothing to override — the procedure is ready.', 'NOTHING_TO_OVERRIDE');
  }
  await client.patientProcedure.update({
    where: { id: patientProcedureId },
    data: {
      overriddenByEmployeeId: employeeId,
      overrideReason: reason,
      overriddenAt: clock.now(),
      readiness: ReadinessStatus.OVERRIDDEN,
    },
  });
  return { ...report, status: ReadinessStatus.OVERRIDDEN };
}
