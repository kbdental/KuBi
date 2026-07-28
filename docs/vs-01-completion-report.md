# VS-01 Completion Report — Clinic Opening

Prepared for owner review. Synthetic data only throughout; no production or
patient data was used at any point.

---

## 1. Scope delivered

The first vertical slice: a clinic opens in the morning, and the system carries
that from a schedule to finished, checked work — with problems routed to the
person who can fix them.

Five opening activities (OPN-001…005), normalised from frozen Matrix v2.0:

| Code | On screen | Assigned to | Checked by | Self-check allowed |
|---|---|---|---|---|
| OPN-001 | Open the clinic | Reception / Assistant | Clinic Manager | No |
| OPN-002 | Get treatment rooms ready | Dental Assistant | Senior Assistant | No |
| OPN-003 | Set up reception | Reception | — | Yes (OD-02) |
| OPN-004 | Set up the clinic environment | Dental Assistant | — | Yes (OD-21) |
| OPN-005 | Check the emergency kit | Dental Assistant | Clinic Manager | No |

Delivered end to end: scheduling → assignment → checklist → evidence →
verification → problem → attention → escalation → resolution.

---

## 2. What a person actually does

Priya signs in. "Open the clinic" is already waiting — no navigation, no
searching, no choosing. She opens it (1 tap), ticks five items (5 taps),
presses Finish (1 tap). She is told before she starts that someone else will
confirm it, and that she does not have to find them.

On the emergency kit she sees "We can't confirm the emergency kit list yet".
She presses Report a problem, picks "Not working", and stops there. The task
goes on hold rather than failing, and the problem is already with Rahul.

---

## 3. Measured tap counts

Counted by instrumentation during the journey test, not estimated:

```
Priya (assistant):        18
Rahul (manager):           3
Anita (senior assistant):  3
TOTAL                     24
```

Completing one five-item checklist costs 7 taps: open + 5 ticks + finish.

---

## 4. The five user surfaces

| Surface | Built | Notes |
|---|---|---|
| Sign in | Yes | Two fields, one button |
| Today | Yes | Lands on the work; zero navigation to the first task |
| Do this | Yes | Checklist, Finish, Report a problem always visible |
| Attention | Yes | Worst first; answers all five questions per row |
| Checks | Yes | Tab hidden entirely when nothing is waiting |

Captures of each, taken from the running app, are in `docs/screens/`.

---

## 5. Architecture as built

TypeScript monorepo (pnpm), Node 22.22.2, PostgreSQL 16.13, Prisma 7.9.0 with
`@prisma/adapter-pg`, Fastify API, React 19 + Vite client.

- API: 19 files, ~2,530 lines
- Web: 9 files, ~1,290 lines
- 27 tables, 25 under `FORCE ROW LEVEL SECURITY`, 25 RLS policies, 10 triggers
- 70 permissions seeded across 13 canonical roles
- 9 migrations

---

## 6. Two-level tenancy and RLS

Organization and clinic isolation are enforced by database policy, not by
application `where` clauses. `FORCE ROW LEVEL SECURITY` binds the table owner
too, so the migrator is not an escape hatch. `kubi_app` holds no `BYPASSRLS`,
and migration 0008 re-asserts that at migration time — it fails loudly rather
than drifting.

Proven under connection pooling: context does not leak across pool checkouts,
concurrent tenant contexts stay isolated, cross-tenant writes are refused, and
a query with no context returns zero rows by design.

---

## 7. TD-4 — centralized RLS context enforcement

`AsyncLocalStorage` in `rls-context.ts` makes it impossible to run a
tenant-scoped query without a context: `withTenantContext` / `withSystemContext`
are the only doors, and an unscoped query throws `MissingTenancyContextError`
rather than silently returning nothing.

The first implementation used a `WeakSet` to mark transaction clients and was
wrong — `Prisma.defineExtension((client) => …)` captures the base client at
definition time, so the mark never matched the per-transaction instance. The
comment explaining that is preserved in the source, because the bug is easy to
reintroduce.

---

## 8. AP-1 — UNKNOWN never becomes PASS

`EvaluationResult` is five-valued. `ENFORCEMENT_MATRIX` maps
[EnforcementMode][EvaluationResult] → GateDecision, and no path yields PROCEED
for `UNKNOWN` or `NOT_CONFIGURED` under any mode. Composite gates resolve
worst-member-wins, and an empty member set is `NOT_CONFIGURED`, never PASS.

Staff never see any of these words. `NOT_CONFIGURED` on the emergency
requirement reaches the screen as **"We can't confirm the emergency kit list
yet"**.

