# KuBi — Product Vision

The reference point for every architectural decision. When a proposal and this
document disagree, this document wins or it gets amended deliberately — it does
not get quietly ignored.

Status: draft for owner approval. Version 1.1, 3 August 2026.

---

## 0. The answer to the only question a buyer asks

> **"Why should I buy KuBi instead of another clinic management system?"**

> ## Every other clinic system records what you did.
> ## KuBi runs your clinic to a standard — and proves it.

The thirty-second version, for a room:

> That proof becomes a grade. Bronze, Silver, Gold, Platinum, Accredited.
> Earned from what your clinic actually does every day, not from a form you
> fill in once a year. Your staff work to it, your patients can see it, and
> you finally know whether your clinic is genuinely good or just busy.

Everything below this line — domains, registries, contracts, evaluation states,
the whole architecture — exists to make those three sentences true. None of it
may replace them. If a feature cannot be traced back to "runs your clinic to a
standard, and proves it", it is somebody's good idea and not this product's.

---

## 1. What is KuBi?

**KuBi is a clinic operating system: the standard, the work that proves it, and
the loop that improves it.**

Three things in one sentence, and the order matters.

- **The standard** — what "done properly" means at this clinic, written down,
  versioned, and owned by somebody. Not folklore. Not whatever the senior
  assistant happens to do.
- **The work** — the standard turned into today's actual tasks, assigned to
  actual people, with evidence attached and a second pair of eyes where the risk
  warrants one.
- **The loop** — when the standard is not met, KuBi notices, escalates, finds
  the cause, plans an action, and then comes back later to ask whether the
  action worked. If it did not, it goes round again.

What KuBi is **not**:

- Not practice-management software. Appointments and billing are things it will
  need, not the reason it exists. A dozen products do those better today.
- Not a checklist app. A checklist records that a box was ticked. KuBi holds a
  standard that the tick is measured against, and refuses to accept a tick that
  cannot be true.
- Not a dashboard. A dashboard tells you how you did. KuBi tells somebody what
  to do, now, and then tells you whether they did it.

The test: if every screen were switched off tomorrow, would the clinic run
differently? For a dashboard, no. For KuBi, yes — that is the whole point.

## 2. Who is it for?

**Primary: everybody who works a shift.** Owner, clinic head, manager,
reception, doctor, senior and dental assistants, housekeeping, lab and inventory
coordinators, and in time riders and maintenance.

This is the unusual claim and the one that shapes the most design decisions.
Most clinic software is bought by an owner and used by a receptionist; everyone
else is a row in a report. In KuBi the housekeeper is a user with a screen, and
that is why the app is bilingual and why a task is two taps and why nothing
important is behind a hover.

**Buyer: the owner-operator.** A dentist who owns one clinic or a small group,
works chairside part of the week, and cannot personally stand over every
sterilization cycle.

**Shape of the customer:** 5–50 staff, one to six clinics, mixed literacy and
mixed English. K.B. Dental first, and honestly — building for one real clinic
with real riders and a real autoclave beats building for an imaginary average.

**Explicitly not for, yet:** hospital chains with an existing quality
department and an ISO auditor on staff; single-chair practices where the dentist
is the only employee and the loop is just their own memory.

## 3. What problems does it solve?

Five, in the order they hurt.

**3.1 — The standard lives in somebody's head, so the clinic varies by who is
on shift.** The good assistant sets the room one way; the new one guesses. The
owner finds out when a patient does. KuBi makes the standard explicit, published
and versioned, so the answer to "how should this be done" is a document and not
a person's mood.

**3.2 — Nobody can prove what happened yesterday.** Was the autoclave cycle run?
Was the consent taken before the drill started, or written up afterwards? Today
the answer is a memory and a signature on a form nobody reads. KuBi holds
evidence at the moment of the work, with the person, the time and the reading
attached.

**3.3 — Problems repeat, because nothing closes the loop.** The same instrument
shortage, the same lab delay, the same patient kept waiting. Somebody is told
off, something is promised, and three weeks later it happens again. KuBi runs
incident → containment → root cause → corrective and preventive action →
**effectiveness check** → closure, and an action that did not work goes back
round instead of being marked done.

