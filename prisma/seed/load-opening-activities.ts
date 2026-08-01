/**
 * Loads the standards library — the five OPN opening definitions and the four
 * CLS closing ones — plus their checklists, into one organisation.
 * Idempotent by (organizationId, code, version).
 */
import type { TenantPrisma } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { CLOSING_ACTIVITIES } from './closing-activities.js';
import { OPENING_ACTIVITIES, ESCALATION_DEFAULTS } from './opening-activities.js';

export async function loadOpeningActivities(
  tx: TenantPrisma,
  organizationId: string,
): Promise<number> {
  for (const seed of [...OPENING_ACTIVITIES, ...CLOSING_ACTIVITIES]) {
    const existing = await tx.activityDefinition.findUnique({
      where: { organizationId_code_version: { organizationId, code: seed.code, version: 1 } },
    });
    if (existing) continue;

    const def = await tx.activityDefinition.create({
      data: {
        organizationId,
        code: seed.code,
        version: 1,
        title: seed.title,
        standardText: seed.standardText,
        parameter: seed.parameter,
        process: seed.process,
        priority: seed.priority,
        executionMode: seed.executionMode,
        recurrence: seed.recurrence,
        instanceScope: seed.instanceScope,
        dueRule: seed.dueRule as never,
        assignmentRule: seed.assignmentRule as never,
        sodPolicy: seed.sodPolicy,
        selfVerifyAllowed: seed.selfVerifyAllowed,
        evidenceType: seed.evidenceType,
        gateRequirement: seed.gateRequirement,
        gateEnforcement: seed.gateEnforcementConfigKey,
        failureDefinition: seed.failureDefinition,
        escalationPolicy: seed.escalationPolicy,
        capaPolicy: seed.capaPolicy,
      },
    });

    let ordinal = 0;
    for (const item of seed.checklist) {
      await tx.checklistItemDefinition.create({
        data: {
          organizationId,
          definitionId: def.id,
          ordinal: ordinal++,
          label: item.label,
          requiresValue: item.requiresValue ?? false,
          valueUnit: item.valueUnit ?? null,
          valueMin: item.valueMin ?? null,
          valueMax: item.valueMax ?? null,
        },
      });
    }
  }

  // OD-23 escalation defaults as configuration, not product constants.
  for (const [severity, policy] of Object.entries(ESCALATION_DEFAULTS)) {
    const key = `escalation.${severity.toLowerCase()}`;
    const found = await tx.configValue.findFirst({ where: { organizationId, clinicId: null, key } });
    if (!found) {
      await tx.configValue.create({
        data: { organizationId, clinicId: null, scope: 'ORGANIZATION', key, valueJson: policy as never },
      });
    }
  }

  return OPENING_ACTIVITIES.length + CLOSING_ACTIVITIES.length;
}

/**
 * Loads the rest of the Master Activity Matrix v2.0 — the ninety-two rows the
 * hand-written OPN/CLS set does not cover.
 *
 * Definitions whose due rule could not be resolved from the matrix seed
 * DISABLED. They belong in the register — they are real requirements — but a
 * disabled definition generates nothing, so the clinic never sees work
 * scheduled at an hour nobody agreed to.
 *
 * Returns both counts, because "we loaded 92" and "92 will actually run" are
 * different facts and reporting only the first would be the flattering one.
 */
export async function loadMatrixActivities(
  tx: TenantPrisma,
  organizationId: string,
  repoRoot?: string,
): Promise<{ created: number; enabled: number; disabled: number }> {
  const { matrixActivities } = await import('./matrix-activities.js');
  const seeds = matrixActivities(repoRoot);

  let created = 0;
  let enabled = 0;
  for (const seed of seeds) {
    const existing = await tx.activityDefinition.findUnique({
      where: { organizationId_code_version: { organizationId, code: seed.code, version: 1 } },
    });
    if (existing) continue;

    await tx.activityDefinition.create({
      data: {
        organizationId,
        code: seed.code,
        version: 1,
        title: seed.title,
        standardText: seed.standardText,
        parameter: seed.parameter,
        process: seed.process,
        priority: seed.priority,
        executionMode: seed.executionMode,
        recurrence: seed.recurrence,
        instanceScope: seed.instanceScope,
        dueRule: seed.dueRule as never,
        assignmentRule: seed.assignmentRule as never,
        sodPolicy: seed.sodPolicy,
        selfVerifyAllowed: seed.selfVerifyAllowed,
        evidenceType: seed.evidenceType,
        gateRequirement: seed.gateRequirement,
        gateEnforcement: seed.gateEnforcementConfigKey,
        failureDefinition: seed.failureDefinition,
        escalationPolicy: seed.escalationPolicy,
        capaPolicy: seed.capaPolicy,
        enabled: seed.enabled,
      },
    });
    created += 1;
    if (seed.enabled) enabled += 1;
  }
  return { created, enabled, disabled: created - enabled };
}