**This was found to be display-only during this slice and has been fixed — see
§16.**

---

## 9. Authorization

Seven authority axes kept distinct: user, employee, role, permission, clinical
authority, record relation, functional assignment.

Authorization is by record relation, not role alone: holding
`activity_instance:complete` does not let you complete someone else's task.
Proven through the HTTP API — Priya calling Reception's task directly gets 403,
and Anita verifying an activity whose checker is the Clinic Manager gets 403.
Both refusals are server-side, with no UI involved.

Segregation of duties: the verifier cannot be the doer unless the activity is
on the OD-02 allowlist, and self-verification is recorded as such so it stays
visible in Verification Independence reporting.

---

## 10. Database-level invariants

Enforced by trigger, and verified against superuser sessions — not merely
against the application role:

1. Audit rows cannot be updated or deleted, by anyone.
2. `SYSTEM_ADMINISTRATOR` cannot hold CLINICAL or SAFETY_OVERRIDE permissions.
3. BREAK_GLASS permissions cannot be held by a standing role.

Evidence is append-only at two layers: the GRANT layer denies first, the
trigger denies behind it. Defence in depth, and the tests assert either.

---

## 11. Owner decisions honoured

- **OD-19** — 09:00, Mon–Sat; opening+15min carries
  `provenance: 'TEMPORARY_FALLBACK'` in the seed and has not been converted
  into business logic.
- **OD-20** — clinic-open status is `BLOCK_OVERRIDABLE`, seeded as clinic
  configuration by provisioning, not as a product constant.
- **OD-21** — OPN-004 is on the self-verification allowlist; the allowlist is
  the decision that no counter-check is needed, not a fallback for when nobody
  else is free. Out-of-range readings raise Attention but do not block.
- **OD-23** — escalation defaults are seeded as configuration rows and remain
  editable.
- **BLOCK_HARD** — structurally non-overridable: no permission grants it and no
  reason unlocks it.

---

## 12. Scheduling

Clinic-local and DST-aware via `Intl.DateTimeFormat` rather than fixed offsets.
Generation is idempotent through a unique constraint on
`(definitionId, scopeKey, periodKey)` — re-running creates nothing. Every
scheduler run is recorded in `automation_execution`, including no-ops, so
"nothing happened" is distinguishable from "nothing ran".

---

## 13. PHI safety

Logging is allowlist-based: unknown fields are dropped rather than passed
through, the denylist wins over the allowlist, nested structures are recursed,
and `Error` objects are redacted to type only. No patient identifiers or
clinical content can reach a log by default.

---

## 14. Test coverage

**86 tests, all passing.**

| Suite | Tests | Covers |
|---|---|---|
| Unit | 27 | AP-1, enforcement matrix, authority separation, PHI redaction |
| UI | 14 | Rendered screen text and behaviour |
| Integration | 45 | RLS, TD-4, Phase 2 foundation, opening engine, HTTP journey |

The journey test drives the real HTTP API — login, cookies, authorization,
refusals — not the services directly.

The UI tests render each screen and read the visible text back, so engine
vocabulary written into a component is caught the same way it is in an API
response. The jargon matcher was itself checked against known-bad strings: it
catches the raw enum `PATIENT_SAFETY` while allowing the humanised "Patient
safety".

---

## 15. Language discipline

The internal five (WORK / CHECK / PROBLEM / FIX / IMPROVE) appear nowhere in
the product. Navigation is Today / Attention / Checks / Me. Tabs with nothing
behind them are hidden rather than shown empty.

Asserted, not merely intended: the journey test checks
`expect(JSON.stringify(sheet)).not.toMatch(/NOT_CONFIGURED|UNKNOWN/)`, and the
UI tests apply the same rule to rendered text.

---

## 16. Defects found and fixed during this slice

1. **Blocking gates were display-only.** `evaluateGate` was computed and
   returned to the screen as `cantConfirm`, but `completeTask` never called it.
   A direct POST finished a task whose gate said the clinic was not ready —
   which means a `NOT_CONFIGURED` emergency-readiness requirement was reading
   as PASS to anyone not using the browser, in direct contradiction of AP-1.
   Now enforced server-side: non-overridable gates refuse outright; overridable
   gates refuse unless a reason is recorded, and going ahead is audited as
   `GATE_OVERRIDDEN` *and* raised as Attention to the clinic manager, so an
   override is never quiet.

2. **Self-verification logic inverted.** Self-verified only when no other
   verifier existed, contradicting OD-21. Caught by test.

