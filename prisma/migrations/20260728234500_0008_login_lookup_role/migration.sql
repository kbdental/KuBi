-- Migration 0007 created a SECURITY DEFINER login-lookup function owned by
-- kubi_migrator. That does not work, and the reason is worth recording:
-- `users` is declared FORCE ROW LEVEL SECURITY, which subjects the TABLE
-- OWNER to policy as well. The function therefore ran as the owner, still hit
-- the org-isolation policy, found no org context, and correctly returned zero
-- rows -- making login impossible.
--
-- Authentication genuinely requires a cross-organisation read: you cannot
-- scope to an organisation you have not yet identified. Rather than weaken
-- FORCE RLS on `users` (which would expose every column to any owner-context
-- query), we give that one lookup its own role whose entire capability is
-- that one function returning four columns.
--
-- kubi_authlookup can do nothing else: no table grants beyond the SELECT the
-- function needs, no DDL, no login. kubi_app still holds no BYPASSRLS.
-- The role itself is created by DBA provisioning (scripts/db-init/01-roles.sql),
-- not here: CREATE ROLE requires CREATEROLE, which the migrator deliberately
-- does not hold. Fail loudly rather than silently leaving login broken.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_authlookup') THEN
    RAISE EXCEPTION 'Role kubi_authlookup is missing. Run scripts/db-init/01-roles.sql as a superuser first.';
  END IF;
END $$;

-- USAGE on schema public is granted by DBA provisioning (superuser-only).
GRANT SELECT (id, organization_id, password_hash, status) ON users TO kubi_authlookup;

CREATE OR REPLACE FUNCTION kubi_lookup_user_for_login(p_email text)
RETURNS TABLE (id uuid, organization_id uuid, password_hash text, status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.id, u.organization_id, u.password_hash, u.status
  FROM users u
  WHERE u.email = p_email
  LIMIT 1
$$;

ALTER FUNCTION kubi_lookup_user_for_login(text) OWNER TO kubi_authlookup;
REVOKE ALL ON FUNCTION kubi_lookup_user_for_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kubi_lookup_user_for_login(text) TO kubi_app;

-- Re-assert the invariant that matters: the APPLICATION role never bypasses RLS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubi_app' AND rolbypassrls) THEN
    RAISE EXCEPTION 'kubi_app must not hold BYPASSRLS';
  END IF;
END $$;
