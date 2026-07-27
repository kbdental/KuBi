-- KuBi — Phase 1 Step 6: two-level (organization + clinic) row-level security.
--
-- ADR-003: every tenant-scoped table carries organization_id and clinic_id.
-- RLS is the defence-in-depth layer that survives an ORM bug or a hand-written
-- reporting query. It is deliberately redundant with the repository-layer guard.
--
-- FAIL-CLOSED DESIGN: the context accessors below return NULL / empty when the
-- session variable is unset. A NULL comparison yields NULL, which the policy
-- treats as false, so an unscoped connection sees ZERO rows rather than all
-- rows. This is the single most important property in this file.

-- ---------------------------------------------------------------------------
-- Context accessors
-- ---------------------------------------------------------------------------

-- Current organisation for the transaction. NULL when unset.
CREATE OR REPLACE FUNCTION kubi_current_org() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('kubi.org_id', true), '')::uuid
$$;

-- Clinics in scope for the transaction. Empty array when unset.
CREATE OR REPLACE FUNCTION kubi_current_clinics() RETURNS uuid[]
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('kubi.clinic_ids', true), '') = ''
      THEN ARRAY[]::uuid[]
    ELSE string_to_array(current_setting('kubi.clinic_ids', true), ',')::uuid[]
  END
$$;

-- Whether the caller holds an organisation-wide grant (e.g. patient:view_all_clinics).
-- Defaults to FALSE when unset — the restrictive default.
CREATE OR REPLACE FUNCTION kubi_cross_clinic() RETURNS boolean
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(NULLIF(current_setting('kubi.cross_clinic', true), ''), 'false')::boolean
$$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
-- FORCE so that even the table owner is subject to policy. Without this, the
-- migrator role would silently bypass RLS and the spike would prove nothing.
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON organizations
  USING (id = kubi_current_org())
  WITH CHECK (id = kubi_current_org());

-- ---------------------------------------------------------------------------
-- clinics — organisation-scoped
-- ---------------------------------------------------------------------------
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics FORCE ROW LEVEL SECURITY;

CREATE POLICY clinic_org_isolation ON clinics
  USING (organization_id = kubi_current_org())
  WITH CHECK (organization_id = kubi_current_org());

-- ---------------------------------------------------------------------------
-- patients — TWO-LEVEL.
--
-- ADR-002 makes patient identity organisation-wide, but clinic visibility is a
-- permission rather than a free-for-all. So the policy is:
--   organisation must match, AND
--   (caller holds the org-wide grant  OR  the patient's clinic is in scope)
--
-- This is the row that exercises both tenancy levels, which is why it is the
-- spike fixture.
-- ---------------------------------------------------------------------------
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;

CREATE POLICY patient_two_level_isolation ON patients
  USING (
    organization_id = kubi_current_org()
    AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics()))
  )
  WITH CHECK (
    organization_id = kubi_current_org()
    AND (kubi_cross_clinic() OR clinic_id = ANY (kubi_current_clinics()))
  );

-- ---------------------------------------------------------------------------
-- Least privilege for the application role.
--
-- kubi_app holds NO DDL and NO DELETE. Phase 0 §19: master data is archived,
-- transactional and clinical data is cancelled or superseded — never deleted.
-- Migrations run under kubi_migrator in a separate step.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO kubi_app;
GRANT SELECT, INSERT, UPDATE ON organizations, clinics, patients TO kubi_app;
GRANT EXECUTE ON FUNCTION kubi_current_org()     TO kubi_app;
GRANT EXECUTE ON FUNCTION kubi_current_clinics() TO kubi_app;
GRANT EXECUTE ON FUNCTION kubi_cross_clinic()    TO kubi_app;

-- Explicitly deny the destructive verbs so a future GRANT ALL cannot creep in.
REVOKE DELETE, TRUNCATE ON organizations, clinics, patients FROM kubi_app;

-- Guard: the application role must never acquire BYPASSRLS. Asserted here so a
-- mistaken ALTER ROLE surfaces as a failed migration rather than a silent hole.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not hold BYPASSRLS';
  END IF;
END $$;
