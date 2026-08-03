# KuBi — Engineering Constitution

Ten rules. Not guidelines, not preferences, not "unless we're in a hurry".

A rule here is one that has already cost us something, or would cost us
everything. Each says what it means, how it is **enforced** — because a rule
enforced only by remembering is a rule you have already broken — and, where
there is one, the failure that put it here.

Changing a rule requires the owner's assent and a dated amendment. Working
around one silently is the only thing on this page that counts as misconduct.

Adopted 3 August 2026.

---

## 1. Never fake data

No invented figure, ever, anywhere a person might read it as real. Not as a
placeholder, not as a "reasonable default", not to make a screen look finished
in a review.

Where KuBi cannot source something, it says so and names what would answer it.
A blank prompts a question; an invented number ends one.

**Enforced by:** all demo and seed records carry a `SYNTHETIC ` prefix on any
human-readable label. The owner dashboard renders nine unanswerable metrics as
`—` with the missing module named, rather than as plausible figures.

**Why it is here:** it would have been trivial to show the owner a revenue
number. Nobody would have caught it, and every decision made on it afterwards
would have been wrong.

## 2. UNKNOWN is never PASS

Control evaluation is five-valued: `PASS`, `FAIL`, `NOT_APPLICABLE`,
`UNKNOWN`, `NOT_CONFIGURED`. Absence of information is `UNKNOWN` and renders as
`UNKNOWN`. `NOT_APPLICABLE` requires a positive rule — it is never the opinion
of the person doing the work on a busy afternoon.

`UNKNOWN` and `NOT_CONFIGURED` are distinct and stay distinct: one is a data
problem, the other an evaluator nobody has built.

**Enforced by:** `tests/safety-gates/`, the `ENFORCEMENT_MATRIX`, and ADR-013.
A safety-gate failure blocks release.

## 3. No placeholder screens

A screen either works or does not exist. A registered dashboard that is not
`LIVE` has no render function — not an empty one, not a "coming soon" one.

**Enforced by:** `registerDashboard()` throws if a non-`LIVE` dashboard carries
a render function, and throws if a `LIVE` one does not. Startup, not runtime.

## 4. One source of truth

The activity matrix is authored once. The seed, the client dictionary, the
parameter screens and the reports are all **generated** from it. Nothing is
hand-copied.

**Enforced by:** generation at build time from
`docs/requirements/master-activity-matrix-v2.tsv`. A hand-maintained copy is
rejected in review.

**Why it is here:** prototype #1 embedded 119 activities by hand. They were our
own 101 frozen rows plus the 18 open proposals, flattened together and reworded,
with the frozen/proposed distinction lost. One source maintained in two places
had already drifted before anybody noticed.

## 5. Every task traces to a standard

No task exists without an activity; no activity without a published clause with
provenance, a doer, a risk class and a due rule. An activity whose due rule
nobody has decided ships **disabled** — never guessed.

**Enforced by:** the seed loader throws on a `DECISION_REQUIRED` row carrying a
value. 71 activities are currently seeded `DISABLED` with
`provenance: 'UNRESOLVED'` rather than given a plausible schedule.

## 6. No production secrets in development

No production data or credentials in any non-production environment, ever. No
exceptions for "just to test the import", and no bearer tokens pasted into
`localStorage`.

**Enforced by:** synthetic fixtures only; the demo backend has no credential
path. This is also why prototype #1's "paste your `/exec` URL and `OPS_TOKEN`"
settings sheet was dropped rather than ported.

## 7. Every deployment must be reversible

A migration that cannot be rolled back is a decision that cannot be unmade.
Data-destructive migrations are refused; `delete` is not used — master data is
archived, clinical and transactional data cancelled or superseded.

**Enforced by:** the no-`delete` rule in review; forward-only migrations that
add before they remove.

**Why it is here:** migrations are **not** atomic in this database. A failed run
was observed leaving its added column behind. Statement ordering is the only
thing keeping a table from being left unforced — see migration 0012.

## 8. Every new dashboard must be registry-driven

A dashboard is a registration: an id, a question, an audience, a phase, a
status. The shell contains no role names and no `if (isOwner)`. If adding a
dashboard requires editing `app.tsx`, the contract has failed and **the contract
is what gets fixed** — not the shell.

Every dashboard states the one question it answers, in the words the person
would use. A screen answering two questions is two screens; one answering none
is a report.

**Enforced by:** `apps/web/src/app/registry.ts` and
`tests/ui/dashboard-registry.test.tsx`. Duplicate ids are refused at startup.

## 9. Every feature must map back to the Product Vision

A feature cites the principle it serves. One that cannot be traced to *"runs
your clinic to a standard, and proves it"* is somebody's good idea and not this
product's.

A proposal that breaks a vision principle names it and argues for amending the
vision **first**. It does not proceed on the quiet.

**Enforced by:** review. `docs/product-vision.md` is the reference point;
`docs/requirements/conformance.md` maps requirement to code.

## 10. No feature without an owner, and no gap without a reason

Every domain, dashboard and open decision has a named owner and a stated status.
Anything unbuilt says what it is waiting for, in the product — not only in a
roadmap.

**Enforced by:** `registerDashboard()` throws if a non-`LIVE` dashboard does not
say what it is blocked by. Registers carry provenance; `DECISION_REQUIRED` rows
carry no value.

**Why it is here:** Patient Experience went unnoticed through an entire design
pass. Its KPIs were already in the frozen matrix — complaint capture,
acknowledgement time, resolution time, closure — while the objects they measure
did not exist. **The standard was written and the thing it measures was never
built**, and nothing in the system was obliged to say so.

---

## Amendments

| Date | Rule | Change | Approved by |
|---|---|---|---|
| 2026-08-03 | — | Adopted, ten rules | Owner |
