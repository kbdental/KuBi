/**
 * KuBi — Phase 2 permission catalogue.
 *
 * SCOPE NOTE: Phase 0.5 Deliverable 1 specified 171 permissions across 47
 * resources spanning every future module. Phase 2 builds the identity/RBAC
 * FOUNDATION only — no clinical, inventory, sterilization, equipment, implant
 * or quality tables exist yet. Seeding permission rows for resources with no
 * backing table would be metadata theatre, not an implemented permission
 * model. This file therefore seeds the ~60-permission FOUNDATION subset —
 * identity, org, people-admin, RBAC-admin, audit, break-glass, and the
 * Patient resource (which exists since Phase 1) — and is explicitly a subset,
 * not a replacement, of the Phase 0.5 catalogue. The remainder is seeded
 * module-by-module as each domain's tables land.
 *
 * Every permission is provenance-tagged: DERIVED (from FRS/Build Pack/Matrix
 * or an approved owner decision) or NEW (introduced for the Phase 2 build,
 * with its rationale stated).
 */
import { PermissionClass } from '@kubi/contracts';

export interface PermissionSeed {
  resource: string;
  action: string;
  class: (typeof PermissionClass)[keyof typeof PermissionClass];
  note: string;
}

function p(
  resource: string,
  action: string,
  cls: PermissionSeed['class'],
  note: string,
): PermissionSeed {
  return { resource, action, class: cls, note };
}

const S = PermissionClass.STANDARD;
const C = PermissionClass.CLINICAL;
const A = PermissionClass.ADMIN;
const B = PermissionClass.BREAK_GLASS;

