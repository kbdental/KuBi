/**
 * KuBi — the 13 canonical roles (FRS §3) and their Phase 2 foundation grants.
 *
 * Grant design follows the closed owner decisions directly:
 *   - OD-01: CLINIC_HEAD is management authority ONLY. No clinical grants.
 *   - Global policy: management authority never equals clinical authority.
 *     Even CLINICAL_DIRECTOR and TREATING_DOCTOR hold no ClinicalAuthority row
 *     from role alone — provisioning grants it explicitly, per employee, with
 *     a reason and licence reference. Role membership and clinical authority
 *     are proven independent by construction, not by convention.
 *   - Owner control 8: SYSTEM_ADMINISTRATOR gets NO clinical_authority,
 *     competency:assess, or patient:* grants — narrowly technical (users,
 *     sessions, technical config, role/permission catalogue visibility).
 *     OD-04 ("technical audit yes, clinical content no") is approximated in
 *     Phase 2 by withholding audit_log:view_all_clinics from
 *     SYSTEM_ADMINISTRATOR entirely; a technical/clinical audit-stream split
 *     is deferred — see technical debt TD-11.
 *   - The BREAK_GLASS-class permissions (user:impersonate,
 *     employee:emergency_access, role:emergency_grant,
 *     audit_log:emergency_access, patient:emergency_access) appear in NO
 *     role's grant list below — the database trigger
 *     `role_permissions_forbid_break_glass` makes that structural, not just
 *     a seeding choice.
 *
 * Every operational role holds DOES_WORK, because every one of them can be
 * assigned an activity. Roles whose DOMAIN permissions do not exist yet
 * (inventory, lab, quality) hold only that: their module-specific grants
 * arrive with the module. Seeding placeholder grants for work that does not
 * exist would misrepresent what is actually enforced.
 *
 * SYSTEM_ADMINISTRATOR deliberately does NOT hold DOES_WORK — it is a
 * technical role, not an operational one, and clinic work is not its job.
 */
import { RoleCode } from '@kubi/contracts';
import { permissionCode } from './permission-catalogue.js';

export interface RoleSeed {
  code: (typeof RoleCode)[keyof typeof RoleCode];
  name: string;
  grants: readonly string[]; // permission codes (resource:action)
}

const c = permissionCode;

/**
 * Every operational role can see and do their OWN work, and report a problem.
 * Narrowing to "own" is a RECORD-RELATION check in the service layer, not a
 * separate permission — holding activity_instance:complete does not let you
 * complete somebody else's task.
 */
const DOES_WORK: readonly string[] = [
  c('activity_definition', 'view'),
  c('activity_instance', 'view'),
  c('activity_instance', 'start'),
  c('activity_instance', 'complete'),
  c('activity_instance', 'report_problem'),
  c('checklist', 'respond'),
  c('attention_item', 'view'),
];

/**
 * VS-02: who deals with the day's schedule. Reception runs the front desk;
 * clinical and management roles need it because their day IS the schedule.
 * Housekeeping, inventory and lab do not — the schedule is not their job, and
 * a patient list they have no use for is a patient list they should not see.
 */
const RUNS_THE_DAY: readonly string[] = [
  c('appointment', 'view'),
  c('appointment', 'update_status'),
  c('appointment', 'cancel'),
];

/** Roles that act as an independent CHECK on someone else's work. */
const VERIFIES: readonly string[] = [c('activity_instance', 'verify')];

/** Roles that own and close PROBLEMS. */
const RESOLVES: readonly string[] = [c('attention_item', 'resolve'), c('activity_instance', 'view_clinic')];

/**
 * Usability review Q2: deciding it is safe to finish a task whose requirement
 * cannot be confirmed is management authority, not something the person
 * holding the checklist should carry at 8:45am.
 *
 * Held by management and clinical governance only — deliberately NOT by
 * TREATING_DOCTOR or SENIOR_ASSISTANT, who can do and check work but do not
 * carry accountability for proceeding without confirmation. An assistant's
 * honest path is unchanged and always available: report a problem.
 */
const OVERRIDES_CANT_CONFIRM: readonly string[] = [c('activity_instance', 'override_gate')];

