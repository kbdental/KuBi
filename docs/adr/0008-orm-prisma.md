# ADR-008 — ORM: Prisma (confirmed by the Phase 1 RLS gate)

Status: Accepted · Owner decision D-08 · Verified Phase 1 Step 6

## Decision
Prisma 7.9 with the `@prisma/adapter-pg` driver adapter for application
queries; raw SQL for KPI and reporting.

## Gate evidence
The mandatory Step 6 gate (owner control 10) ran 10 assertions and passed all
10. Critically:
- T6 proved transaction-local context does NOT survive onto the next pool
  checkout on the same physical backend (verified by `pg_backend_pid()`).
- T8 proved `prisma.$transaction` carries RLS context via `set_config(..., true)`.
- T9 proved Prisma OUTSIDE a transaction fails closed (0 rows, not all rows).

Prisma 7 removed `url` from the schema datasource and requires a driver adapter.
This turned out to HELP: the adapter gives explicit control of the `pg` pool,
which is what makes the transaction-scoped context reliable.

## Constraint this places on all future code
RLS context is transaction-scoped. Therefore **every tenant-scoped query must
run inside `prisma.$transaction`**. A bare `prisma.model.findMany()` outside a
transaction returns zero rows by design (T9). This is a fail-closed default and
must not be "fixed" by widening the policies.
