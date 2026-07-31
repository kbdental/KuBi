# KuBi — Owner Review Pack

Covering VS-02 (appointments), VS-03 (closing and handover), and the KPI layer
built against the Operations App requirements you sent.

---

## 1. What was built

**VS-02 — the clinic knows where its day is.** Today's list in clinic words
(Expected / Waiting / In the chair / Finished / Cancelled / Didn't come), status
transitions enforced as a fixed table with finished terminal, cancellations that
always record a reason, and waiting time measured rather than estimated. When
the first patient is close and the clinic is not ready, KuBi says so without
being asked.

**VS-03 — closing the clinic, and what tomorrow inherits.** The end-of-day set
runs on the same engine as opening, anchored to the clinic's own configured
closing time. Two new phases, CLOSING and CLOSED. The handover screen states
what is being left behind in four lists: not done, waiting to be confirmed,
problems still open, patients not seen.

**The KPI layer — 16 control parameters, one operational score.** Your §7 and
the owner dashboard you drew twice. Every activity now belongs to one of the 16
parameters; parameters roll up into Operational Health; the screen shows the
ones that need action first, each saying why in one sentence, and folds away
the ones with nothing to measure.

**Four management outcomes.** GREEN / AMBER / RED / GREY, exactly as §8
specifies, with GREY meaning "nothing to measure" and never being averaged in.

Also in place from VS-01, unchanged: the 22-field activity record, seven task
states, five evidence classes, four-level responsibility (doer / checker /
owner / escalation), dependency gates, and the exception engine.

---

## 2. Screens

Open `kubi-try-it.html` in any browser — laptop or phone, no install, no
network. Switch person from the menu at the top right; that is how you see the
whole morning. **"Jump to closing"** winds the day forward so you can read the
handover without waiting eleven hours.

- **Priya (assistant)** — her morning, with the current task already open.
- **Anita (senior assistant)** — has real work of somebody else's to check.
- **Kavita (reception)** — runs the day's list.
- **Rahul (manager)** — the only one who sees Overview.

The demo's day is deliberately untidy. A day that ends clean proves nothing.

---

## 3. Real workflow walkthrough

1. Priya opens KuBi at 09:42. The header says where the clinic is: opening, 12
   minutes late, first patient at 09:55.
2. She works the environment checklist inline — no menu, no navigation.
3. She reaches **Check the emergency kit**. The list cannot be confirmed, so
   Finish refuses. She may not release it herself.
4. KuBi raises the ask with the manager. She is told not to chase him.
5. Rahul sees it on Attention, records why it is safe, and releases it — for
   that one task, for that one day.
6. Priya finishes. Because the activity needs a second pair of eyes, it is
   *completed*, not *confirmed* — and it does not move the readiness score.
7. Anita confirms it. Now it counts.
8. Kavita marks patients in and through. Waiting time starts itself.
9. At closing, Rahul reads the handover before locking up.

---

## 4. Decisions I made without asking

- **Parameters are a separate axis from processes.** Closing spans three
  parameters, so filing by process would have put two patient-safety controls
  under the wrong head and flattered the safety score.
- **Readiness means the opening set only.** Including tonight's checks would cap
  every morning in the low sixties with no way to recover.
- **A patient-safety problem forces its parameter red** regardless of the
  percentage. A number you can satisfy by ticking routine boxes is not a safety
  measure.
- **The handover is a read.** Nothing on it can be ticked — that would let
  somebody clear the list without clearing the clinic.
- **The handover is not a seventh tab.** It appears on Today when the day is
  ending, per your instruction to keep navigation small.
- **Overview is gated on clinic-wide permission.** An assistant has a day; a
  manager has a clinic.
- **Two stat cards removed** once the health block said the same thing.

---

## 5. Decisions that need you

**a. Where does KuBi's code live?** This is the urgent one. KuBi is currently a
local repository with **no remote** — the three commits from this session exist
only in this session's container. The two repositories I can reach
(`kb-management-suite`, `kb-denarts`) are different products. KuBi needs its own
repository, or an explicit decision to put it in one of those.

**b. Which parameter next?** Ten of the sixteen have no activities yet (§7
below). Lab, inventory and attendance are very different business value and I
should not pick for you.

**c. Nothing generates tasks in a running system.** The generators are built,
idempotent and tested, but only tests call them. A production scheduler has to
enumerate tenants, and this system deliberately has *no* ungoverned global
scope — so that needs a designed, reviewed mechanism rather than a quick loop.
It is the single thing standing between KuBi and running a real morning.

Still open from earlier: the 6-vs-5 taps question, "waiting too long" = 15
minutes, and whether an unready clinic escalates to you personally.

---

## 6. Defects found and fixed

All found by driving the built app in a real browser at 390 / 834 / 1440px.

| Defect | Why it mattered |
|---|---|
| Adding closing tasks made the clinic report "2 of 11 areas ready" all morning and never reach OPEN | Three separate places counted "today's activities" meaning "the morning" |
| The same bug warned "not ready for first patient" every single day | A warning that fires daily is one nobody reads |
| Severity pills derived their CSS class from the enum, producing `pill-patient-safety`, which matched no rule | PATIENT_SAFETY — the most serious level — rendered as plain unstyled text |
| The person menu burst out of the top bar at 390px | The bar clips rather than scrolls, so the page-width check could not see it |
| A migration's backfill silently updated zero rows | `FORCE ROW LEVEL SECURITY` binds the table owner; the migration died later, somewhere unrelated |
| Clinic name truncated to a single letter on a phone | — |
| Disabled Finish button read as broken rather than as not-yet | — |

Each now has a test or an assertion that fails if it comes back.
**150 tests pass**: 27 unit, 86 integration, 37 UI, plus a browser pass that
checks three widths for sideways scroll, sub-36px controls, unstyled severity
pills, top-bar overflow, and console errors.

---

## 7. Known limitations

**Ten of the sixteen parameters have no activities yet.** Built: opening
readiness, room & chair readiness, infection control (partial), safety &
emergency, appointments. Not built: attendance & leave, cleanliness,
maintenance & utilities, patient clinical journey (beyond arrival and waiting),
clinical documentation, surgery & high-risk protocols, follow-up & experience,
laboratory, inventory & implants, staff conduct, quality & CAPA.

**Four of your six engines are not built.** The Exception engine is done and the
Time engine's logic is done but unscheduled (5c above). The Patient Event,
Equipment, Inventory and procedure-specific Compliance engines do not exist yet.

**No notifications.** Exceptions surface in the app; nothing leaves it. Your
escalation ladder (L1 → L2 → L3) is modelled but only reaches people who open
KuBi.

**PostgreSQL 17 verification outstanding.** All RLS tests pass on 16.13; this
environment's network policy blocks obtaining 17, which is the production
target.

**The `.html` file is a demo, not the product.** The rules in it are a faithful
copy for clicking through; real enforcement is server-side and is what the
tests cover. A browser can always be lied to, which is exactly why the security
model is not in one.

---

## 8. Recommendation for the next capability

**Build the scheduler first (5c), then Laboratory (§12).**

The scheduler because nothing else matters until KuBi generates a morning on
its own — every capability built after it inherits the fix, and every day
without it is a day the app cannot actually run a clinic.

Then Laboratory, for three reasons: it is the parameter your own example
reaches for twice ("crown delivery appointment given before crown arrived"); it
is a genuine dependency chain — Received → QC Passed → appointment allowed —
which exercises the gate machinery on something with real money attached; and a
lab case has a lifecycle long enough that the exception engine earns its keep,
unlike a checklist that lives for one morning.

I would take Inventory (§13) after that, since reorder alerts and implant
component tracking feed the same surgical readiness gate.