export const CANONICAL_ROLES: readonly RoleSeed[] = [
  {
    code: RoleCode.OWNER_DIRECTOR,
    name: 'Owner / Director',
    grants: [
      ...DOES_WORK, ...VERIFIES, ...RESOLVES, ...OVERRIDES_CANT_CONFIRM, ...RUNS_THE_DAY,
      c('organization', 'view'), c('organization', 'update'), c('organization', 'configure'),
      c('clinic', 'view'), c('clinic', 'create'), c('clinic', 'update'), c('clinic', 'archive'), c('clinic', 'configure'),
      c('config_value', 'view'), c('config_value', 'set'), c('config_value', 'view_history'),
      c('employee', 'view'), c('employee', 'create'), c('employee', 'update'), c('employee', 'archive'), c('employee', 'view_all_clinics'), c('employee', 'assign_clinic'),
      c('role', 'view'), c('role', 'create'), c('role', 'update'), c('role', 'archive'), c('role', 'assign'), c('role', 'revoke'),
      c('permission', 'view'), c('permission', 'grant'), c('permission', 'revoke'),
      c('clinical_authority', 'view'), c('clinical_authority', 'grant'), c('clinical_authority', 'revoke'),
      c('functional_assignment', 'view'), c('functional_assignment', 'grant'), c('functional_assignment', 'revoke'),
      c('competency', 'view'), c('competency', 'define_requirement'), c('competency', 'revoke'), c('competency', 'view_expiry'),
      c('audit_log', 'view'), c('audit_log', 'view_clinic'), c('audit_log', 'view_all_clinics'), c('audit_log', 'export'),
      c('break_glass_grant', 'view'), c('break_glass_grant', 'activate'), c('break_glass_grant', 'revoke'),
      c('patient', 'view'), c('patient', 'view_all_clinics'),
    ],
  },
  {
    code: RoleCode.CLINIC_HEAD,
    name: 'Clinic Head',
    // OD-01: management authority only. Deliberately excludes clinical_authority
    // grant/revoke, competency:assess, and any implied clinical grant.
    grants: [
      ...DOES_WORK, ...VERIFIES, ...RESOLVES, ...OVERRIDES_CANT_CONFIRM, ...RUNS_THE_DAY,
      c('organization', 'view'),
      c('clinic', 'view'), c('clinic', 'update'), c('clinic', 'configure'),
      c('config_value', 'view'), c('config_value', 'set'), c('config_value', 'view_history'),
      c('employee', 'view'), c('employee', 'create'), c('employee', 'update'), c('employee', 'assign_clinic'),
      c('role', 'view'), c('role', 'assign'), c('role', 'revoke'),
      c('permission', 'view'),
      c('functional_assignment', 'view'), c('functional_assignment', 'grant'), c('functional_assignment', 'revoke'),
      c('competency', 'view'), c('competency', 'view_expiry'),
      c('audit_log', 'view'), c('audit_log', 'view_clinic'),
      c('break_glass_grant', 'view'), c('break_glass_grant', 'activate'), c('break_glass_grant', 'revoke'),
      c('patient', 'view'),
    ],
  },
  {
    code: RoleCode.CLINICAL_DIRECTOR,
    name: 'Clinical Director',
    // Governs OTHER people's clinical authority; does not imply the Clinical
    // Director's OWN ClinicalAuthority row, which provisioning grants explicitly.
    grants: [
      ...DOES_WORK, ...VERIFIES, ...RESOLVES, ...OVERRIDES_CANT_CONFIRM, ...RUNS_THE_DAY,
      c('employee', 'view'),
      c('clinical_authority', 'view'), c('clinical_authority', 'grant'), c('clinical_authority', 'revoke'),
      c('functional_assignment', 'view'), c('functional_assignment', 'grant'), c('functional_assignment', 'revoke'),
      c('competency', 'view'), c('competency', 'define_requirement'), c('competency', 'assess'), c('competency', 'revoke'), c('competency', 'view_expiry'),
      c('audit_log', 'view'), c('audit_log', 'view_clinic'),
      c('patient', 'view'), c('patient', 'view_all_clinics'),
    ],
  },
  {
    code: RoleCode.TREATING_DOCTOR,
    name: 'Treating / Associate Doctor',
    grants: [
      ...DOES_WORK, ...VERIFIES, ...RUNS_THE_DAY,
      c('employee', 'view'),
      c('competency', 'view'),
      c('patient', 'view'),
    ],
  },
  {
    code: RoleCode.CLINIC_MANAGER,
    name: 'Clinic Manager',
    grants: [
      ...DOES_WORK, ...VERIFIES, ...RESOLVES, ...OVERRIDES_CANT_CONFIRM, ...RUNS_THE_DAY,
      c('clinic', 'view'),
      c('employee', 'view'), c('employee', 'update'),
      c('functional_assignment', 'view'), c('functional_assignment', 'grant'), c('functional_assignment', 'revoke'),
      c('config_value', 'view'),
      c('audit_log', 'view'), c('audit_log', 'view_clinic'),
      c('patient', 'view'),
    ],
  },
  {
    code: RoleCode.RECEPTION,
    name: 'Reception',
    grants: [
      ...DOES_WORK, ...RUNS_THE_DAY, c('appointment', 'create'),
      c('patient', 'view'),
    ],
  },
  {
    code: RoleCode.SENIOR_ASSISTANT,
    name: 'Senior Assistant',
    grants: [
      ...DOES_WORK, ...VERIFIES, c('appointment', 'view'),
      c('patient', 'view'),
    ],
  },
  {
    code: RoleCode.DENTAL_ASSISTANT,
    name: 'Dental Assistant',
    // Sees the day so they can prepare for it; does not move visits along.
    grants: [...DOES_WORK, c('appointment', 'view'), c('patient', 'view')],
  },
  { code: RoleCode.INVENTORY_COORDINATOR, name: 'Inventory Coordinator', grants: [...DOES_WORK] },
  { code: RoleCode.LAB_COORDINATOR, name: 'Lab Coordinator', grants: [...DOES_WORK] },
  {
    code: RoleCode.QUALITY_COMPLIANCE,
    name: 'Quality / Compliance',
    grants: [
      ...DOES_WORK,
      c('audit_log', 'view'), c('audit_log', 'view_clinic'),
    ],
  },
  { code: RoleCode.HOUSEKEEPING, name: 'Housekeeping', grants: [...DOES_WORK] },
  {
    code: RoleCode.SYSTEM_ADMINISTRATOR,
    name: 'System Administrator',
    // Owner control 8: narrowly technical. No clinical_authority, no
    // competency:assess, no patient:*, no audit_log:view_all_clinics
    // (OD-04 — technical audit only; full split deferred, TD-11).
    grants: [
      c('user', 'view'), c('user', 'create'), c('user', 'update'), c('user', 'archive'),
      c('user', 'reset_password'), c('user', 'force_logout'), c('user', 'manage_mfa'),
      c('session', 'view'), c('session', 'revoke'),
      c('config_value', 'view'), c('config_value', 'set'),
      c('role', 'view'), c('role', 'create'), c('role', 'update'),
      c('permission', 'view'),
      c('audit_log', 'view'),
    ],
  },
] as const;
