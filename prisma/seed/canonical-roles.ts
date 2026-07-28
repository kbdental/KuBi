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
 * Roles with no Phase 2 grants (RECEPTION beyond patient:view, INVENTORY_
 * COORDINATOR, LAB_COORDINATOR, HOUSEKEEPING, CONDUCT-adjacent) are seeded
 * with an empty permission set: their real permissions arrive with the
 * domain module that defines them (Phase 2+). Seeding placeholder grants for
 * work that doesn't exist would misrepresent what is actually enforced.
 */
import { RoleCode } from '@kubi/contracts';
import { permissionCode } from './permission-catalogue.js';

export interface RoleSeed {
  code: (typeof RoleCode)[keyof typeof RoleCode];
  name: string;
  grants: readonly string[]; // permission codes (resource:action)
}

const c = permissionCode;

export const CANONICAL_ROLES: readonly RoleSeed[] = [
  {
    code: RoleCode.OWNER_DIRECTOR,
    name: 'Owner / Director',
    grants: [
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
      c('employee', 'view'),
      c('competency', 'view'),
      c('patient', 'view'),
    ],
  },
  {
    code: RoleCode.CLINIC_MANAGER,
    name: 'Clinic Manager',
    grants: [
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
    grants: [c('patient', 'view')],
  },
  {
    code: RoleCode.SENIOR_ASSISTANT,
    name: 'Senior Assistant',
    grants: [c('patient', 'view')],
  },
  { code: RoleCode.DENTAL_ASSISTANT, name: 'Dental Assistant', grants: [c('patient', 'view')] },
  { code: RoleCode.INVENTORY_COORDINATOR, name: 'Inventory Coordinator', grants: [] },
  { code: RoleCode.LAB_COORDINATOR, name: 'Lab Coordinator', grants: [] },
  {
    code: RoleCode.QUALITY_COMPLIANCE,
    name: 'Quality / Compliance',
    grants: [c('audit_log', 'view'), c('audit_log', 'view_clinic')],
  },
  { code: RoleCode.HOUSEKEEPING, name: 'Housekeeping', grants: [] },
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
