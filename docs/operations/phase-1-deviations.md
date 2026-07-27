# Phase 1 deviations from the approved plan

## D-1 — Infrastructure run natively instead of via docker-compose (Step 4)

**What happened.** `docker pull postgres:17-alpine` returned
`403 Forbidden` from `production.cloudfront.docker.com`. The agent proxy README
(`/root/.ccr/README.md`) classifies a 403 as an organisation egress-policy
denial and directs that it be reported rather than routed around.

**What was done instead.** PostgreSQL and Redis were installed from the Ubuntu
archive (an allowed channel) and run as native services. Roles, databases,
migrations, RLS policies and every test were executed against that instance.

**Impact.** `docker-compose.yml` is written and committed but UNVERIFIED in this
environment. It must be validated on a machine with Docker Hub access before
being relied upon. Nothing else is affected — the RLS gate, integration suite
and restore drill all ran against a real PostgreSQL.

## D-2 — PostgreSQL 16.13 instead of 17 (Steps 4, 5, 6)

**Cause.** Consequence of D-1: Ubuntu 24.04 ships PostgreSQL 16.

**Assessment.** Every feature the Phase 1 gate depends on — `ENABLE`/`FORCE ROW
LEVEL SECURITY`, `current_setting(..., missing_ok)`, `set_config(..., is_local)`,
policy `USING`/`WITH CHECK`, `gen_random_uuid()` — is present and semantically
identical in 16 and 17. The gate result is therefore considered valid.

**Residual risk.** LOW, but the gate should be re-run on PostgreSQL 17 in CI
before Phase 2 merges. `.github/workflows/ci.yml` already pins
`postgres:17-alpine`, so this happens automatically on the first CI run in an
environment with registry access.

## D-3 — MinIO and Mailpit not started (Step 4)

**Cause.** Same 403. Neither is exercised by any Phase 1 step (no file upload
or email path exists yet), so nothing was skipped as a result.

## D-4 — Prisma 7 required schema and client changes not anticipated by the plan

**What happened.** Prisma 7.9 removed `url` from the schema `datasource` block
and requires a driver adapter on the client. The plan was written assuming
Prisma 6 conventions.

**Resolution.** Connection URL moved to `prisma.config.ts`; client constructed
with `@prisma/adapter-pg`. This proved beneficial for the RLS gate — the adapter
gives explicit control of the `pg` pool, which is what makes transaction-scoped
context reliable and testable.

## D-5 — Repository not created on GitHub (Step 1)

**Cause.** The approved plan names `kbdental/kubi`. This session's GitHub scope
is `kbdental/kb-management-suite` and `kbdental/kb-denarts`, and the designated
push branch is `claude/new-project-ti3ywp` in those repositories. Creating a new
repository is outward-facing and the target conflicts with the session's
configured scope.

**Status.** The repository exists locally with full git history and is ready to
push. Awaiting owner direction on destination — see Completion Report item P.
