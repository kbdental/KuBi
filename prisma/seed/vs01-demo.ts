/**
 * VS-01 synthetic demo environment. NO real patient or employee data.
 *
 * Two clinics under one organisation so cross-clinic isolation is testable,
 * and four users because independent verification cannot be demonstrated
 * with fewer: OPN-002's checker is the Senior Assistant, and OPN-003 is the
 * one approved self-verification case (Reception).
 */
import 'dotenv/config';
import { prisma, withSystemContext } from '../../apps/api/src/platform/tenancy/rls-context.js';
import { bootstrapOrganization, createDemoEmployee } from '../../apps/api/src/domains/identity/provisioning.service.js';
import { loadOpeningActivities } from './load-opening-activities.js';
import { seedScheduleForToday } from './vs02-schedule.js';
import { systemClock } from '../../apps/api/src/shared/clock.js';
import { RoleCode, FunctionalAssignmentType } from '@kubi/contracts';

export const DEMO_PASSWORD = 'SyntheticDemo123!';

export interface DemoEnvironment {
  organizationId: string;
  clinicId: string;
  otherClinicId: string;
  assistant: { userId: string; employeeId: string; email: string };
  seniorAssistant: { userId: string; employeeId: string; email: string };
  reception: { userId: string; employeeId: string; email: string };
  manager: { userId: string; employeeId: string; email: string };
  ownerEmployeeId: string;
}

export async function seedVs01Demo(suffix: string): Promise<DemoEnvironment> {
  const boot = await bootstrapOrganization(prisma, systemClock, {
    orgCode: `KBDEMO_${suffix}`,
    orgName: 'SYNTHETIC KB Dental Group',
    clinic: { code: 'ANDHERI', name: 'SYNTHETIC KB Dental Andheri', timezone: 'Asia/Kolkata' },
    owner: {
      email: `owner_${suffix}@synthetic.test`,
      password: DEMO_PASSWORD,
      displayLabel: 'SYNTHETIC Owner',
      employeeCode: `EMP-OWNER-${suffix}`,
    },
    // OD-19 approved synthetic demo values.
    openingConfig: {
      openingTimeLocal: '09:00',
      closingTimeLocal: '20:00',
      workingDays: [1, 2, 3, 4, 5, 6],
    },
  });

  // Second clinic, for cross-clinic isolation testing.
  const otherClinicId = await withSystemContext(
    prisma, 'seed second demo clinic for isolation testing', boot.organizationId,
    async (tx) => {
      const c = await tx.clinic.create({
        data: {
          organizationId: boot.organizationId, code: 'BANDRA',
          name: 'SYNTHETIC KB Dental Bandra', timezone: 'Asia/Kolkata',
        },
      });
      return c.id;
    },
  );

  const mk = (role: (typeof RoleCode)[keyof typeof RoleCode], name: string, code: string) =>
    createDemoEmployee(prisma, systemClock, {
      organizationId: boot.organizationId,
      clinicId: boot.clinicId,
      email: `${code.toLowerCase()}_${suffix}@synthetic.test`,
      password: DEMO_PASSWORD,
      displayLabel: name,
      employeeCode: `${code}-${suffix}`,
      roleCode: role,
      clinicScoped: true,
      grantedByEmployeeId: boot.ownerEmployeeId,
    });

  const assistant = await mk(RoleCode.DENTAL_ASSISTANT, 'SYNTHETIC Priya S.', 'PRIYA');
  const seniorAssistant = await mk(RoleCode.SENIOR_ASSISTANT, 'SYNTHETIC Anita K.', 'ANITA');
  const reception = await mk(RoleCode.RECEPTION, 'SYNTHETIC Kavita R.', 'KAVITA');
  const manager = await mk(RoleCode.CLINIC_MANAGER, 'SYNTHETIC Rahul M.', 'RAHUL');

  await withSystemContext(
    prisma, 'seed VS-01 activity definitions and functional assignments', boot.organizationId,
    async (tx) => {
      await loadOpeningActivities(tx, boot.organizationId);

      // OD-22 approved synthetic functional assignments.
      for (const [employeeId, type] of [
        [assistant.employeeId, FunctionalAssignmentType.ASSIGNED_ASSISTANT],
        [reception.employeeId, FunctionalAssignmentType.RECEPTION_LEAD],
      ] as const) {
        await tx.functionalAssignment.create({
          data: {
            organizationId: boot.organizationId,
            clinicId: boot.clinicId,
            employeeId,
            assignmentType: type,
            grantedBy: boot.ownerEmployeeId,
          },
        });
      }
      // The operatory master. Four, because the owner has four — and as rows
      // rather than a constant, so a fifth is an INSERT. Readiness is
      // calculated per room from this, which is why an empty master reports
      // an unconfigured clinic instead of a ready one.
      await tx.operatory.createMany({
        data: [1, 2, 3, 4].map((n) => ({
          organizationId: boot.organizationId,
          clinicId: boot.clinicId,
          label: `Operatory ${n}`,
          position: n,
        })),
      });

      // VS-02: a synthetic day's schedule, so the clinic has a shape.
      await seedScheduleForToday(tx, systemClock, {
        organizationId: boot.organizationId,
        clinicId: boot.clinicId,
      });
    },
  );

  return {
    organizationId: boot.organizationId,
    clinicId: boot.clinicId,
    otherClinicId,
    assistant: { ...assistant, email: `priya_${suffix}@synthetic.test` },
    seniorAssistant: { ...seniorAssistant, email: `anita_${suffix}@synthetic.test` },
    reception: { ...reception, email: `kavita_${suffix}@synthetic.test` },
    manager: { ...manager, email: `rahul_${suffix}@synthetic.test` },
    ownerEmployeeId: boot.ownerEmployeeId,
  };
}

if (process.argv[1]?.endsWith('vs01-demo.ts')) {
  seedVs01Demo(Date.now().toString(36))
    .then((env) => {
      console.log('VS-01 demo environment seeded (all SYNTHETIC):');
      console.log(JSON.stringify(env, null, 2));
      return prisma.$disconnect();
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