3. **Override headline was ungrammatical** — spliced out of the gate message,
   producing "Check the emergency kit was finished before the emergency kit
   list yet". Found by running the system, not by testing it. Rebuilt as a
   sentence.

4. **Today greeted people by `name.split(' ')[0]`**, which is wrong for a great
   many people and rendered as "SYNTHETIC". Removed rather than patched.

5. **Login was impossible under FORCE RLS.** Authentication needs a
   cross-organisation read before any organisation is known. Resolved with a
   dedicated `kubi_authlookup` role owning one function returning four columns,
   rather than by weakening RLS on `users`.

6. **Seed loader violated its own architecture** — attempted to write the
   permission catalogue through the app role, which holds SELECT-only. Moved to
   a migrator-privileged script.

---

## 17. Deviations from prior architecture

- **ADR-005 (NestJS) → Fastify.** VS-01 needs ~12 endpoints and NestJS's
  module/DI machinery is ceremony at that size. The property that justified
  NestJS is preserved: `authed()` is the only way to build a handler and
  resolves session, tenancy and permission before the handler runs, so an
  endpoint cannot forget to authorize. Reversible — the services are
  framework-agnostic.
- **New: ADR-015** records the web client stack, which no prior ADR covered.

---

## 18. Technical debt carried

- **TD-11** — technical/clinical audit-stream split deferred;
  `SYSTEM_ADMINISTRATOR` is withheld `audit_log:view_all_clinics` entirely as
  an interim approximation of OD-04.
- Permission catalogue is the ~70-permission foundation subset, not the full
  Phase 0.5 catalogue of 171. Seeding permissions for tables that do not exist
  would be metadata theatre. The rest lands module by module.
- The two VS-01 gate requirements have no backing module, so they evaluate
  `NOT_CONFIGURED` by design. That is correct behaviour today, not a stub.
- No refresh-token rotation exercised in the UI; access token is 15 minutes.

---

## 19. PostgreSQL 17 gate — NOT RUN

**Status: BLOCKED, not skipped.**

P-3 requires the RLS gate to be re-run on PostgreSQL 17 before Phase 2 is
production-ready. It has not been run. This environment has PostgreSQL 16.13
natively; Docker Hub and `apt.postgresql.org` are both denied by the network
policy (403 at the proxy), so a PostgreSQL 17 instance cannot be obtained here.

All RLS results in this report are from PostgreSQL 16.13. The gate remains
open and must be run before production.

---

## 20. Repository state

Four commits on `claude/new-project-ti3ywp`. No remote is configured — per the
owner's instruction to keep GitHub off the critical path — so the work is
committed locally and unpushed.

No secrets, credentials, `.env` files, dumps or database artefacts are
committed. `.env` is git-ignored and was verified as such.

---

## 21. How to run it

```bash
docker compose up -d
pnpm prisma migrate deploy
pnpm dev:api      # http://127.0.0.1:3000
pnpm dev:web      # http://127.0.0.1:5173
pnpm test:all     # 86 tests
```

---

## 22. Honest assessment

What is genuinely solid: tenancy isolation, authorization, the audit and
evidence guarantees, and the AP-1 discipline — all proven against the database
and through the real API rather than asserted in prose.

What is thin: this is one slice. There is no appointment integration (a hard
MVP requirement per the Simplicity Gate amendment, not yet started), no
closing/handover flow, no reporting, and no offline handling — a clinic tablet
on poor wifi will currently show an error rather than degrade gracefully.

The defect in §16.1 is the one worth dwelling on. Every other control in this
slice was proven server-side from the start; that one had been written to look
enforced while being enforced nowhere, and it survived until a UI was built on
top of it. It was found by asking "what makes this greyed-out button real?" —
which is now the standing rule for every surface (ADR-015).

---

## VS-01 STATUS: **PASS WITH ISSUES**

Passing: all 86 tests, every owner decision OD-19…OD-24 honoured, all
Phase 0.5 controls upheld, and the full journey demonstrated through the real
API and a real browser.

Issues, both disclosed above and neither silently carried:
1. The PostgreSQL 17 RLS gate (P-3) has not been run and cannot be run in this
   environment (§19).
2. Appointment integration, a hard MVP requirement, is not in this slice.

## USABILITY STATUS: **READY FOR OWNER DEMO**

The five surfaces run against a live API with synthetic data and have been
captured in `docs/screens/`. Opening the clinic costs 7 taps and zero
navigation. No internal vocabulary reaches any screen.

---

**Stopping here. VS-02 not started, per instruction.**
