/**
 * KuBi — organisation bootstrap. The one place a new tenant comes into
 * existence. Uses withSystemContext because it inserts the very row a
 * normal TenancyContext would read (see rls-context.ts).
 *
 * Deliberately NOT exposed as a public HTTP endpoint (ADR-003: no
 * self-service tenant onboarding). Called from a script or an internal
 * admin action only.
 */
import { randomUUID } from 'node:crypto';
import type { TenantPrisma } from '../../platform/tenancy/rls-context.js';
import { withSystemContext } from '../../platform/tenancy/rls-context.js';
import { hashPassword } from '../../platform/auth/password.service.js';
import { grantClinicalAuthority } from '../../platform/rbac/clinical-authority.service.js';
import { writeAudit, AuditAction } from '../../platform/audit/audit.service.js';
import { loadCanonicalRolesForOrg } from '../../../../../prisma/seed/load-foundation.js';
import { RoleCode } from '@kubi/contracts';
import type { Clock } from '../../shared/clock.js';

export interface BootstrapOrganizationInput {
  orgCode: string;
  orgName: string;
  clinic: { code: string; name: string; timezone: string };
  owner: { email: string; password: string; displayLabel: string; employeeCode: string };
  /** OD-19 — synthetic demo values, explicitly labelled temporary. */
  openingConfig: { openingTimeLocal: string; workingDays: readonly number[] };
}

export interface BootstrapResult {
  organizationId: string;
  clinicId: string;
  ownerUserId: string;
  ownerEmployeeId: string;
}

export async function bootstrapOrganization(
  prisma: TenantPrisma,
  clock: Clock,
  input: BootstrapOrganizationInput,
): Promise<BootstrapResult> {
  const organizationId = randomUUID();
  const clinicId = randomUUID();
  const ownerUserId = randomUUID();
  const ownerEmployeeId = randomUUID();

  await withSystemContext(
    prisma,
    `bootstrap organization ${input.orgCode}`,
    organizationId,
    async (tx) => {
      await tx.organization.create({
        data: { id: organizationId, code: input.orgCode, name: input.orgName },
      });
      await tx.clinic.create({
        data: {
          id: clinicId,
          organizationId,
          code: input.clinic.code,
          name: input.clinic.name,
          timezone: input.clinic.timezone,
        },
      });

      // OD-19: synthetic demo values only, explicitly flagged as temporary.
      await tx.configValue.create({
        data: {
          organizationId,
          clinicId,
          scope: 'CLINIC',
          key: 'clinic.opening_time',
          valueJson: {
            value: input.openingConfig.openingTimeLocal,
            provenance: 'SYNTHETIC_DEMO_TEMPORARY',
            note: 'OD-19: demo value only, not permanent KB Dental policy.',
          },
        },
      });
      await tx.configValue.create({
        data: {
          organizationId,
          clinicId,
          scope: 'CLINIC',
          key: 'clinic.working_days',
          valueJson: {
            value: input.openingConfig.workingDays,
            provenance: 'SYNTHETIC_DEMO_TEMPORARY',
          },
        },
      });
      // OD-20: emergency-readiness enforcement for clinic-open status.
      await tx.configValue.create({
        data: {
          organizationId,
          clinicId,
          scope: 'CLINIC',
          key: 'opening.emergency_readiness_enforcement',
          valueJson: { value: 'BLOCK_OVERRIDABLE' },
        },
      });

      // Permission catalogue is loaded once, globally, via the migrator-
      // privileged prisma/seed/seed-permission-catalogue.ts script — not
      // here. kubi_app holds SELECT-only on `permissions` (migration 0004).
      await loadCanonicalRolesForOrg(tx, organizationId);

      const passwordHash = await hashPassword(input.owner.password);
      await tx.user.create({
        data: { id: ownerUserId, organizationId, email: input.owner.email, passwordHash },
      });
      await tx.employee.create({
        data: {
          id: ownerEmployeeId,
          organizationId,
          userId: ownerUserId,
          code: input.owner.employeeCode,
          displayLabel: input.owner.displayLabel,
        },
      });

      const ownerRole = await tx.role.findUniqueOrThrow({
        where: { organizationId_code: { organizationId, code: RoleCode.OWNER_DIRECTOR } },
      });
      await tx.employeeRole.create({
        data: {
          organizationId,
          clinicId: null, // org-wide
          employeeId: ownerEmployeeId,
          roleId: ownerRole.id,
          grantedBy: ownerEmployeeId, // self, at bootstrap — the one legitimate case
        },
      });

      await writeAudit(tx, {
        organizationId,
        actorEmployeeId: ownerEmployeeId,
        action: AuditAction.ORGANIZATION_PROVISIONED,
        entityType: 'organization',
        entityId: organizationId,
        newValue: { orgCode: input.orgCode, clinicCode: input.clinic.code },
      });
    },
  );

  return { organizationId, clinicId, ownerUserId, ownerEmployeeId };
}

/**
 * Creates an additional employee + user within an already-provisioned org,
 * with clinical authority if specified. Used by the demo seeder for the
 * synthetic VS-01 users (Assistant, Senior Assistant, Reception, Manager).
 */
export async function createDemoEmployee(
  prisma: TenantPrisma,
  clock: Clock,
  input: {
    organizationId: string;
    clinicId: string;
    email: string;
    password: string;
    displayLabel: string;
    employeeCode: string;
    roleCode: (typeof RoleCode)[keyof typeof RoleCode];
    clinicScoped: boolean; // true => role granted at this clinic only; false => org-wide
    grantedByEmployeeId: string;
    clinicalAuthority?: { licenseNumber: string; reason: string };
  },
): Promise<{ userId: string; employeeId: string }> {
  const userId = randomUUID();
  const employeeId = randomUUID();

  await withSystemContext(
    prisma,
    `create demo employee ${input.employeeCode} for VS-01 seed environment`,
    input.organizationId,
    async (tx) => {
      const passwordHash = await hashPassword(input.password);
      await tx.user.create({
        data: { id: userId, organizationId: input.organizationId, email: input.email, passwordHash },
      });
      await tx.employee.create({
        data: {
          id: employeeId,
          organizationId: input.organizationId,
          userId,
          code: input.employeeCode,
          displayLabel: input.displayLabel,
        },
      });
      const role = await tx.role.findUniqueOrThrow({
        where: { organizationId_code: { organizationId: input.organizationId, code: input.roleCode } },
      });
      await tx.employeeRole.create({
        data: {
          organizationId: input.organizationId,
          clinicId: input.clinicScoped ? input.clinicId : null,
          employeeId,
          roleId: role.id,
          grantedBy: input.grantedByEmployeeId,
        },
      });
      if (input.clinicalAuthority) {
        await grantClinicalAuthority(tx, clock, {
          organizationId: input.organizationId,
          employeeId,
          licenseNumber: input.clinicalAuthority.licenseNumber,
          reason: input.clinicalAuthority.reason,
          grantedBy: input.grantedByEmployeeId,
        });
      }
    },
  );

  return { userId, employeeId };
}
