# ADR-003 — Two-level tenancy from commit one; no SaaS machinery

Status: Accepted · Owner decision D-03 (modified)

## Decision
Every tenant-scoped table carries BOTH `organization_id` and `clinic_id`. RLS
policies key on organisation first, clinic second. Roles, permissions, activity
definitions and KPI definitions are org-scoped.

Explicitly NOT built: subscription billing, self-service tenant onboarding,
tenant provisioning UI, per-tenant custom domains.

## Verification
Proven by the Phase 1 Step 6 gate, tests T1–T7, and retained as a standing
regression suite at `tests/integration/rls.test.ts`.

## Consequences
+ Multi-organisation SaaS becomes a commercial question, not a rewrite.
- One extra column and one extra RLS predicate everywhere.
