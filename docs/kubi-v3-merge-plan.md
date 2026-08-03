# KuBi v3 — Merge Plan

Step 1 of the two-step refactor. No code is merged until this is agreed.

Sources, both copied into `docs/requirements/prototypes/` so they survive the
container:

| | File | Size |
|---|---|---|
| **#1** | `prototype-1-kubi-demo.html` (`KuBi_DEMO.html`) | 134 KB, 1 668 lines, hand-written |
| **#2** | `prototype-2-kubi-tryit-6.html` (`kubitryit_6.html`) | 355 KB, minified bundle |

---

## 0. Three facts that change the brief

**0.1 — Prototype #2 is this repository.** It is not a separate prototype. It
is a production build of `apps/web` at commit `3201aa4` ("Lab cases, and the
crown delivery gate"), one commit behind current `HEAD`. Proof: it contains the
lab string `failed its check and is being remade` (from
`apps/api/src/domains/operations/lab.service.ts`) and it still has the `MIS`
tab that `HEAD` deleted.

Consequences:

- Requirement 9 — "refactor into reusable React components rather than a
  monolithic HTML file" — is already met on the #2 side. #2 *is* 16 React
  screen components, an api layer, an icon set and a demo backend. The
  monolith is #1.
- Requirement 6 — "redesign Home as an Operations Command Center, not a KPI
  dashboard" — is already done, in commit `282ad32`, one commit *after* the
  build you are holding. The copy of #2 you have still shows the old MIS tab
  and the old shared dashboard.
- The merge is therefore not symmetric. It is: **carry the genuinely unique
  assets of #1 into the repo**, and build the four things neither prototype
  has.

**0.2 — Two features are attributed to the wrong prototype in the brief.** The
brief asks to take "bilingual support" and the "embedded parameter/activity
model" from #2. Both are in **#1**:

| Feature | #1 | #2 |
|---|---|---|
| English / हिंदी | 70-key `T` table, `setLang`, `localStorage`, per-task `titleHi`, `data-t` attributes | none at all |
| Parameter dictionary (`P_META`) | 17 heads with control scope, "rolls into", KPI name lists | parameter **enum ids** only |
| Activity dictionary (`A_ROWS`) | 136 rows / 119 distinct activities, 15 columns each | none client-side; seeded server-side from the frozen TSV |
| Design system, responsive shell, components | — | yes |

Corrected instruction: **#2 is the foundation for shell, design system,
components, data model and business rules. #1 is the source for the bilingual
string table, the client-side dictionary, and the role-briefing model.**

**0.3 — #1's dictionary is our own matrix, already forked once.** #1 embeds 119
distinct activity IDs. The repo holds 101 frozen activities in
`master-activity-matrix-v2.tsv` plus 18 `DECISION_REQUIRED` proposals in
`matrix-v3-proposals.tsv`. 101 + 18 = 119, and the ID sets match exactly
(`ATT-001`…`CLS-006` marked `defined`; `HK-001`…`HK-014`, `RCR-001`…`RCR-004`
marked `proposed`). #1 is a hand-copy of the same source with the frozen and
the proposed rows flattened together. That is one source of truth maintained in
two places, which is how they drift.

---

## 1. Features only in HTML #1

Grouped by whether they survive the merge.

### 1A — Keep, port into the repo

| Feature | Where it lives in #1 | Why it matters |
|---|---|---|
| **Bilingual EN / हिंदी** | `T`, `t()`, `setLang()`, `data-t`, `titleHi` | Housekeeping and assistant staff. Nothing else in KuBi addresses them. |
| **Role briefing model** | `kubi.briefing` → `sections[]` with `label`, `tone`, `hint`, `count`, `items[]` where each item is `kind:"task"` (actionable) or a **fact** (read-only) | The single best idea in either prototype. A flat task list can say "11 things due"; a briefing can say "three sterilization batches unfinished" and "Mr Bose's crown passed QC and nobody has rung him". This is the shape all six dashboards should take. |
| **Blocked-task lock** | `blockedBy` → 🔒 chip, tap opens "waiting for STER-003" | Explains the dependency instead of failing silently at submit. |
| **Photo evidence capture** | `capturePhoto`, `webcam`, `filePick`, `shrink` (resize to 1000 px, JPEG q 0.62) | The repo has evidence *classes* and no way to attach anything. See conflict C8 — this is not a component move. |
| **Reading / value evidence input** | task sheet `needsValue` | Autoclave temperature, AC setpoint. |
| **Not-applicable with a mandatory reason** | `act(taskId,{act:"na",note:why})` | Needed — but not in this form. See C7. |
| **Undo on a settled task** | `data-x="undo"` | Mis-tap recovery. Currently a dead end in #2. |
| **Parameters screen with a per-parameter live/off switch** | `vParams`, `data-live` | Staged rollout: "switch a parameter on only once the previous one is being ticked honestly". Directly serves the 71 activities seeded DISABLED. |
| **Parameter detail sheet** | `openParam` — control text, KPI chips, 9-column activity table | This is requirement 8's "embedded activity dictionary", and it only exists here. |
| **Reports** | `vReports` — period segmented control (today / 7 d / 30 d), compliance-by-parameter bars, compliance-by-person bars, exception log | Requirement 7's Reports screen. Does not exist in #2 in any form. |
| **Escalation level chips (L1/L2/L3)** | exception rows | Table 4 of the Word source. #2 has the requirement and not the field. |
| **Exceptions grouped by risk class** | `vExc` — PATIENT_SAFETY / CRITICAL / IMPORTANT / ROUTINE | Better ordering than #2's flat Attention list. |
| **Acknowledge on an exception** | `data-ack` | Distinct from resolve: someone has *seen* it. |
| **Sheet dismissal by ×, Escape and backdrop** | `sheet()`, global keydown | #1 fixed a real bug here (long sheet, Cancel below the fold, app looks frozen). Keep the fix. |
| **Demo persona switcher** | top bar, 6 roles | The way this gets reviewed. See C11 for how it must be rebuilt. |

### 1B — Do not port

| Feature | Reason |
|---|---|
| Google Apps Script transport (`POST {action, token, session}` to a `/exec` URL) | Superseded by REST + RLS. See C1. |
| "Server settings" sheet (paste an `/exec` URL and `OPS_TOKEN`) | A bearer token in `localStorage`, entered by hand. Contradicts the session-cookie model and non-negotiable 3. |
| Phone + PIN sign-in | Right idea, wrong layer — needs a server auth change, not a merge. Logged as follow-up. |
| Clinic Operational Score ring (91 %) + 9 management-score KPI grid **on the home screen** | Survives as a *report*, not as Home. See C2. |
| `BRIEF.owner = BRIEF.manager` | The owner is literally shown the manager's screen. This is the exact mistake called out in the dashboard brief. |
| Hand-maintained `A_ROWS` / `P_META` literals | Generate from the frozen TSV instead. See C5. |
| `new Date()` in `todayStr()` / `daysAgo()` | Lint-blocked. See C9. |
| `prompt()` for the N/A reason | Blocking browser dialog; use a sheet. |

---

## 2. Features only in HTML #2

All of these stay. Listed so nothing is lost by accident during the refactor.

**Platform and rules**
- Fastify + PostgreSQL with two-level row-level security (org + clinic), `FORCE ROW LEVEL SECURITY`, no `BYPASSRLS`.
- Five-valued `EvaluationResult` (PASS / FAIL / NOT_APPLICABLE / UNKNOWN / NOT_CONFIGURED), the `ENFORCEMENT_MATRIX`, and BLOCK_HARD gates with no override path.
- Cookie sessions, permission-checked routes, seven authority axes.
- `demo-backend.ts` — a fetch interceptor that mirrors the server rules exactly, so the browsable build cannot demonstrate something the server would refuse.

**Screens** (16 React components)
- `task-sheet` — per-item checklist, responses, taps/duration telemetry, override reason, report-a-problem.
- `checks` — verification with PASS/FAIL + comment; server refuses self-verification.
- `attention` — resolve with a note, audited.
- `quality` — the full CAPA lifecycle: incident → contain → investigate (root cause) → corrective/preventive actions → implement → effectiveness → EFFECTIVE **or loop back** → close.
- `patients` — readiness evaluation (consent, implant available, sterile kit, emergency ready), start-procedure gate, override with reason, follow-ups with pain/swelling/bleeding/medication and red-flag detection.
- `operations` — equipment daily check (FAIL ⇒ asset OUT_OF_SERVICE + breakdown + PATIENT_SAFETY exception), return-to-service, PM generation; inventory with expiry excluded from available stock, per-component implant readiness; sterilization batch stages.
- Lab cases — dispatch, receipt, QC PASS/FAIL, remake, and the delivery gate that refuses to book a crown appointment.
- `clinic` — schedule board with appointment status transitions.
- `handover` — end-of-day, fetched on demand.
- `command-centre` — the six questions, capped at five cards, zero charts.
- `owner-business` — including the explicit "not yet answerable" list that names the missing module for each of the nine metrics KuBi cannot source.
- `reception-board`, `today`, `entry`, `current-task`, `sign-in`, `me`.

**Design and shell**
- CSS custom-property token set; 56 px tap target; `env(safe-area-inset-*)`; tabular numerals.
- Responsive: fixed bottom tab bar below 900 px, 252 px sidebar at and above.
- SVG icon set; `aria-current`, count-aware `aria-label`, `role="img"` on the ring.
- Tabs appear only when they have something behind them ("an empty tab is a small daily lie about what this person's job is").

---

## 3. Duplicate features — which implementation to keep

| # | Duplicate | Keep | Why |
|---|---|---|---|
| D1 | App shell + navigation | **#2** | #1 builds nav by string concatenation into `innerHTML`. #2 is a typed `<Tab>` component with badges and a11y. |
| D2 | Role → navigation mapping | **#1's table, inside #2's component** | #1's `ROLE_NAV` maps 25 role strings onto 3 nav sets and already covers doctor, lab_coordinator, housekeeping. #2 hard-codes `isOwner / isManager / isReception` inline — it cannot reach 7 dashboards without a table. |
| D3 | Home screen | **#2 `CommandCentre`** | #1's `vDash` is a KPI dashboard with a 91 % score and nine meters. Requirement 6 and your own brief rule it out. #1's grid survives as a Report. |
| D4 | Today / my work | **#2 shell + #1 section model** | #2's `Today` renders a flat list. #1's briefing carries sections with tone and hint, and mixes tasks with read-only facts. Merge the model into the component. |
| D5 | Task completion | **#2 `TaskSheetScreen`** | #2 has per-item checklists, override reasons and problem reporting, all server-enforced. Port #1's photo, reading, N/A and undo into it. |
| D6 | Verification | **#2 `Checks`** | Same job as #1's Verify tab, but the separation-of-duties rule is enforced server-side. Adopt #1's one-tap Verify button and the tab badge. |
| D7 | Exceptions vs Attention | **#2 `Attention`** | #2 has resolve + audit trail. Adopt #1's grouping by risk class, the escalation-level chip and Acknowledge. |
| D8 | Progress ring | **#2** | #2's has `role="img"` and an aria-label and shows `112 of 147`, not a percentage. #1's prints "91 %". Parameterise #2's for reuse. |
| D9 | Empty states | **#2** | "Nobody else booked today" is not "0 patients", and the difference matters at four in the afternoon. |
| D10 | Sign-in | **#2** | Cookie session over email/password. #1's phone + PIN is the better answer for floor staff — logged as a follow-up requiring a server change. |
| D11 | Toasts / sheets | **#2 shell, #1 dismissal behaviour** | Keep the ×, Escape and backdrop exits #1 added. |
| D12 | Parameter list | **#1's screen, #2's data** | #1 renders the list beautifully from a hard-coded literal. Render #1's layout from #2's seeded data. |

---

## 4. Conflicts

Ranked. C1–C6 need your decision or at least your assent; C7–C11 are engineering consequences I will handle unless you say otherwise.

### C1 — Backend contract

#1 speaks one POST endpoint with an `action` field; #2 speaks REST over
`/api/v1/*` with cookie sessions and RLS. Not reconcilable — #2 wins. The
mapping, and what is missing:

| #1 action | #2 route | Status |
|---|---|---|
| `login`, `logout`, `me` | `/auth/*` | exists |
| `kubi.briefing` | `/my-day` | exists, but returns a flat list, not sections |
| `v2.today` | `/my-day` | exists |
| `v2.act` | `/tasks/:id/complete` | exists |
| `v2.verifyQueue` | `/checks` | exists |
| `v2.exceptions` | `/attention` | exists, no escalation level |
| `kubi.scoreboard` | — | **missing** |
| `v2.health` | — | **missing** (per-person compliance) |
| `v2.parameters` (live toggle) | — | **missing** |
| `uploadPhoto` | — | **missing** (see C8) |

Four new endpoints, not four merges.

### C2 — Percentages vs traffic lights

#1's home screen is percentages: a 91 % clinic score, nine meters, bands at
≥95 green / ≥85 amber. #2's command centre had every percentage deliberately
removed on your instruction, keeping one ring because `112 of 147` is a real
fraction of a real denominator.

**Proposed resolution:** lights on every dashboard; percentages exist only
under Reports. If you want the clinic score back on Home, say so — it is a
one-line change, but it reverses your own brief.

### C3 — UNKNOWN vs NOT_CONFIGURED

The sharp one. #1's `band()` returns `"grey"` for a null percentage and shows
the parameter as "off". That collapses two different things:

- **NOT_CONFIGURED** — nobody has built this evaluator yet.
- **UNKNOWN** — we should know and we do not. A data problem.

`AP-1` / `ADR-013` requires them distinct and requires that neither ever
renders as PASS. Porting #1's grey wholesale would silently break it.

**Proposed resolution:** NOT_CONFIGURED renders as a grey "off" chip;
UNKNOWN renders amber with the reason attached, the way the team lights on the
command centre already do ("Attendance is not recorded yet — no check-in
module").

### C4 — 16 parameters or 17

#1 ships 17 in `P_ORDER` while its own comment says 16, and the 17th
(`CLOSING_FACILITY`) carries `rollsInto: ""` and a note admitting it is not a
control head but a moment in the day. The repo has 16, with `PARAMETER_OF`
mapping 17 execution groups onto them.

**Proposed resolution:** 16 control parameters. Closing is a day-phase view.
17 must not leak into the merged UI.

### C5 — Two copies of the activity dictionary

As established in §0.3, #1's 119 rows are the repo's 101 frozen + 18 proposed,
hand-copied with different wording and the frozen/proposed distinction flattened
into a `status` string.

**Proposed resolution:** the TSV is the source. The client dictionary is
**generated at build time** from `master-activity-matrix-v2.tsv`, never
hand-maintained. Proposals render visibly as proposals and stay unswitchable
until their `DECISION_REQUIRED` fields are filled. Any #1 row with no TSV
counterpart goes to the v3.0 proposal register, not into the app.

### C6 — The seven roles

| Role | #1 | #2 | Merged plan |
|---|---|---|---|
| Owner | briefing, but `BRIEF.owner = BRIEF.manager` | `OwnerBusiness` | #2, unchanged |
| Clinic Manager | full briefing | `CommandCentre` | #2 shell + #1's section richness |
| Reception | full briefing | `ReceptionBoard` | #2 + #1's complaints and review-request sections |
| Dental Assistant | full briefing (opening → patients → sterilization → lab → closing) | — | **build**, from #1's model |
| Doctor | full briefing (patients, medical alerts, consent, documentation, lab QC, follow-ups) | — | **build**, from #1's model |
| Lab | — | all the lab *data* exists; `LAB_COORDINATOR` role exists | **build** — no prototype to copy, but the domain is there |
| **Rider** | — | — | **cannot be built** |

**Rider is a decision, not a screen.** There is no `RIDER` role code, no
permission, no table, no activity anywhere in the frozen matrix, and no data.
Building it means inventing a domain — what a rider is dispatched with, who
dispatches, what proves delivery, what happens when a case does not arrive.
Three questions I need answered before any of it is real:

1. What does a rider actually carry — lab cases only, or also inventory and equipment for service?
2. Is the rider an employee with a login, or a third party who receives a link?
3. What is the evidence of a handover — a signature, a photo, a scan, or a phone confirmation from the far end?

Everything else in the seven can be delivered; this one I will leave out and
say so, rather than ship a placeholder screen.

### C7 — Task state vocabulary and "Not applicable"

#1 uses `due | notdue | inprogress | done | verified | overdue | exception | na`.
In #1, a doer asserts `na` with free text and the task settles. Under ADR-013,
`NOT_APPLICABLE` requires a *positive rule* and cannot be asserted by the person
doing the work — otherwise the standard has a hole in it that anyone can walk
through on a bad afternoon.

**Proposed resolution:** keep the button. It raises a NOT_APPLICABLE **claim**
that goes to the checker. It does not settle the task.

### C8 — Evidence storage does not exist

#1 captures a photo and POSTs a data URL. #2 has evidence *classes*
(CONFIRMATION / VALUE / ATTACHMENT / VERIFICATION / SYSTEM) in the matrix and
nowhere to put an attachment. Porting the camera needs: an object store, a
photo table, RLS on that table, a retention rule, and a decision about
patient-adjacent images. That is a work package, not a component move, and I
will scope it separately rather than let it hide inside the merge.

### C9 — Clock

#1 calls `new Date()` in `todayStr()` and `daysAgo()`. The repo lints that out
and requires the injected `Clock` port. Ported code gets rewritten, not copied.

### C10 — Escalation levels

#1 renders L1/L2/L3. The requirement (Word Table 4) is in the repo; the field
on the attention row is not. Needs a migration, not a chip.

### C11 — Demo persona switching

#1's demo bar rewrites `S.user.role` in the browser. In the merged app the
switcher must go through `demo-backend.ts`, so a persona cannot be handed an
authority the real server would refuse. Otherwise the demo teaches the wrong
thing about what each role can do.

---

## 5. What "merged" will look like

```
apps/web/src/
  app/            shell, nav, the role → navigation table (from #1's ROLE_NAV)
  components/     Ring, Light, Card, Sheet, EmptyState, Toast, Bar, Chip, Table, Section
  dashboards/     owner, manager, reception, assistant, doctor, lab
  screens/        today, task-sheet, checks, attention, patients, operations,
                  quality, clinic, handover, me
  secondary/      parameters, activities, reports, admin
  dictionary/     generated from master-activity-matrix-v2.tsv at build time
  i18n/           en.ts, hi.ts, useT()   (strings from #1)
  api/
```

One note on requirement 7 — "move Parameters, Activities, Reports and
Administration into secondary navigation". Only Parameters and Reports exist
today, both in #1; Activities lives inside #1's parameter sheet; Administration
exists in neither prototype. So that requirement is three-quarters *build* and
one-quarter *move*, and Administration needs its own scope conversation (users,
roles, clinics, permissions, the parameter switch, the correction register).

## 6. Order of work, once approved

1. Role → navigation table; six dashboards on the briefing/section model (Rider excluded, pending C6).
2. Briefing sections and facts into `Today` and every dashboard.
3. Generated dictionary; Parameters and Activities under secondary nav.
4. Reports: by parameter, by person, exception log, period control.
5. i18n scaffolding + the EN/HI strings.
6. Attention: risk grouping, escalation level, acknowledge.
7. Task sheet: reading input, N/A claim, undo.
8. Photo evidence — scoped separately (C8).

## 7. What I need from you

1. **C2** — lights on Home and percentages only in Reports? Or do you want the clinic score back on Home?
2. **C6** — the three Rider questions.
3. Anything in §1B you disagree with dropping.

Everything else I will resolve as proposed above.