**3.4 — The owner finds out too late.** By the time it shows up in the month's
numbers, the patient has already left a review. KuBi surfaces the thing that is
wrong today, to the person who can fix it today.

**3.5 — Software that measures instead of operating.** Every practice tool
produces reports. Almost none of them will stop a crown being booked for a
patient whose case failed QC and is being remade. KuBi will, and does.

## 4. What makes it different?

Seven claims. Each one is a thing a competitor would have to rebuild their
product to match, not a feature they could add in a sprint.

**4.1 — It runs the day; it does not report on it.** The home screen answers
"what needs me now", never "how are we doing". Reporting exists, and lives
somewhere else on purpose.

**4.2 — UNKNOWN is never PASS.** Evaluation is five-valued: PASS, FAIL,
NOT_APPLICABLE, UNKNOWN, NOT_CONFIGURED. Absence of information is UNKNOWN and
shows as UNKNOWN. "Not applicable" requires a positive rule, not somebody's
opinion on a busy afternoon. Most systems have a boolean and a default, and the
default is green.

**4.3 — Every task traces to a published clause, with provenance.** 101 frozen
activities, each with a standard, trigger, due rule, doer, checker, evidence
class, risk class and CAPA requirement — and a record of where the rule came
from. An activity whose due rule nobody has decided ships **disabled**, not
guessed.

**4.4 — Hard gates cannot be overridden.** A BLOCK_HARD gate has no override
path — enforced by the absence of a permission, not by a runtime check somebody
can be persuaded to add a flag to. There is no "manager approves anyway" button
on patient safety.

**4.5 — The loop actually closes.** CAPA with a real effectiveness verification
that can send an action back to the start. Most quality modules stop at "action
recorded".

**4.6 — A dashboard is a question, not a filtered list.** The owner and the
manager do not see the same screen with different permissions. They see
different applications, because they are asking different questions.

**4.7 — It is built for the floor.** Bilingual English and हिंदी, 56 px tap
targets, two taps to complete a task, works on the phone in an apron pocket.
The assistant is a user, not a data source.

## 5. Core principles

Every future feature must respect all ten. A proposal that breaks one is not a
trade-off to weigh; it is a proposal to redesign.

1. **One question per screen.** If a screen answers two questions it is two
   screens. If it answers none it is a report.

2. **Never imply a state you do not have.** No opening set is not "ready".
   Absent appointment data is not a guessed first-patient time. Zero payments
   outstanding is not the same as no billing module — and KuBi says which.

3. **Say the gap out loud.** Where KuBi cannot answer, it names what is missing
   and what would answer it. A blank prompts a question; an invented figure
   ends one.

4. **One source of truth, everything generated.** The activity matrix is
   authored once. The seed, the client dictionary, the parameter screens and
   the reports are all generated from it. Nothing is hand-copied — a hand-copy
   is a fork with a delay fuse.

5. **Enforcement is server-side.** A UI check is a courtesy. Every rule,
   authorisation and state transition is enforced on the server, and the demo
   build mirrors the server rules exactly so it cannot teach a lie.

6. **Authority has seven axes** — user, employee, role, permission, clinical
   authority, record relation, functional assignment. Never collapse them. A
   system administrator never acquires clinical authority.

7. **Evidence over assertion.** Where the risk warrants it, the claim needs a
   reading, a photo or a second person. The person who did the work is not the
   person who verifies it.

8. **Never silently resolve an open decision.** A register row marked
   DECISION_REQUIRED carries no value, and the loader throws rather than
   inventing one. An unmade decision stays visible until somebody makes it.

9. **Extension without redesign.** A new domain, dashboard or role is a
   registration, not a refactor. If adding HR means editing the shell, the
   architecture was wrong.

10. **Synthetic data only outside production.** No production data or
    credentials in any non-production environment, ever.

## 6. The layer stack

Added at the owner's review of 3 August. The architecture had three layers;
it needs six. Two of them are the commercial answer in §0, and neither is an
operational view.

