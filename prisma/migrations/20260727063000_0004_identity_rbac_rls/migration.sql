-- KuBi — Phase 2: RLS, least privilege and invariant triggers for the
-- identity/RBAC foundation.
--
-- Follows the pattern established in 0002_rls.sql: FORCE ROW LEVEL SECURITY
-- on every tenant-scoped table (so even the owner is subject to policy),
-- fail-closed context accessors already defined there, and no BYPASSRLS
-- anywhere. This migration does not redefine kubi_current_org() /
-- kubi_current_clinics() / kubi_cross_clinic() — it reuses them.

-- ---------------------------------------------------------------------------
-- ORG-ONLY tables: policy checks organization_id alone.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'clinical_authorities', 'roles', 'role_permissions',
    'employee_competencies', 'config_values', 'audit_logs',
    'break_glass_grants', 'refresh_tokens'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = kubi_current_org()) WITH CHECK (organization_id = kubi_current_org())',
      t || '_org_isolation', t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Employee — org-scoped by default. Full clinic-level narrowing is deferred:
-- an employee's CLINIC visibility is governed by their EmployeeRole grants,
-- not by a clinic_id column on employees itself (an employee has no single
-- "home clinic" in the model — they may hold clinic-scoped OR org-wide roles
-- simultaneously). The permission-evaluation layer (not RLS) is what narrows
-- which employees a caller may act on; RLS here provides the org boundary,
-- which is the non-negotiable outer wall.
-- ---------------------------------------------------------------------------
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
CREATE POLICY employees_org_isolation ON employees
  USING (organization_id = kubi_current_org())
  WITH CHECK (organization_id = kubi_current_org());

-- ---------------------------------------------------------------------------
-- TWO-LEVEL tables: employee_roles and functional_assignments carry a real
-- clinic_id (nullable on employee_roles = org-wide grant, matching
-- TenancyContext.crossClinic semantics from the Patient policy in 0002).
-- ---------------------------------------------------------------------------
ALTER TABLE employee_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY employee_roles_two_level_isolation ON employee_roles
  USING (
    organization_id = kubi_current_org()
    AND (
      kubi_cross_clinic()
      OR clinic_id IS NULL                              -- org-wide grants are visible org-wide
      OR clinic_id = ANY (kubi_current_clinics())
    )
  )
  WITH CHECK (
    organization_id = kubi_current_org()
    AND (kubi_cross_clinic() OR clinic_id IS NULL OR clinic_id = ANY (kubi_current_clinics()))
  );

ALTER TABLE functional_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE functional_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY functional_assignments_two_level_isolation ON functional_assignments
  USING (
    organization_id = kubi_current_org()
    AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics()))
  )
  WITH CHECK (
    organization_id = kubi_current_org()
    AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics()))
  );

-- ---------------------------------------------------------------------------
-- Permission is GLOBAL reference data (Phase 2 schema comment) — no RLS.
-- Least privilege still applies: the app role may read but never write it;
-- the catalogue changes only via a migration, never via application code.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Least privilege grants for kubi_app.
--
-- Deliberately asymmetric per table:
--   - Most tables: SELECT, INSERT, UPDATE. No DELETE (Phase 0 §19 — cancel or
--     supersede, never delete).
--   - audit_logs: SELECT, INSERT ONLY. No UPDATE either — an audit row must
--     never change after it is written. Enforced twice: by grant, and by the
--     trigger below (defence in depth, per Phase 0 §14).
--   - permissions: SELECT only. It is a catalogue, not tenant data.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON
  users, employees, clinical_authorities, roles, role_permissions,
  employee_roles, functional_assignments, employee_competencies,
  config_values, break_glass_grants, refresh_tokens
  TO kubi_app;
GRANT SELECT, INSERT ON audit_logs TO kubi_app;
GRANT SELECT ON permissions TO kubi_app;

REVOKE DELETE, TRUNCATE ON
  users, employees, clinical_authorities, roles, role_permissions,
  employee_roles, functional_assignments, employee_competencies,
  config_values, audit_logs, break_glass_grants, refresh_tokens, permissions
  FROM kubi_app;
REVOKE UPDATE ON audit_logs FROM kubi_app;

GRANT EXECUTE ON FUNCTION kubi_current_org()     TO kubi_app;
GRANT EXECUTE ON FUNCTION kubi_current_clinics() TO kubi_app;
GRANT EXECUTE ON FUNCTION kubi_cross_clinic()    TO kubi_app;

-- ---------------------------------------------------------------------------
-- Invariant 1: audit_logs is immutable, full stop.
--
-- The GRANT-level REVOKE above stops kubi_app. This trigger stops EVERYONE,
-- including kubi_migrator and any future superuser session, because a table
-- owner bypasses ordinary GRANTs but not a trigger. This is what makes
-- "immutable audit events" (owner control 11) a database fact, not an
-- application convention.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kubi_audit_log_is_immutable() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted (Phase 0 §14)', TG_OP;
END;
$$;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION kubi_audit_log_is_immutable();

-- ---------------------------------------------------------------------------
-- Invariant 2: SYSTEM_ADMINISTRATOR can never hold a CLINICAL or
-- SAFETY_OVERRIDE-class permission (owner control 8; Phase 0 §09).
--
-- Enforced in TypeScript at role-definition validation time already
-- (ROLES_DENIED_CLINICAL_AUTHORITY in packages/contracts) — this trigger is
-- the database-level backstop so the invariant holds even if a future
-- migration or admin script writes role_permissions directly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kubi_forbid_admin_clinical_grant() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  role_code   text;
  perm_class  text;
BEGIN
  SELECT code INTO role_code FROM roles WHERE id = NEW.role_id;
  SELECT class INTO perm_class FROM permissions WHERE id = NEW.permission_id;

  IF role_code = 'SYSTEM_ADMINISTRATOR' AND perm_class IN ('CLINICAL', 'SAFETY_OVERRIDE') THEN
    RAISE EXCEPTION
      'Refused: SYSTEM_ADMINISTRATOR may never hold a % permission (owner control 8, Phase 0 §09). Grant clinical authority is a distinct axis, never implied by an administrative role.',
      perm_class;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER role_permissions_forbid_admin_clinical
  BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION kubi_forbid_admin_clinical_grant();

-- ---------------------------------------------------------------------------
-- Invariant 3: BREAK_GLASS-class permissions may never be granted to a
-- standing role at all — the ONLY route to them is a break_glass_grants row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kubi_forbid_standing_break_glass_grant() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  perm_class text;
BEGIN
  SELECT class INTO perm_class FROM permissions WHERE id = NEW.permission_id;
  IF perm_class = 'BREAK_GLASS' THEN
    RAISE EXCEPTION
      'Refused: BREAK_GLASS-class permissions cannot be held by a standing role. Use break_glass_grants (time-boxed, reason-required, audited).';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER role_permissions_forbid_break_glass
  BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION kubi_forbid_standing_break_glass_grant();

-- ---------------------------------------------------------------------------
-- Guard: kubi_app must never acquire BYPASSRLS (mirrors 0002_rls.sql).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not hold BYPASSRLS';
  END IF;
END $$;
