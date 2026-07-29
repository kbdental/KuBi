# VS-01 — Architecture and API Freeze

Status: **FROZEN** as of owner acceptance, VS-01 Functionally Complete
(Pre-Pilot).

Scope of this freeze: the VS-01 slice — clinic opening. It does not freeze the
product. New operational capabilities are built outside it, and this document
says where that boundary runs.

---

## 1. What is frozen

### 1.1 API surface (12 endpoints + health)

```
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/me

GET    /api/v1/my-day
GET    /api/v1/tasks/:id
POST   /api/v1/tasks/:id/start
POST   /api/v1/tasks/:id/complete
POST   /api/v1/tasks/:id/report-problem

GET    /api/v1/attention
POST   /api/v1/attention/:id/resolve

GET    /api/v1/checks
POST   /api/v1/checks/:id

GET    /health
```

Frozen means: no endpoint is added, removed or renamed; no request field is
added, removed or made required; no response field is removed, renamed, or has
its type or meaning changed.

### 1.2 Response shapes

The field sets returned by each endpoint, as consumed by `apps/web/src/api.ts`.
That file is the client-side statement of the contract and changes only when
the contract does.

### 1.3 Database schema

The 27 tables, their columns, the 25 RLS policies, the 10 triggers, and
migrations 0001–0009. Migrations are already immutable once applied; this
extends that to the shape they produce.

### 1.4 Domain semantics

- The five opening activities OPN-001…005 and their checklist items.
- Assignment and checker rules, and the OD-02/OD-21 self-verification
  allowlist.
- `EvaluationResult`, `EnforcementMode`, `GateDecision` and `ENFORCEMENT_MATRIX`.
- The seven authority axes.
- Problem kinds, severities, escalation defaults.

### 1.5 The controls

Two-level RLS, TD-4 context enforcement, AP-1, segregation of duties,
append-only audit and evidence, the three database invariants, and server-side
gate enforcement. These do not relax for any reason short of a defect.

---

## 2. What a defect fix is

Permitted under the freeze. A change is a **defect fix** when it makes the
system do what it was already specified and understood to do:

- A control that does not actually enforce what it claims (the §16.1 class of
  bug: enforced on screen, not on the server).
- A crash, hang, data-corruption or incorrect-result bug.
- A security or tenancy-isolation failure.
- Wording on screen that is wrong, misleading, or leaks internal vocabulary.
- A usability defect raised in owner review that is corrected **within the
  existing screens and the frozen API** — different words, different layout,
  different ordering, different emphasis.

A defect fix may change the web client freely. It may change server behaviour
only to make an existing rule real, never to add a rule.

---

## 3. What is functional expansion

Not permitted inside VS-01. A change is **expansion** when the system does
something it did not do before:

- A new endpoint, or a new field carrying new meaning.
- A new activity, checklist item, problem kind, severity or role.
- A new screen, or a new capability on an existing screen.
- Appointment integration, closing/handover, reporting, offline handling.
- Anything that changes what a person can accomplish.

These belong to the next capability, not to VS-01 — including good ideas that
surface during usability review. Those get recorded and carried forward, not
absorbed.

---

## 4. The grey area, decided in advance

Usability review will produce requests that sit between the two. The test:

> Does this change what the person can accomplish, or only how easily?

Only how easily → defect fix, do it now.
What they can accomplish → expansion, carry it to the next capability.

Worked examples:

| Request | Verdict |
|---|---|
| "Finish should be higher up the screen" | Fix |
| "'Report a problem' should say 'Something's wrong'" | Fix |
| "Show the time the task is due, not just 'Now'" | Fix — the field is already returned |
| "Let me add a photo to a problem" | Expansion — new evidence path |
| "Show me yesterday's opening" | Expansion — no history surface exists |
| "Let me reassign a task to someone else" | Expansion — new capability |

Where a request is genuinely ambiguous, it goes to the owner rather than being
resolved quietly in either direction.

---

## 5. Two issues carried, not closed

Both were disclosed at acceptance and remain open. Neither is discharged by
this freeze:

1. **PostgreSQL 17 RLS gate (P-3) not run.** Blocked by network policy in this
   environment, not skipped. All RLS evidence is from PostgreSQL 16.13. Must be
   run before production.
2. **Appointment integration** — a hard MVP requirement — is not in this slice.
   It is expansion, and belongs to a subsequent capability.

---

## 5a. Amendments made under this freeze

Usability review, round 1. Recorded here so the frozen surface is never
silently different from this document.

**Approved expansion (owner, explicitly):**

- `GET /api/v1/checks/:id` — new endpoint. The checker sees each checklist item
  as it was recorded. Approved on the grounds that it strengthens independent
  verification rather than adding business capability: confirming work without
  seeing what was claimed is a signature, not a check. Returns no names (Q6).
- `GET /api/v1/my-day` — added `opening: { total, done, complete } | null`, for
  the completion confirmation the owner asked for. Counts only. `null` means
  there is no opening set today and must never render as "the clinic is open".

**Behaviour changes inside the frozen surface:**

- `POST /api/v1/tasks/:id/complete` — overriding a blocking gate now requires
  `activity_instance:override_gate`, held by Owner/Director, Clinic Head,
  Clinical Director and Clinic Manager. No request or response field changed;
  `canOverride` now answers "can *you*", which is what the screen needed it to
  mean all along.
- New permission `activity_instance:override_gate` (71 in the catalogue).

**Display only:** severity labels are now Patient Safety / Needs Immediate
Action / Needs Attention / Routine. The underlying severities are unchanged.

**Open consequence of Q2 — awaiting owner decision.** OPN-005's doer is the
assigned assistant, and only the assignee may complete a task. The authority to
proceed without confirmation now sits with the manager. So no one can currently
finish that activity: the person who may decide cannot act, and the person who
may act cannot decide. It fails closed, which is the right direction, but
opening never reads as complete. Options put to the owner: (A) a manager
authorises the specific instance, then the assignee finishes it; (B) configure
emergency readiness as advisory until the inventory module lands; (C) leave it
visibly incomplete. **Not to be resolved without an answer** — working agreement
non-negotiable 4.

---

## 6. Change control

Any change to a frozen item requires: the defect stated plainly, the smallest
change that fixes it, a test that fails without the fix, and a note in the
changelog. Changes that are expansion are refused inside VS-01 and recorded for
the next cycle.

---

## 7. The cycle from here

1. **Usability review** — owner reviews the captured screens (`docs/screens/`,
   assembled for review with specific questions).
2. **Refine** — usability defects fixed within the frozen API. Expansion
   requests recorded, not built.
3. **Next capability** — begins only after usability feedback is incorporated,
   using the same build → review → refine cycle.
