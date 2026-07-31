-- The daily scheduler needs to know which clinics exist before it can generate
-- anything, and it cannot scope to an organisation it has not yet identified —
-- the same shape of problem migration 0008 solved for login, and solved the
-- same way rather than by inventing a second mechanism.
--
-- `clinics` and `organizations` are FORCE ROW LEVEL SECURITY, which binds the
-- table owner too, so a plain query from kubi_migrator or kubi_app returns
-- zero rows by design. Rather than weaken that, this gives the enumeration its
-- own role owning exactly one function returning three non-sensitive columns.
--
-- What this deliberately does NOT do: return clinic names, addresses, or any
-- column a caller could use to learn something about a tenant it has no
-- business knowing. Three identifiers and a timezone is everything a scheduler
-- needs to compute "is it a working day here, and what time is it".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_tenantlist') THEN
    RAISE EXCEPTION 'Role kubi_tenantlist is missing. Run scripts/db-init/01-roles.sql as a superuser first.';
  END IF;
END $$;

GRANT SELECT (id, organization_id, timezone, status) ON clinics TO kubi_tenantlist;

CREATE OR REPLACE FUNCTION kubi_list_active_clinics()
RETURNS TABLE (organization_id uuid, clinic_id uuid, timezone text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.organization_id, c.id, c.timezone
  FROM clinics c
  WHERE c.status = 'ACTIVE'
  ORDER BY c.organization_id, c.id
$$;

ALTER FUNCTION kubi_list_active_clinics() OWNER TO kubi_tenantlist;
REVOKE ALL ON FUNCTION kubi_list_active_clinics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kubi_list_active_clinics() TO kubi_app;

-- Re-assert the invariant that matters, on every migration that touches this
-- area: the APPLICATION role never bypasses RLS. The narrow function is the
-- only reason kubi_app can see across tenants at all.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not hold BYPASSRLS';
  END IF;
END $$;
