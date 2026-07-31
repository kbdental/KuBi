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