export const PERMISSION_CATALOGUE: readonly PermissionSeed[] = [
  // -- identity -------------------------------------------------------------
  p('user', 'view', S, 'Phase 0.5 D1 identity.user'),
  p('user', 'create', A, 'Phase 0.5 D1 identity.user'),
  p('user', 'update', A, 'Phase 0.5 D1 identity.user'),
  p('user', 'archive', A, 'Phase 0.5 D1 identity.user'),
  p('user', 'reset_password', A, 'Phase 0.5 D1 identity.user'),
  p('user', 'force_logout', A, 'Phase 0.5 D1 identity.user'),
  p('user', 'manage_mfa', A, 'Phase 0.5 D1 identity.user'),
  p('user', 'impersonate', B, 'Phase 0.5 D1 identity.user — the entire BYPASSRLS-free escape hatch runs through break_glass_grants, never a standing role'),

  p('session', 'view', A, 'Phase 0.5 D1 identity.session'),
  p('session', 'revoke', A, 'Phase 0.5 D1 identity.session'),

  // -- organization -----------------------------------------------------------
  p('organization', 'view', S, 'Phase 0.5 D1 org.organization'),
  p('organization', 'update', A, 'Phase 0.5 D1 org.organization'),
  p('organization', 'configure', A, 'Phase 0.5 D1 org.organization'),

  p('clinic', 'view', S, 'Phase 0.5 D1 org.clinic'),
  p('clinic', 'create', A, 'Phase 0.5 D1 org.clinic'),
  p('clinic', 'update', A, 'Phase 0.5 D1 org.clinic'),
  p('clinic', 'archive', A, 'Phase 0.5 D1 org.clinic'),
  p('clinic', 'configure', A, 'Phase 0.5 D1 org.clinic'),

  p('config_value', 'view', S, 'NEW — minimal config registry, satisfies D-01 (jurisdiction configurable, not hard-coded)'),
  p('config_value', 'set', A, 'NEW — see above'),
  p('config_value', 'view_history', S, 'Phase 0.5 D1 org.config_value'),

  // -- people -----------------------------------------------------------------
  p('employee', 'view', S, 'Phase 0.5 D1 people.employee'),
  p('employee', 'create', A, 'Phase 0.5 D1 people.employee'),
  p('employee', 'update', A, 'Phase 0.5 D1 people.employee'),
  p('employee', 'archive', A, 'Phase 0.5 D1 people.employee'),
  p('employee', 'view_all_clinics', A, 'Phase 0.5 D1 people.employee — cross-clinic HR visibility'),
  p('employee', 'assign_clinic', A, 'Phase 0.5 D1 people.employee'),
  p('employee', 'emergency_access', B, 'NEW — break-glass only; HR record access bypassing normal manager scoping'),

  p('role', 'view', S, 'Phase 0.5 D1 people.role'),
  p('role', 'create', A, 'Phase 0.5 D1 people.role'),
  p('role', 'update', A, 'Phase 0.5 D1 people.role'),
  p('role', 'archive', A, 'Phase 0.5 D1 people.role'),
  p('role', 'assign', A, 'Epic E01 — assign multiple clinic-specific roles'),
  p('role', 'revoke', A, 'Epic E01'),
  p('role', 'emergency_grant', B, 'NEW — break-glass only; e.g. recovering from an all-admin lockout'),

  p('permission', 'view', S, 'Phase 0.5 D1 people.permission'),
  p('permission', 'grant', A, 'Phase 0.5 D1 people.permission'),
  p('permission', 'revoke', A, 'Phase 0.5 D1 people.permission'),

  // -- clinical authority, functional assignment, competency (Phase 0 §09 seams)
  p('clinical_authority', 'view', S, 'NEW — Phase 0 §09 authority axis'),
  p('clinical_authority', 'grant', A, 'NEW — deliberately ADMIN-class: the grant itself is a governance act, checked further by which ROLE holds it (seeded to CLINICAL_DIRECTOR/OWNER_DIRECTOR only), not by requiring clinical authority to grant clinical authority (a bootstrapping impossibility)'),
  p('clinical_authority', 'revoke', A, 'NEW — see above'),

  p('functional_assignment', 'view', S, 'NEW — Phase 0.5 D2 finding'),
  p('functional_assignment', 'grant', A, 'NEW'),
  p('functional_assignment', 'revoke', A, 'NEW'),

  p('competency', 'view', S, 'NEW — ADR-014 seam (Assignment engine competency-aware from MVP)'),
  p('competency', 'define_requirement', A, 'NEW — ADR-014'),
  p('competency', 'assess', C, 'NEW — ADR-014; CLINICAL-classed because a competency assessment is a clinical/professional judgement'),
  p('competency', 'revoke', A, 'NEW — ADR-014'),
  p('competency', 'view_expiry', S, 'NEW — ADR-014, A26'),

  // -- audit --------------------------------------------------------------
  p('audit_log', 'view', S, 'Phase 0.5 D1 audit.audit_log'),
  p('audit_log', 'view_clinic', S, 'Phase 0.5 D1 audit.audit_log'),
  p('audit_log', 'view_all_clinics', A, 'Phase 0.5 D1 audit.audit_log; OD-04: technical audit only for SYSTEM_ADMINISTRATOR, see role-seed note'),
  p('audit_log', 'export', A, 'Phase 0.5 D1 audit.audit_log'),
  p('audit_log', 'emergency_access', B, 'NEW — break-glass only; incident investigation beyond normal scope'),

  // -- break-glass administration -----------------------------------------
  p('break_glass_grant', 'view', A, 'NEW — Phase 0 §09'),
  p('break_glass_grant', 'activate', A, 'NEW — creating a time-boxed grant is itself an ADMIN act, held only by OWNER_DIRECTOR/CLINIC_HEAD'),
  p('break_glass_grant', 'revoke', A, 'NEW'),

  // -- work, checks and attention (VS-01 activity engine) -----------------
  p('activity_definition', 'view', S, 'VS-01 — the standards library'),
  p('activity_instance', 'view', S, 'VS-01 — own tasks; narrowed further by record relation'),
  p('activity_instance', 'view_clinic', S, 'VS-01 — all tasks at this clinic'),
  p('activity_instance', 'start', S, 'VS-01 — assignee only, enforced by record relation'),
  p('activity_instance', 'complete', S, 'VS-01 — assignee only'),
  p('activity_instance', 'report_problem', S, 'VS-01 — everyone. Reporting must never be gated'),
  p('activity_instance', 'verify', S, 'VS-01 — per the definition checker rule; blocked when verifier = doer'),
  p('checklist', 'respond', S, 'VS-01 — assignee only'),
  p('attention_item', 'view', S, 'VS-01 — Attention list, scoped to the caller'),
  p('attention_item', 'resolve', S, 'VS-01 — accountable owner, manager and above'),
  p('activity_instance', 'override_gate', A, 'VS-01 usability review Q2 — finishing a task whose requirement cannot be confirmed is a management judgement, not a task-level one. ADMIN-class because deciding it is safe to proceed without confirmation is a governance act. Never applies to BLOCK_HARD, which has no override path at all (ADR-004)'),

  // -- appointments (VS-02) -----------------------------------------------
  p('appointment', 'view', S, 'VS-02 — today\'s schedule at this clinic'),
  p('appointment', 'update_status', S, 'VS-02 — arrived / in the chair / finished / cancelled. Reception and clinical staff both do this in practice, so it is STANDARD-class and narrowed by clinic scope rather than by role'),
  p('appointment', 'create', S, 'VS-02 — booking. Not yet exposed in the UI; the permission exists so scheduling lands against a real grant rather than inventing one later'),
  p('appointment', 'cancel', S, 'VS-02 — cancelling always records a reason (database trigger, not just a form)'),

  // -- patient (table exists since Phase 1; no clinical workflow built) ----
  p('patient', 'view', S, 'Phase 0.5 D1 clinical.patient — clinic-scoped read only; no clinical fields exist yet'),
  p('patient', 'view_all_clinics', A, 'ADR-002/D-02 — the org-wide visibility permission that OD-05 governs'),
  p('patient', 'emergency_access', B, 'NEW — break-glass only'),
] as const;

/** Fast lookup by `resource:action` code. */
export function permissionCode(resource: string, action: string): string {
  return `${resource}:${action}`;
}
