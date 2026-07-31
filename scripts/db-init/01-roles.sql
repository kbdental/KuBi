-- Least-privilege roles. Phase 1 Step 4 / Phase 0 §19.
-- kubi_migrator owns the schema and runs migrations.
-- kubi_app is the runtime role: no DDL, no DELETE, no BYPASSRLS.
CREATE ROLE kubi_app LOGIN PASSWORD 'devapp';
CREATE DATABASE kubi_test OWNER kubi_migrator;

-- Login lookup role. Authentication must find a user BEFORE a tenancy context
-- exists, and `users` is FORCE RLS (which binds the table owner too). This
-- role owns exactly one SECURITY DEFINER function returning four columns, and
-- can do nothing else. Created here rather than in a migration because role
-- creation requires CREATEROLE -- a DBA provisioning concern, not a schema one.
CREATE ROLE kubi_authlookup NOLOGIN BYPASSRLS;
-- The migrator must be a member of kubi_authlookup to transfer ownership of
-- the login-lookup function to it during migration 0008.
GRANT kubi_authlookup TO kubi_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO kubi_authlookup;

-- Tenant-list role. The daily scheduler has the same shape of problem as
-- login: to generate every clinic's morning it must first know which clinics
-- exist, and it cannot scope to an organisation it has not yet identified.
-- Same answer, deliberately: its own role owning exactly one SECURITY DEFINER
-- function that returns three non-sensitive columns (organisation, clinic,
-- timezone) for active clinics, and nothing else. A separate role from
-- kubi_authlookup on purpose — the property worth keeping is that each of
-- these roles has exactly one capability, and merging them would end that.
CREATE ROLE kubi_tenantlist NOLOGIN BYPASSRLS;
GRANT kubi_tenantlist TO kubi_migrator;
GRANT USAGE, CREATE ON SCHEMA public TO kubi_tenantlist;
