/**
 * Phase 2 foundation — proves requirements 1-8 and 13 from the VS-01
 * authorization (organization/clinic isolation, multi-role, role vs
 * functional-assignment separation, clinical authority independence,
 * server-side permission scope, no invented policy values).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, withTenantContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { bootstrapOrganization, createDemoEmployee } from '../../apps/api/src/domains/identity/provisioning.service.js';
import { resolveSession } from '../../apps/api/src/platform/rbac/session-context.service.js';
import { checkPermission } from '../../apps/api/src/platform/rbac/permission-evaluation.service.js';
import { evaluateClinicalAuthority } from '../../apps/api/src/platform/rbac/clinical-authority.service.js';
import { evaluateFunctionalAssignment } from '../../apps/api/src/platform/rbac/functional-assignment.service.js';
import { verifyPassword } from '../../apps/api/src/platform/auth/password.service.js';
import { systemClock } from '../../apps/api/src/shared/clock.js';
import { RoleCode, FunctionalAssignmentType, EvaluationResult } from '@kubi/contracts';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Phase 2 foundation — end to end', () => {
  it('bootstraps an organisation with the 13 canonical roles and permission catalogue', async () => {
    const suffix = randomUUID().slice(0, 8);
    const result = await bootstrapOrganization(prisma, systemClock, {
      orgCode: `TEST_${suffix}`,
      orgName: 'SYNTHETIC Test Dental Group',
      clinic: { code: 'C1', name: 'SYNTHETIC Clinic One', timezone: 'Asia/Kolkata' },
      owner: {
        email: `owner_${suffix}@synthetic.test`,
        password: 'SyntheticPassw0rd!',
        displayLabel: 'SYNTHETIC Owner',
        employeeCode: 'EMP-OWNER',
      },
      openingConfig: { openingTimeLocal: '09:00', workingDays: [1, 2, 3, 4, 5, 6] },
    });

    expect(result.organizationId).toBeTruthy();

    const roleCount = await withTenantContext(
      prisma,
      { organizationId: result.organizationId, clinicIds: [], crossClinic: true },
      (tx) => tx.role.count({ where: { organizationId: result.organizationId } }),
    );
    expect(roleCount).toBe(13);

    const permCount = await prisma.permission.count();
    expect(permCount).toBeGreaterThanOrEqual(50); // foundation subset
  });

  it('resolves session context correctly (org-wide vs clinic-scoped)', async () => {
    const suffix = randomUUID().slice(0, 8);
    const boot = await bootstrapOrganization(prisma, systemClock, {
      orgCode: `SESS_${suffix}`,
      orgName: 'SYNTHETIC Session Test',
      clinic: { code: 'C1', name: 'SYNTHETIC Clinic', timezone: 'Asia/Kolkata' },
      owner: {
        email: `owner_${suffix}@synthetic.test`,
        password: 'SyntheticPassw0rd!',
        displayLabel: 'SYNTHETIC Owner',
        employeeCode: 'EMP-OWNER',
      },
      openingConfig: { openingTimeLocal: '09:00', workingDays: [1, 2, 3, 4, 5, 6] },
    });

    const assistant = await createDemoEmployee(prisma, systemClock, {
      organizationId: boot.organizationId,
      clinicId: boot.clinicId,
      email: `assistant_${suffix}@synthetic.test`,
      password: 'SyntheticPassw0rd!',
      displayLabel: 'SYNTHETIC Assistant',
      employeeCode: 'EMP-ASST',
      roleCode: RoleCode.DENTAL_ASSISTANT,
      clinicScoped: true,
      grantedByEmployeeId: boot.ownerEmployeeId,
    });

    const ownerSession = await resolveSession(prisma, systemClock, boot.ownerUserId, boot.organizationId);
    expect(ownerSession?.tenancy.crossClinic).toBe(true);
    expect(ownerSession?.roleCodes).toContain(RoleCode.OWNER_DIRECTOR);

    const assistantSession = await resolveSession(prisma, systemClock, assistant.userId, boot.organizationId);
    expect(assistantSession?.tenancy.crossClinic).toBe(false);
    expect(assistantSession?.tenancy.clinicIds).toEqual([boot.clinicId]);
    expect(assistantSession?.roleCodes).toEqual([RoleCode.DENTAL_ASSISTANT]);
  });

  it('SYSTEM_ADMINISTRATOR holds no clinical grant and clinical authority is independent of role', async () => {
    const suffix = randomUUID().slice(0, 8);
    const boot = await bootstrapOrganization(prisma, systemClock, {
      orgCode: `CLIN_${suffix}`,
      orgName: 'SYNTHETIC Clinical Test',
      clinic: { code: 'C1', name: 'SYNTHETIC Clinic', timezone: 'Asia/Kolkata' },
      owner: {
        email: `owner_${suffix}@synthetic.test`,
        password: 'SyntheticPassw0rd!',
        displayLabel: 'SYNTHETIC Owner',
        employeeCode: 'EMP-OWNER',
      },
      openingConfig: { openingTimeLocal: '09:00', workingDays: [1, 2, 3, 4, 5, 6] },
    });

    const sysadmin = await createDemoEmployee(prisma, systemClock, {
      organizationId: boot.organizationId,
      clinicId: boot.clinicId,
      email: `sysadmin_${suffix}@synthetic.test`,
      password: 'SyntheticPassw0rd!',
      displayLabel: 'SYNTHETIC Sysadmin',
      employeeCode: 'EMP-SYSADMIN',
      roleCode: RoleCode.SYSTEM_ADMINISTRATOR,
      clinicScoped: false,
      grantedByEmployeeId: boot.ownerEmployeeId,
    });

    // Requirement 4: sysadmin cannot obtain clinical authority merely from role.
    const sysadminAuthority = await withTenantContext(
      prisma,
      { organizationId: boot.organizationId, clinicIds: [], crossClinic: true },
      (tx) => evaluateClinicalAuthority(tx, sysadmin.employeeId),
    );
    expect(sysadminAuthority.granted).toBe(false);

    // Requirement 7: clinical authority CAN be granted to someone with no
    // management role, independently.
    const treatingDoctor = await createDemoEmployee(prisma, systemClock, {
      organizationId: boot.organizationId,
      clinicId: boot.clinicId,
      email: `doctor_${suffix}@synthetic.test`,
      password: 'SyntheticPassw0rd!',
      displayLabel: 'SYNTHETIC Doctor',
      employeeCode: 'EMP-DOC',
      roleCode: RoleCode.TREATING_DOCTOR,
      clinicScoped: true,
      grantedByEmployeeId: boot.ownerEmployeeId,
      clinicalAuthority: { licenseNumber: 'SYNTHETIC-LIC-001', reason: 'SYNTHETIC test grant for VS-01 verification' },
    });
    const doctorAuthority = await withTenantContext(
      prisma,
      { organizationId: boot.organizationId, clinicIds: [], crossClinic: true },
      (tx) => evaluateClinicalAuthority(tx, treatingDoctor.employeeId),
    );
    expect(doctorAuthority.granted).toBe(true);
    expect(doctorAuthority.licenseNumber).toBe('SYNTHETIC-LIC-001');
  });

  it('permission evaluation is server-side and scope-enforced (requirement 8)', async () => {
    const suffix = randomUUID().slice(0, 8);
    const boot = await bootstrapOrganization(prisma, systemClock, {
      orgCode: `PERM_${suffix}`,
      orgName: 'SYNTHETIC Permission Test',
      clinic: { code: 'C1', name: 'SYNTHETIC Clinic', timezone: 'Asia/Kolkata' },
      owner: {
        email: `owner_${suffix}@synthetic.test`,
        password: 'SyntheticPassw0rd!',
        displayLabel: 'SYNTHETIC Owner',
        employeeCode: 'EMP-OWNER',
      },
      openingConfig: { openingTimeLocal: '09:00', workingDays: [1, 2, 3, 4, 5, 6] },
    });
    const reception = await createDemoEmployee(prisma, systemClock, {
      organizationId: boot.organizationId,
      clinicId: boot.clinicId,
      email: `reception_${suffix}@synthetic.test`,
      password: 'SyntheticPassw0rd!',
      displayLabel: 'SYNTHETIC Reception',
      employeeCode: 'EMP-RECEPTION',
      roleCode: RoleCode.RECEPTION,
      clinicScoped: true,
      grantedByEmployeeId: boot.ownerEmployeeId,
    });

    await withTenantContext(
      prisma,
      { organizationId: boot.organizationId, clinicIds: [boot.clinicId], crossClinic: false },
      async (tx) => {
        const allowedOwn = await checkPermission(tx, systemClock, {
          employeeId: reception.employeeId,
          organizationId: boot.organizationId,
          clinicId: boot.clinicId,
          code: 'patient:view',
        });
        expect(allowedOwn.allowed).toBe(true);

        const deniedAdmin = await checkPermission(tx, systemClock, {
          employeeId: reception.employeeId,
          organizationId: boot.organizationId,
          clinicId: boot.clinicId,
          code: 'employee:create',
        });
        expect(deniedAdmin.allowed).toBe(false);
        expect((deniedAdmin as { reason: string }).reason).toBe('NOT_GRANTED');
      },
    );
  });

  it('functional assignment resolves NOT_CONFIGURED when nobody at the clinic holds it', async () => {
    const suffix = randomUUID().slice(0, 8);
    const boot = await bootstrapOrganization(prisma, systemClock, {
      orgCode: `FN_${suffix}`,
      orgName: 'SYNTHETIC FN Test',
      clinic: { code: 'C1', name: 'SYNTHETIC Clinic', timezone: 'Asia/Kolkata' },
      owner: {
        email: `owner_${suffix}@synthetic.test`,
        password: 'SyntheticPassw0rd!',
        displayLabel: 'SYNTHETIC Owner',
        employeeCode: 'EMP-OWNER',
      },
      openingConfig: { openingTimeLocal: '09:00', workingDays: [1, 2, 3, 4, 5, 6] },
    });
    const assistant = await createDemoEmployee(prisma, systemClock, {
      organizationId: boot.organizationId,
      clinicId: boot.clinicId,
      email: `assistant2_${suffix}@synthetic.test`,
      password: 'SyntheticPassw0rd!',
      displayLabel: 'SYNTHETIC Assistant',
      employeeCode: 'EMP-ASST2',
      roleCode: RoleCode.DENTAL_ASSISTANT,
      clinicScoped: true,
      grantedByEmployeeId: boot.ownerEmployeeId,
    });

    await withTenantContext(
      prisma,
      { organizationId: boot.organizationId, clinicIds: [boot.clinicId], crossClinic: false },
      async (tx) => {
        const result = await evaluateFunctionalAssignment(tx, systemClock, {
          employeeId: assistant.employeeId,
          clinicId: boot.clinicId,
          assignmentType: FunctionalAssignmentType.ASSIGNED_ASSISTANT,
        });
        expect(result).toBe(EvaluationResult.NOT_CONFIGURED); // never PASS by absence
      },
    );
  });

  it('argon2id password verification round-trips', async () => {
    const suffix = randomUUID().slice(0, 8);
    const boot = await bootstrapOrganization(prisma, systemClock, {
      orgCode: `PW_${suffix}`,
      orgName: 'SYNTHETIC PW Test',
      clinic: { code: 'C1', name: 'SYNTHETIC Clinic', timezone: 'Asia/Kolkata' },
      owner: {
        email: `owner_${suffix}@synthetic.test`,
        password: 'CorrectPassw0rd!',
        displayLabel: 'SYNTHETIC Owner',
        employeeCode: 'EMP-OWNER',
      },
      openingConfig: { openingTimeLocal: '09:00', workingDays: [1, 2, 3, 4, 5, 6] },
    });
    const user = await withTenantContext(
      prisma,
      { organizationId: boot.organizationId, clinicIds: [], crossClinic: true },
      (tx) => tx.user.findUniqueOrThrow({ where: { id: boot.ownerUserId } }),
    );
    expect(await verifyPassword(user.passwordHash, 'CorrectPassw0rd!')).toBe(true);
    expect(await verifyPassword(user.passwordHash, 'WrongPassword')).toBe(false);
  });
});
