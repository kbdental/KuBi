-- Login bootstrapping: authentication must find a user BEFORE a tenancy
-- context exists (you cannot scope to an organisation you have not yet
-- identified). `users` is RLS-protected by organisation, so an unscoped
-- lookup correctly returns zero rows.
--
-- Rather than widening the policy or handing the app migrator credentials,
-- expose exactly the four columns authentication needs through a
-- SECURITY DEFINER function. It returns no profile data, no employee link,
-- no roles -- only enough to verify a password and establish which
-- organisation to scope the rest of the session to.
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

REVOKE ALL ON FUNCTION kubi_lookup_user_for_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kubi_lookup_user_for_login(text) TO kubi_app;
