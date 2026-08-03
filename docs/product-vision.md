# KuBi — Product Vision

The reference point for every architectural decision. When a proposal and this
document disagree, this document wins or it gets amended deliberately — it does
not get quietly ignored.

Status: draft for owner approval. Version 1.0, 3 August 2026.

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

## 6. What KuBi will grow into

Direction, not a commitment to dates. Detail lives in the dashboard strategy
and domain documents.

- **Now** — operations, clinical readiness, quality and the loop. Six
  dashboards.
- **Next** — inventory and maintenance as first-class dashboards; patient
  experience as a domain rather than a set of scattered fields.
- **Then** — the relationship layer: who the patient is, how they were reached,
  what was proposed and what they accepted. This unlocks business growth, and
  nothing in growth is real without it.
- **Later** — HR, accounts, marketing, rider, maintenance, and a multi-clinic
  view for a group.

The order is deliberate: **operations first, because a clinic that cannot prove
it sterilised an instrument has no business measuring its marketing ROI.**

## 7. How this document is used

- A merge plan, an ADR or a screen design cites the principle it serves.
- A proposal that breaks a principle names it and argues for amending this
  document first.
- Amendments are dated and attributed. This is a register, not a mood board.
