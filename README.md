# KuBi

A clinic operating system for KB Dental. Modular monolith, TypeScript end to
end, PostgreSQL with row-level security.

KuBi exists to move a clinic from *memory-dependent* to *exception-managed*.
Rather than asking "what does the staff have to remember?", it asks "what
should the system know, trigger, prevent, verify and escalate?"

## The operating loop

Everything in KuBi travels one loop, and the last stage is the one that makes
it a loop rather than a line:

```
PLAN → TRIGGER → ASSIGN → EXECUTE → PROVE → VERIFY → ESCALATE → MEASURE → IMPROVE
```

Without IMPROVE, a clinic detects the same failure every day and files it
identically every day. Every activity therefore carries a CAPA requirement
deciding whether a failure must produce an incident — and an incident cannot
close until its preventive action has been *proven effective*, not merely
carried out.

## What is built

| Area | State |
|---|---|
| Identity, RBAC, seven authority axes | Built |
| Tenant isolation (RLS, two-level, no `BYPASSRLS` on the app role) | Built |
| Activity engine — 22-field definitions, 7 states, 5 evidence classes | Built |
| Opening, closing and handover | Built |
| Appointments and patient flow | Built |
| Exception engine and risk-weighted escalation | Built |
| Scheduler — the clinic generates its own day | Built |
| KPI layer — 16 control parameters → operational health | Built |
| CAPA — incident → containment → root cause → corrective + preventive → effectiveness | Built |
| Clinical readiness, consent, procedure gates | Built |
| Follow-up engine with structured response and red-flag escalation | Built |
| Sterilization batches, lab cases, inventory, implants, equipment | **Not built** |
| Training/competency, complaints, audits | **Not built** |

Four of the six automation engines the requirements specify are not yet built:
Equipment, Inventory, and the procedure-specific parts of Compliance. Time,
Exception and the first of Patient Event are in place.

## Try it

`docs/kubi-try-it.html` is a single self-contained file — open it in any
browser, no install and no network. Switch person from the menu at the top
right; the demo runs the same rules the server does, including the ones that
refuse things.

`docs/kubi-parameters.html` documents all 16 control parameters and the 101
activities behind them. It is *generated* from the frozen requirements
workbook rather than hand-written, so it cannot drift from the source.

## Quick start

```bash
pnpm install
docker compose up -d                 # see docs/operations/phase-1-deviations.md
cp .env.example .env
sudo -u postgres psql -f scripts/db-init/01-roles.sql   # DBA provisioning
pnpm exec prisma migrate deploy
pnpm exec prisma generate

pnpm test                            # unit
pnpm test:ui                         # component
pnpm test:integration                # needs a database; resets it first
pnpm test:all                        # all three
pnpm verify:app                      # builds the demo and drives it in a browser
```

The integration suite truncates and re-seeds `kubi_test` before running. It
refuses to touch a database whose name does not contain `test`.

## Where the rules live

- `CLAUDE.md` — non-negotiables and architectural constraints. Read first.
- `docs/requirements/` — the source documents, committed. Every claim about a
  requirement is checkable here rather than recalled.
- `docs/requirements/conformance.md` — what the documents ask for versus what
  exists, checked against the code.
- `docs/adr/` — architecture decision records.
- `docs/design-principle.md` — the owner's design principle, which governs
  every screen.

## Data

Synthetic only. No production data or credentials in any non-production
environment, ever — demo records are prefixed `SYNTHETIC` so a screenshot can
never be mistaken for a real patient.
