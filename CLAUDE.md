# KuBi — working agreement

KuBi is a clinic operations, clinical workflow, quality and management operating
system. Its loop is:
STANDARD → TRIGGER → ASSIGN → EXECUTE → EVIDENCE → VERIFY → PASS/FAIL →
EXCEPTION → ESCALATION → CORRECTION → CAPA → KPI → IMPROVEMENT.

## Non-negotiables

1. **UNKNOWN is never PASS.** All control evaluation returns the five-valued
   `EvaluationResult`. `NOT_APPLICABLE` requires a positive rule; absence of
   information is `UNKNOWN`. See ADR-013.
2. **BLOCK_HARD gates have no override path.** Enforced by the absence of a
   permission, not a runtime check. See ADR-004.
3. **Server-side enforcement only.** A UI check is a courtesy. Every rule,
   authorization and state transition is enforced server-side.
4. **Never silently resolve an open Owner Decision.** Registers carry
   provenance; a `DECISION_REQUIRED` row carries no value. The seed loader
   throws if one does.
5. **Authority has seven distinct axes** — user, employee, role, permission,
   clinical authority, record relation, functional assignment. Never collapse
   them. System Administrator never gains clinical authority.
6. **Synthetic data only.** No production data or credentials in any
   non-production environment, ever.

## The design principle (owner, VS-01 review)

> KuBi should feel less like completing tasks and more like running a clinic.
> Every screen should reinforce where the clinic is in its day, not just what
> an individual needs to click next.

Design against "what does Priya do between 9:00 and 10:00?", never "which
screen does Priya open?". Say where the clinic is before what one person owes;
put the current work in front of them rather than a menu; make every remaining
tap mean something. Never imply a state you do not have — no opening set is not
"ready", and absent appointment data is not a guessed first-patient time.
See docs/design-principle.md.

## Architectural constraints

- **Every tenant-scoped query runs inside `prisma.$transaction`.** RLS context
  is transaction-scoped; a query outside a transaction returns zero rows by
  design. Do not "fix" this by widening policies. See ADR-008.
- **No `new Date()` / `Date.now()`.** Inject the `Clock` port. Enforced by lint.
- **No `delete`.** Master data is archived; transactional and clinical data is
  cancelled or superseded.
- **Matrix v2.0 is frozen.** Corrections queue for v3.0; see the Phase 0.5
  correction register.

## Layout

- `apps/api` — modular monolith. `platform/` engines know nothing of dentistry;
  `domains/` own their tables and never cross-import.
- `packages/contracts` — the single enum/DTO source for every tier.
- `prisma/seed/` — registers as reviewable, provenance-carrying seed data.
- `tests/safety-gates/` — reviewed like production code. Failure blocks release.