```
Business narrative        why anyone buys it
  └─ Maturity Model       what "good" means, and how a clinic proves it
      └─ Domains          who owns what
          └─ Dashboards   one question each
```

Crossing all four:

```
Intelligence Layer        Measure → Predict → Recommend → Act
Knowledge Layer           Procedure → Checklist → Complication → CAPA → Lesson
```

### 6.1 Maturity Model — the missing layer

**Bronze → Silver → Gold → Platinum → Accredited KuBi Clinic.** Every parameter
contributes to certification.

This is the commercial expression of the parameter spine, and it is what turns
a compliance product into something a clinic *wants* rather than tolerates. It
gives the owner a goal, the manager a scoreboard that is not a stick, and the
practice something to put on the wall.

Three design constraints, recorded now because getting them wrong destroys the
whole idea:

1. **Earned from live compliance over a sustained window, never
   self-assessed.** The moment a grade can be claimed rather than computed, it
   is worthless — and every existing dental accreditation already fails here.
2. **A disabled parameter counts as not met, never as excluded.** This is the
   gaming vector: the per-parameter live/off switch exists so a clinic can
   adopt honestly one head at a time, and it would otherwise let a clinic reach
   Gold by switching off everything it fails. Adoption breadth is itself part
   of the grade.
3. **A grade can go down.** A certification that only ratchets upward is a
   participation trophy.

### 6.2 Intelligence Layer

Today KuBi is Measure → Show → Act. It should be **Measure → Predict →
Recommend → Act**.

> "Sterilization compliance has fallen for 12 days. A new assistant joined on
> day 3, and their training is overdue."

Three constraints:

1. **Evidence-linked, and falsifiable.** A recommendation shows the facts it
   was built from and can be told "not this" — which is itself a signal.
2. **Never present correlation as cause.** Principle 2 applies with full
   force: state the observation and the proposed link separately, in those
   words. "Likely cause" is a claim; "these two things coincide" is a fact.
3. **A recommendation is a CAPA candidate, not a notification.** It ends in
   somebody deciding, or it is noise with a nicer font.

### 6.3 Knowledge Layer

**Procedure → Checklist → Complication → CAPA → Lesson.** Not storing
incidents — accumulating institutional knowledge. Eventually: *clinics using
protocol A reduced failures by 32%.*

This is the one layer that nobody in this market is building, and it is also
the only part of KuBi that **must read across tenants** — which puts it in
direct tension with row-level security being the entire isolation model. It
therefore needs, from the start and not retrofitted:

- a separate aggregate-only path, physically distinct from the tenant query
  path, that cannot return a row;
- no patient identifiers of any kind crossing a clinic boundary, ever;
- a minimum cohort size before any cross-clinic figure is computed;
- explicit clinic opt-in, revocable.

Get this wrong once and the product is finished. It is worth building the wall
before there is anything to put behind it.

## 7. Roadmap

Owner's roadmap, adopted. Note that phases 2 and 3 add **no features** — that
is the point of them.

| Phase | What | Success looks like |
|---|---|---|
| **1 — Build** | Complete the v3 merge on the approved architecture | Six dashboards live; one source of truth; standards primary |
| **2 — Pilot** | Run KuBi at K.B. Dental for 2–3 months | We know what staff *use* versus what they ignore — measured, not guessed |
| **3 — First external clinic** | Onboard one clinic outside K.B. | Deployment, training and support work without the author in the room |
| **4 — Refinement** | Real-world feedback; then Relationship, Learning, predictive intelligence | The core proved itself before we extended it |

The order within phase 1 is deliberate: **operations first, because a clinic
that cannot prove it sterilised an instrument has no business measuring its
marketing ROI.**

And the discipline in phases 2–3 is the harder half. A product that keeps
adding domains is avoiding the question of whether anyone uses the ones it has.

## 7. How this document is used

- A merge plan, an ADR or a screen design cites the principle it serves.
- A proposal that breaks a principle names it and argues for amending this
  document first.
- Amendments are dated and attributed. This is a register, not a mood board.
