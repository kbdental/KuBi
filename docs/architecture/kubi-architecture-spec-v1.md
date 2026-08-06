# KuBi Architecture Specification v1.0

**A Clinic Decision Operating System**

| | |
|---|---|
| **Status** | **COMPLETE — awaiting owner acceptance.** No further sections will be added; see §18. |
| **Date** | 2026-08-06 |
| **Supersedes** | The event/workflow model in `packages/contracts/src/engine.ts` |
| **Authority** | The owner's brief of 2026-08-06 and the analysis that followed it |
| **Scope** | The operating model only. No UI is specified here and none should be built until this is frozen. |

---

## 0. How to read this

The owner asked for ten things. Here is where each one lives, so this can be
checked rather than trusted:

| Asked for | Section |
|---|---|
| 1. Core domain entities | §4 |
| 2. Events | §5 |
| 3. Workflows | §6 |
| 4. Ownership rules | §7 |
| 5. Decision rules | §12 |
| 6. Resource rules | §9 |
| 7. Escalation rules | §8.4 |
| 8. State transition rules | §6.3 |
| 9. APIs between engines | §17 |
| 10. Database / event-log schema | §16 |

Three conventions run throughout:

- **DECIDED** — settled, and implementable as written.
- **DECISION_REQUIRED** — the specification deliberately carries no value.
  Every one is listed in §17. None is guessed, and none may be filled in by
  whoever implements the section.
- **DERIVED** — computed, never stored. If something is marked DERIVED and you
  find a column for it, that is a defect.

---

## 1. The one architectural change

Everything in this document follows from a single sentence in the owner's
analysis:

> *KuBi should never be built around **Flows**. It should be built around
> **Decisions**.*

The previous model was correct and insufficient. It knew what had happened and
who held the work. It could not answer the question a person actually has at
09:12 on a Tuesday, which is not *"what is the next step"* but:

> **What decision has to be made right now, who makes it, do they have what
> they need, and what happens if they don't make it?**

So the centre of the system is not the workflow engine. It is a single
function:

```
decisions(world, now) → Decision[]
```

Every other engine exists to produce, evaluate, order or filter that list.
Every future screen renders a slice of it. Nothing in the UI computes anything.

```
                    ┌──────────────────────────┐
   events  ────────▶│                          │
   time    ────────▶│    DECISION ENGINE       │────▶  Decision[]
   resources ──────▶│                          │        ordered, owned,
   governance ─────▶│  decisions(world, now)   │        answerable
   capacity ───────▶│                          │
                    └──────────────────────────┘
                                 ▲
                        objectives order it
```

This is the difference between a workflow engine and an operating system. A
workflow engine says *"the next node is SEAT."* An operating system says
*"Meera has been waiting 16 minutes, chair 2 frees in 4, the assistant is
holding two other things, and if nobody moves in 2 minutes the manager is told."*

---

## 2. The constitution

### 2.1 Objectives — ordered, not listed

The owner's chain, and the order is the specification:

| # | Objective | Code | Means |
|---|---|---|---|
| 1 | Patient safe | `PATIENT_SAFE` | No unsafe treatment starts. Ever. |
| 2 | Patient happy | `PATIENT_HAPPY` | Nobody waits without a reason somebody knows. |
| 3 | Treatment successful | `TREATMENT_SUCCESSFUL` | The clinical work is done and done well. |
| 4 | Clinic efficient | `CLINIC_EFFICIENT` | Resources are used; nobody idles beside a queue. |
| 5 | Money collected | `MONEY_COLLECTED` | Work done is work paid for. |
| 6 | Records complete | `RECORDS_COMPLETE` | The note, the consent, the batch log, the audit trail. |
| 7 | Patient recalled | `PATIENT_RECALLED` | The relationship outlives the visit. |

**The order is executable.** It is not a mission statement — it is the
tie-breaker. When two decisions compete for the same person at the same
moment, the one serving the lower-numbered objective wins. That single rule
replaces every ad-hoc priority field, and it means the software's sense of
what matters is the owner's, written once.

> **Invariant O-1.** Every event contributes to at least one objective.
> An event serving none is either not worth recording or the objective list is
> incomplete. Enforced by test, not by review.

> **Invariant O-2.** Every decision names the objective it serves. A decision
> that cannot name one has no business on anybody's screen.

**DECISION_REQUIRED (D-01):** whether *Patient safe* may ever be traded
against *Patient happy*. The specification currently says no — a safety
decision always outranks a waiting-time decision, even at 40 minutes' wait.
That is a clinical policy call and it is the owner's.

### 2.2 Laws — the eight that hold before any code runs

The owner's operating principles. A law that cannot be checked continuously is
a slogan, so each is given the check that makes it a law. Two of them cannot be
checked as written, and that is stated rather than papered over.

| # | Law | Continuous check | Status |
|---|---|---|---|
| L-1 | Patient never waits unnecessarily | No `PATIENT` flow sits at `SEAT` past its expected time while a chair is `FREE` | DECIDED |
| L-2 | Treatment never starts unsafely | No `TREATMENT_FINISHED` admitted without history, consent and radiograph | DECIDED |
| L-3 | Sterilisation never bypassed | No `PATIENT_SEATED` admitted with zero batches in `RELEASED` today; no batch released by its own operator | DECIDED |
| L-4 | Money never missed | No `PATIENT` flow reaches `done` with an unsettled `BILLING` flow | DECIDED |
| L-5 | Lab never delayed | No `LAB` flow past expected return without an owner holding it | DECIDED |
| L-6 | Doctor never searches | Every decision carries the record it needs, by reference, at the moment it is offered | DECIDED |
| L-7 | Staff never guess | Every open decision has exactly one named owner and one stated next action | DECIDED |
| L-8 | Owner always knows | Every escalation reaches a named role; no alert is raised to nobody | DECIDED |

> **Laws are not warnings.** L-2 and L-3 are refusals: the event is not
> recorded. The rest are detections: the work is flagged, owned and escalated.
> The distinction matters — refusing to record a patient's arrival because a
> chair is busy would be absurd, and refusing to record an unsafe treatment is
> the entire point of the system.

**DECISION_REQUIRED (D-02):** whether L-4 blocks closing the day or merely
escalates. Blocking means a clinic cannot lock up with an unpaid bill, which
is defensible and inconvenient.

---

### 2.3 Design philosophy — the constraints that stop the drift

The owner asked for this section by name, and gave the reason: *"These
principles are not implementation details — they are architectural
constraints. They ensure that future development doesn't gradually drift back
toward a traditional dashboard or checklist application."*

That drift is not hypothetical. It happened three times in this project's first
week, each time by a small reasonable step. So each principle below is given
the **drift test** that detects the violation, because a principle nobody can
check is a principle that gets argued away at the fourth sprint.

| # | Principle | What it looks like when it has been violated |
|---|---|---|
| P-1 | Users never navigate a workflow; the engine moves work | A screen offers "next step", "advance", "move to…". Any control naming a workflow position. |
| P-2 | Users never search for information; the system presents it | A decision needs a record the screen did not already carry. A search box that is the only route to something. |
| P-3 | Users never decide ownership; ownership is derived | An assign, reassign, claim or hand-over control exists anywhere. |
| P-4 | Users never monitor compliance; governance runs silently | A compliance list, a requirements screen, a "checks" tab. Governance appears anywhere except a refusal. |
| P-5 | Every click corresponds to a real-world event | A control whose name is not a past-tense event a person could describe to a colleague. |
| P-6 | Every screen answers one question: what do I need to do now? | A screen whose title is a noun — Patients, Reports, Inventory — with no question under it. |
| P-7 | Every event produces measurable operational consequences | An event with an empty consequence list, or one contributing to no objective. |
| P-8 | Only decisions relevant to the current role are shown | Any role seeing a count, list or badge for work it neither holds nor is escalated. |

> **P-3 is the one that will be argued with**, because every practice
> management system on the market has an assign button. The answer is that an
> assign button is how work becomes nobody's: two people assign, one unassigns,
> and the audit trail says a person moved it rather than saying why it moved.
> Ownership derived from the node cannot be gamed and cannot be forgotten.

> **P-5 has one honest limit.** A person recording an event still presses
> something. The constraint is on *what the press means*: "Patient arrived" is
> an event; "Next" is a workflow position, and the difference is the whole
> specification.

**Violating any principle in §2.3 requires an ADR.** Not a code review comment,
not a "just for this screen" — a written decision with a reason, in
`docs/adr/`. That is what makes these architectural rather than aspirational.


## 3. Business domains

The owner: *"Right now the specification is centred around events, decisions and
workflows. It is not centred around dentistry."*

That is a fair reading and it is the most important criticism in this document's
history, because a workflow engine with no domain is a workflow engine that will
be built for a courier company by mistake. The seven domains below are the
language. Every flow, event and decision belongs to exactly one, and a thing
that belongs to none does not belong in KuBi.

### 3.1 The seven

| # | Domain | Spans | Timescale |
|---|---|---|---|
| B-1 | **Patient relationship** | Lead → enquiry → appointment → visit → treatment → recall → membership → referral → lifetime | Years |
| B-2 | **Clinical care** | Chief complaint → examination → diagnosis → options → consent → procedure → review → outcome → maintenance | Weeks to years |
| B-3 | **Practice operations** | Opening → clinical operations → sterilisation → housekeeping → inventory → lab → closing | Hours |
| B-4 | **Business** | Revenue · receivables · expenses · chair utilisation · doctor productivity · case acceptance · conversion · collections | Days to months |
| B-5 | **Growth** | Marketing · leads · conversions · reviews · referrals · corporate · memberships | Months |
| B-6 | **Quality** | Audit · NABH · incidents · CAPA · feedback · complaints · training | Continuous |
| B-7 | **Learning** | Training · competency · skill matrix · credentialing · assessment · re-certification | Careers |

### 3.2 The finding this produces

Mapping the seven flows of §5 onto the seven domains is uncomfortable, and the
discomfort is the point:

| Domain | Covered by | Honest state |
|---|---|---|
| B-1 Patient relationship | `PATIENT` flow, retention (30-day rule) | **A quarter.** KuBi begins at arrival. Lead, enquiry, membership, referral and the lifetime view do not exist. |
| B-2 Clinical care | `PATIENT`, `CLINICAL` flows; 17 procedure protocols | **Half.** Chief complaint, options and outcome are not modelled; the 100-rule condition library is not wired to the engine. |
| B-3 Practice operations | `CLINIC`, `STERILIZATION`, `LAB`, `INVENTORY` flows | **Most of it.** The strongest domain, and it is the one a clinic feels least. |
| B-4 Business | `BILLING` flow, three metrics | **A tenth.** Case acceptance, conversion, receivables ageing and doctor productivity are absent. |
| B-5 Growth | Nothing | **None.** |
| B-6 Quality | The CAPA service, 68 exceptions, the frozen matrix | **Built but unconnected.** It exists in the codebase and no event reaches it. |
| B-7 Learning | Competency enums; nobody holds one | **A skeleton.** |

> **Three of seven domains are essentially absent, and one is built but
> unconnected.** That is not a gap to hide in a roadmap. It is the reason the
> owner keeps saying KuBi feels like software rather than like running a clinic:
> the clinic's day is well covered and the clinic's *business* is not.

### 3.3 Financial intelligence, which is B-4 and not billing

The owner's example is the whole distinction:

```
Patient accepted ₹8,00,000 of treatment
   → paid ₹2,00,000
   → balance ₹6,00,000
   → on EMI
   → risk: two instalments missed
   → follow-up owned by Accounts, due today
```

Billing records what was charged. B-4 asks whether the *case* completes: what
was accepted, what has been delivered, what has been collected, what is at
risk, and who is chasing it. An accepted plan that stalls at 25 % paid is a
clinical problem before it is a financial one — the remaining treatment is not
happening.

This makes `case acceptance` and `treatment conversion` first-class, not
report columns. Both are open until the domain model of Phase 2 defines a
treatment plan properly.

### 3.4 The rule the domains impose

1. **Every flow declares its domain.** A flow belonging to none is rejected at
   startup.
2. **Every event declares its domain.** Same rule.
3. **A domain may be absent, but never implied.** B-5 has no flows, and the
   specification says so rather than scattering half a lead-tracker through
   B-1.
4. **Domains do not nest and do not overlap.** Where something seems to belong
   to two — a recall is relationship *and* clinical — it belongs to the one
   whose objective it serves, by §2.1 order.

### 3.5 What is deliberately NOT here

The **Dental Practice Domain Model** — the full entity language of patients,
appointments, clinical records, treatment plans, procedures, lab cases,
imaging, billing, inventory, equipment, staff, knowledge, communication and
documents.

That is Phase 2 of the owner's own roadmap and it belongs in its own document.
Putting it here would double this specification's length and delay the freeze,
which is the exact thing the owner warned against.

## 4. Domain entities

Entities are nouns the clinic already talks about. Anything invented for the
software's convenience is marked as such.

### 4.1 People and identity

| Entity | Key fields | Notes |
|---|---|---|
| `Patient` | uhid, displayLabel, clinicId | Exists. Org-scoped identity, ADR-002. |
| `Employee` | id, roles[], competencies[] | Exists. Distinct from `User` — authority has seven axes, never collapsed. |
| `Role` | code | Exists, 14 codes. §6 uses these and never a person. |

### 4.2 The clinical record

| Entity | Key fields | Notes |
|---|---|---|
| `Visit` | patientId, date, chairId?, status | **NEW.** One attendance. Today `Appointment` carries this and shouldn't — a walk-in has a visit and no appointment. |
| `Appointment` | patientId, scheduledStart, visitType, status | Exists. An intention. A visit is what happened. |
| `Procedure` | code, category, requirements[] | Exists. The protocol. |
| `PatientProcedure` | patientId, procedureId, status | Exists. One planned or delivered treatment. |
| `Consent` | patientProcedureId, signedAt, version | Exists. Immutable once signed. |
| `Radiograph` | patientId, takenAt, kind | **NEW.** Referenced by L-2 and currently a boolean fact. |

### 4.3 Resources — the layer that was missing

| Entity | Key fields | Notes |
|---|---|---|
| `Resource` | id, kind, label, state, clinicId | **NEW.** The abstraction the owner asked for. |
| `ResourceKind` | enum | `CHAIR · ROOM · DOCTOR · ASSISTANT · AUTOCLAVE · RVG · OPG · CBCT · SCANNER · LAB_BENCH` |
| `ResourceState` | enum | `FREE · IN_USE · DOWN · OFF_SHIFT` |
| `ResourceClaim` | resourceId, flowId, from, until? | **NEW.** Who holds what, and since when. |

> A doctor and an assistant are **both** an `Employee` and a `Resource`. That
> is deliberate and it is not a modelling mistake: the employee record answers
> *who are you and what may you do*; the resource record answers *are you
> available at 10:15 and what are you holding*. Collapsing them is how
> rostering ends up inside the permission system.

### 4.4 Operations

| Entity | Key fields | Notes |
|---|---|---|
| `SterilizationBatch` | ref, stage, operatorId, releasedBy | Exists. L-3's separation of duties lives here. |
| `LabCase` | ref, patientId, vendor, dispatchedAt, expectedReturnAt, qcResult | Exists. |
| `StockItem` | code, onHand, minimum, unit | Exists. |
| `Equipment` | assetId, nextServiceAt, state | Exists as `Asset`. Also a `Resource` (§4.3). |
| `Invoice` | visitId, amount, settledAt | **NEW.** Billing is a flow with no table today. |

### 4.5 The operating model itself

| Entity | Key fields | Notes |
|---|---|---|
| `Event` | seq, type, subjectId, at, byEmployeeId, byRole, payload | **The only writable table.** §14. |
| `Flow` | id, kind, subjectId, at, heldSince, done | DERIVED from events. Never written directly. |
| `Decision` | see §12 | DERIVED. Never stored at all. |
| `Objective` | code | §2.1. Static. |
| `Exception` | id, kind, subjectId, raisedAt, flowId | **NEW.** §9. |

---

## 5. Events

### 5.1 Rules

1. **Past tense, always.** `PATIENT_ARRIVED`, never `SEAT_PATIENT`. An
   imperative in the catalogue means a button crept into the model. Enforced by
   test today.
2. **An event records something a person did**, not something the software
   should do.
3. **Events are immutable and ordered.** Correction is a new event, never an
   edit. There is no `UPDATE` grant on the table.
4. **Every event names its objective(s)** (Invariant O-1).
5. **An event is refused or admitted, never partially applied.**

### 5.2 Catalogue

Twenty-seven events exist today across seven flows. v1.0 adds the exception
events of §9. The full catalogue lives in
`packages/contracts/src/operating-model.ts` and is the normative list; it is
not duplicated here, because a specification that restates a catalogue is a
specification that will disagree with it by Thursday.

### 5.3 Objective mapping

Each event declares the objectives it serves. Illustrative, not exhaustive:

| Event | Objectives |
|---|---|
| `PATIENT_ARRIVED` | `PATIENT_HAPPY` |
| `PATIENT_SEATED` | `PATIENT_HAPPY`, `CLINIC_EFFICIENT` |
| `CONSENT_SIGNED` | `PATIENT_SAFE`, `RECORDS_COMPLETE` |
| `BATCH_RELEASED` | `PATIENT_SAFE` |
| `TREATMENT_FINISHED` | `TREATMENT_SUCCESSFUL` |
| `PAYMENT_RECEIVED` | `MONEY_COLLECTED` |
| `NOTES_COMPLETED` | `RECORDS_COMPLETE` |
| `RECALL_BOOKED` | `PATIENT_RECALLED` |

---

## 6. Workflows

### 6.1 The seven, concurrent

`CLINIC · PATIENT · CLINICAL · STERILIZATION · LAB · INVENTORY · BILLING`

They run simultaneously and never queue behind one another. Implemented and
tested.

### 6.2 A node

| Field | Meaning |
|---|---|
| `id`, `label` | What the holder is doing, in their words |
| `owner` | A role. Never a person. |
| `completedBy` | The single event that ends it |
| `expectMinutes` | §8 |
| `escalateTo` | §8.4 |
| `requires` | **NEW.** Resources that must be claimable. §8 |
| `objectives` | **NEW.** What this node is for |

### 6.3 State transition rules

1. A node advances **only** when its `completedBy` event is admitted.
2. There is **no** phase field. Position is derived from the event log.
3. Exactly one event completes any given node. (Tested.)
4. A completing event may **open** other flows (`TREATMENT_FINISHED` opens
   `CLINICAL` and `BILLING`).
5. A flow is `done` when its last node completes. Done flows never reopen —
   a further event opens a new flow.
6. Transitions are total: for any (flow, event) pair the result is defined —
   advance, ignore, or refuse. There is no undefined case.

**DECISION_REQUIRED (D-03):** what happens to a `PATIENT` flow when the patient
leaves mid-treatment. Currently undefined. Candidates: an `ABANDONED` terminal
node, or a `VISIT_ABANDONED` exception (§9) that closes the flow and opens a
recall.

---

## 7. Ownership rules

1. **Ownership is derived, never assigned.** It is the `owner` of the current
   node. There is no field to set and no handover action to skip.
2. **Ownership transfers as a consequence of an event**, in the same
   transaction that records it.
3. **Ownership is a role, never a person.** A ladder that names somebody breaks
   the week they leave.
4. **Escalation does not reassign.** The holder still holds it; somebody else
   has merely been told. Moving it would let the doer off.
5. **Separation of duties is expressed as a different owner on the next node**,
   not as a check. An operator cannot release their own batch because the
   `RELEASE` node belongs to a different role.
6. **Exactly one role owns a node at a time.** No shared ownership, ever —
   shared ownership is how nothing gets done.

**DECISION_REQUIRED (D-04):** whether ownership resolves to a *person* when
only one employee holds that role on shift. Cheap to add, and changes what
"the assistant" means on a two-assistant day.

---

## 8. Time

Time is an object, not a timestamp.

### 8.1 The five times

| Time | Meaning | Source |
|---|---|---|
| `expectedAt` | When this should be finished | `heldSince + expectMinutes` |
| `currentAt` | Now, clinic-local | Injected clock. Never `Date.now()`. |
| `lateBy` | `max(0, currentAt − expectedAt)` | DERIVED |
| `escalateAt` | When somebody else is told | §8.4 |
| `predictedAt` | When it will *actually* finish | §11. **UNKNOWN until there is history.** |

### 8.2 The clinic clock drives the system

Events are not the only thing that changes the world. The passage of time
changes it too — work goes late, decisions become escalations, and the owner's
screen changes with nobody having opened the app. This is `sweep(world, now)`
and it is not optional garnish; it is half the system.

### 8.3 Expected times

Every node carries one. **All current values are estimates and none is the
owner's.**

**DECISION_REQUIRED (D-05):** the expected time for all 27 nodes. The ones most
worth arguing about: chair wait 15 min, treatment 50 min, lab QC 60 min,
day-after call 1440 min.

### 8.4 Escalation rules

1. Escalation fires at `expectedAt + escalationDelay`, not at a fixed clock time.
2. The ladder is three rungs, from `work-model.ts`: doer's level at +15,
   their senior at +30, clinic head at +60 — measured from the due moment.
3. An escalation reaches a **named role** (L-8). Raising an alert to nobody is
   a defect, not a state.
4. Escalation is idempotent — re-running `sweep` does not re-alert.
5. A patient-safety node escalates on a tighter ladder.

**DECISION_REQUIRED (D-06):** the patient-safety ladder. Suggestion: +5 / +10 / +15.

---

## 9. Resource rules

The layer the owner said was missing entirely.

1. **A node declares what it requires**, as kinds and counts:
   `SEAT requires { CHAIR: 1, ASSISTANT: 1 }`.
2. **A node cannot be completed while a required resource is unclaimable.**
   The refusal is one sentence and one action, exactly like governance —
   *"No chair is free. Chair 2 frees in about 4 minutes."*
3. **Resource refusal and governance refusal are different things** and must
   never be merged. Governance says *this would be unsafe*; resources say
   *this is not possible yet*. One is a fault, the other is a queue.
4. **Claims are explicit and released by events.** A chair is claimed at
   `PATIENT_SEATED` and released at `TREATMENT_FINISHED`.
5. **When a resource frees, the engine reassigns automatically** — the longest
   waiting flow that requires it, ordered by §2.1. Nobody presses anything.
6. **A `DOWN` resource raises an exception** (§9), not a silent unavailability.

**DECISION_REQUIRED (D-07):** the clinic's actual resource inventory — how many
chairs, rooms, RVG units, whether the OPG is shared, which are on which floor.
Nothing here can be built without it.

**DECISION_REQUIRED (D-08):** whether a doctor may hold two chairs at once. This
is real dentistry and the answer changes the whole capacity model.

### 9.1 Resource intelligence

The owner's point is that *"chair available"* is not the question. The question
is whether **everything** is available:

```
Implant surgery, 11:30
   chair 3          free
   doctor 2         free from 11:15
   assistant        free
   implant kit      in stock, correct platform
   motor            checked this morning
   CBCT             taken, reported
   lab case         not applicable
   ──────────────────────────────────────
   → PROCEED
```

A decision therefore evaluates its **whole** requirement set and reports the
first missing item, never a partial readiness score. *"Ready, 6 of 7"* is the
most dangerous thing this system could display: it reads as nearly ready and it
means not ready at all. The same rule as UNKNOWN never passing, applied to
resources.

**DECISION_REQUIRED (D-15):** whether a decision waits for every resource or
may proceed on a critical subset. Waiting for all is safer and will sometimes
be wrong — a treatment that does not need the motor should not queue behind it.

---

## 10. Capacity rules

Continuous, derived, and never stored:

| Measure | Definition |
|---|---|
| Utilisation | claimed minutes ÷ available minutes, per resource |
| Queue depth | flows waiting on a resource kind |
| Idle | `FREE` resources while a queue for their kind is non-empty |
| Overload | one role holding more than *n* open decisions |
| Bottleneck | the resource kind with the longest queue × longest wait |

**Recommendations, never actions.** Capacity proposes — *"Chair 3 is idle and
two patients are waiting for chair 1; move the next one"* — and a person
decides. An operating system that silently rebalances a clinic is one that
moves a patient away from the doctor who knows their case.

**DECISION_REQUIRED (D-09):** the overload threshold *n*.

---

## 11. Exceptions

Not `if/else`. Every exception is an event that opens its own flow with its own
owner, clock and escalation.

| Exception | Opens | First owner |
|---|---|---|
| `EMERGENCY_PATIENT` | Emergency flow, pre-empts the queue | Doctor |
| `PATIENT_LATE` | Late-arrival flow | Reception |
| `PATIENT_NO_SHOW` | No-show flow → recall | Reception |
| `DOCTOR_UNAVAILABLE` | Reassignment flow | Clinic manager |
| `EQUIPMENT_FAILED` | Breakdown flow; resource → `DOWN` | Clinic manager |
| `POWER_FAILED` | Continuity flow | Clinic manager |
| `LAB_DELAYED` | Chase flow; patient appointment at risk | Lab coordinator |
| `STERILIZATION_FAILED` | Quarantine + re-run flow | Sterilisation |
| `STOCK_OUT` | Emergency purchase flow | Store |
| `PAYMENT_FAILED` | Recovery flow | Reception |
| `TREATMENT_REFUSED` | Documentation + recall flow | Doctor |
| `INSTRUMENT_BROKEN` | Replacement flow | Sterilisation |
| `MEDICAL_EMERGENCY` | Emergency protocol. **Pre-empts everything.** | Doctor |

**Rules**

1. An exception **never** silently cancels the flow it interrupts. Both run.
2. `MEDICAL_EMERGENCY` outranks every decision in the system, by §2.1 — it is
   `PATIENT_SAFE`, which is objective 1.
3. An exception with no owner is not a valid exception.
4. Exceptions are the normal case, not the error case. A clinic that never
   raises one is a clinic that is not recording them.

---

## 12. The Decision Engine

The centre. Everything above is input to this.

### 16.1 A decision

| Field | Meaning |
|---|---|
| `id` | Stable while the decision remains open |
| `question` | *"Can Meera R. be seated?"* — in the words the owner would use |
| `owner` | The role that decides |
| `objective` | Which of the seven. Sets its rank. |
| `needs[]` | Information and resources required |
| `missing[]` | Of those, what is absent right now |
| `verdict` | `PROCEED` · `WAIT` · `ESCALATE` · `BLOCKED` |
| `because` | One sentence. Only when not `PROCEED`. |
| `fix` | One action. Only when not `PROCEED`. |
| `dueAt`, `lateBy` | §8 |

### 16.2 The four questions, answered every minute

> *What decision must be made? Who should make it? Is enough information
> available? If yes, execute. If no, wait. If overdue, escalate.*

```
decisions(world, now):
  candidates ← every open flow node, every open exception
  for each:
      needs      ← governance requirements + resource requirements
      missing    ← those not satisfied
      verdict    ← BLOCKED  if a safety requirement is missing
                   WAIT     if only a resource is missing
                   ESCALATE if lateBy > escalationDelay
                   PROCEED  otherwise
  order by: objective rank (§2.1), then lateBy, then dueAt
```

### 16.3 Verdicts

- **PROCEED** — the person can act now. One action, named.
- **WAIT** — nothing is wrong; a resource is busy. Says what and for how long.
- **ESCALATE** — overdue. Still owned by the holder (§7, rule 4), and now visible to
  the escalation role.
- **BLOCKED** — would be unsafe or non-compliant. One reason, one fix. The
  words *gate, requirement, compliance, validation, rule* never appear.

### 16.4 Why every screen becomes trivial

| Screen | Is |
|---|---|
| A role's Today | `decisions(w, now).filter(d => d.owner === me)` |
| The board | patient flows grouped by node |
| Command centre | the whole list, plus §12 |
| A block | one decision with `verdict === BLOCKED` |

No screen computes anything. That is the test of whether this specification is
right.

---

---

## 13. What a decision carries with it

Three engines the owner named, and one property. They are grouped because they
all answer the same question: **a decision arrives complete, or the person has
to go and find things.** That is law L-6 and principle P-2, and neither survives
if these are bolted on afterwards.

### 13.1 Knowledge engine

> *"Every decision should know: how should I do this? Where is the SOP? Which
> video? Which checklist? Which form?"*

**Knowledge is attached to work, never searched for.** There is no library, no
search box and no "documents" tab. A node declares what a person needs to do it:

```
KNOWLEDGE[node] = {
  sop?:       reference,   // the written procedure
  video?:     reference,   // how it is actually done here
  checklist?: reference,   // what must be true when finished
  form?:      reference,   // what is filled in
}
```

The owner's own example, as the engine would run it:

```
BATCH_QUARANTINED
   → decision "Re-run STER-0911", owner Sterilisation
      carrying  SOP: instrument reprocessing
                video: loading the autoclave
                form:  sterilisation incident
      and       NOTIFY Clinic Manager
```

Four things arrive with the decision. Nobody opens anything to find them.

**DECISION_REQUIRED (D-12):** which SOPs exist in written form today, and where
they live. If the answer is "in people's heads", that is the finding, and the
knowledge engine's first job is to say which nodes have nothing attached rather
than to pretend they do.

### 13.2 Communication engine

> *"Every event should generate communication."*

A declarative map from event to messages. Not code, so that a clinic can change
what a patient hears without changing what the clinic does:

| Event | Goes out |
|---|---|
| `APPOINTMENT_BOOKED` | Confirmation · calendar invitation · reminder scheduled |
| `PATIENT_ARRIVED` | — (nothing; the person is standing there) |
| `TREATMENT_FINISHED` | Post-operative instructions · prescription |
| `PAYMENT_RECEIVED` | Receipt |
| `RECALL_BOOKED` | Reminder scheduled |
| `LAB_ARRIVED` | Appointment offer |

**Rules**

1. Communication is a **consequence**, returned as data, never sent by an
   engine (§15.2 rule 3).
2. **A patient's contact consent is checked before anything is sent**, and a
   withheld consent produces no message and no error.
3. **Silence is a valid entry.** The table above has one deliberately, because
   messaging somebody who is standing at the desk is how a clinic teaches its
   patients to ignore its messages.

**DECISION_REQUIRED (D-13):** which channels, and who owns contact consent.
WhatsApp, SMS and email have different regulatory weight in India and the
answer is not a technical one.

### 13.3 Document engine

> *"Every event should know which documents. No searching."*

Each event declares the documents it **requires** and the documents it
**produces**:

| Event | Requires | Produces |
|---|---|---|
| `CONSENT_SIGNED` | Estimate | Signed consent |
| `TREATMENT_FINISHED` | Consent, radiograph | Clinical note, photographs |
| `PAYMENT_RECEIVED` | Invoice | Receipt |
| `LAB_DISPATCHED` | Prescription | Lab slip |

A required document that is absent is a **governance refusal** (§12.3
`BLOCKED`), in one sentence, with the one button that produces it. A produced
document is attached to the event and is thereafter found by following the
event — never by searching a folder.

**DECISION_REQUIRED (D-14):** which documents are legally required per
procedure in this jurisdiction. Getting this wrong is a regulatory matter, not
a design preference, and it needs the owner and probably their advisor.

### 13.4 Decision quality — the property, not an engine

> *"Right now the engine answers: what should happen? It should also answer:
> why? what evidence? what protocol? what happens if ignored?"*

This is the difference between a system that instructs and a system that can be
argued with. Every `Decision` (§12.1) therefore carries four more fields:

| Field | Answers | Source |
|---|---|---|
| `why` | Why this, now | The objective it serves (§2.1) |
| `evidence` | What the system is going by | The events that produced it, by sequence number |
| `protocol` | What says so | The SOP, control or standard — §13.1, the frozen matrix |
| `ifIgnored` | What happens if nobody acts | The escalation ladder and the objective put at risk |

> **Invariant Q-1.** A decision that cannot state all four is not shown. If the
> system cannot say why it is asking, it has no business asking.

This is also the only honest route to anything called AI later: an explanation
assembled from the event log and the standard is checkable. One generated
afterwards to justify a decision already made is not, and would be worse than
no explanation at all.


## 14. Prediction and the Command Centre

### 12.1 The honest constraint, first

Prediction runs on history. **KuBi has no history yet.** So:

> **Invariant P-1.** A prediction with insufficient history returns `UNKNOWN`.
> It never returns a plausible-looking number.

This is ADR-013 applied to forecasting, and it matters more here than anywhere
else: a made-up prediction on the owner's screen is worse than a blank one,
because it will be believed.

**DECISION_REQUIRED (D-10):** the minimum sample before a prediction is shown.
Suggestion: 20 completed instances of the same node.

### 12.2 What is predicted

| Prediction | From |
|---|---|
| Node completion time | Distribution of that node's historical durations |
| Bottleneck in the next hour | Queue depth × predicted service time |
| Appointment delay | Current running late + predicted remaining |
| Chair utilisation | Claims vs the schedule ahead |
| Sterilisation overload | Instruments in flight vs autoclave throughput |
| Lab delay risk | Vendor's historical return vs promised date |
| Revenue completion | Settled vs treated, today |

### 12.3 The Command Centre

The owner's screen. Not reports — the next failure:

```
Clinic status      82%  ·  Safe
Bottlenecks        3
Escalations        2
Next failure       Sterilisation delayed in ~18 min
Suggested action   Move assistant 2 to the sterile bay
```

Every line above is a function of `decisions()` and §14.2. None of it is
stored, and none of it is a report of the past.

### 12.4 The pattern layer

The owner's examples — *"every Tuesday the doctor runs late"*, *"sterilisation
takes 17 minutes longer after lunch"*, *"patients cancel mostly after the
estimate"* — are periodic analyses over the event log, surfaced as
**suggestions to a person**, never as automatic changes.

Deferred to v1.1. It needs months of real events, and specifying it now would
be specifying a guess.

---

## 15. Engine APIs

### 15.1 Layering

Strict. An engine may only call downward.

```
  L5  DECISION      decisions(world, now) → Decision[]
       │
  L4  CAPACITY      utilisation() · bottlenecks() · recommendations()
      PREDICTION    predict(node) → Prediction | UNKNOWN
       │
  L3  RESOURCE      claimable() · claim() · release() · onFree()
      GOVERNANCE    admit(world, event) → Refusal | null
      KNOWLEDGE     knowledgeFor(node) → { sop?, video?, checklist?, form? }
      DOCUMENT      requires(event) · produces(event)
      COMMUNICATION messagesFor(event) → Message[]   (returned, never sent)
       │
  L2  WORKFLOW      record(world, event) → EventOutcome
      OWNERSHIP     ownerOf(flow) · deskOf(world, role)
      TIME          sweep(world, now) → Alert[]
       │
  L1  EVENT LOG     append(event) · replay() → World
       │
  L0  OBJECTIVES    rank(objective) → 1..7
```

### 15.2 Rules

1. **Every engine is a pure function of `(world, …, now)`.** No clock, no
   database, no I/O. This is what lets a test stand at 09:14 and again at 09:16.
2. **No engine mutates the world.** Each returns a new one.
3. **Consequences are returned as data, never performed.** Notifications, audit
   writes and metric updates are done by the caller. An engine that sends email
   is an engine that cannot be tested.
4. **No upward calls and no cycles.** Governance may not ask the decision
   engine anything.
5. **One write path.** `record()`. Everything else reads.

### 15.3 Ports

The impure edges, injected:

| Port | For |
|---|---|
| `Clock` | The current instant. Exists. |
| `EventStore` | Append and replay |
| `Notifier` | Delivering what `NOTIFY` consequences describe |
| `Roster` | Which employees hold which roles on shift |

---

## 16. Event log and schema

### 14.1 The principle

> **The event log is the only truth. Everything else is a projection.**

The owner: *"Everything should come from Event Log. Nothing should be stored
twice."*

### 14.2 The one writable table

```sql
CREATE TABLE clinic_events (
  seq              bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  clinic_id        uuid NOT NULL,
  type             text NOT NULL,
  subject_id       text NOT NULL,
  subject_kind     text NOT NULL,
  occurred_at      timestamptz(6) NOT NULL,
  recorded_at      timestamptz(6) NOT NULL DEFAULT now(),
  by_employee_id   uuid,
  by_role          text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE clinic_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_events FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON clinic_events TO kubi_app;
REVOKE UPDATE, DELETE, TRUNCATE ON clinic_events FROM kubi_app;
```

`occurred_at` and `recorded_at` are separate on purpose: a patient arrived at
09:05 and reception recorded it at 09:11, and both facts matter.

**Append-only by database grant, not by good manners.** This is the difference
the Sheets analysis established and it is not negotiable.

### 14.3 Projections

`flows`, `resource_claims`, `open_decisions` are all rebuildable from the log
by replay. They exist for query speed and may be dropped and rebuilt at any
time.

> **Invariant S-1.** Deleting every projection and replaying the log produces
> an identical world. Tested by replay, not asserted.

### 14.4 What this replaces

The existing tables (`patient_procedures`, `lab_cases`, `sterilization_batches`)
become projections. They keep their shape; they stop being written directly.

**DECISION_REQUIRED (D-11):** whether existing rows are backfilled into
synthetic events or the log starts empty at cutover. Backfilling invents
timestamps that never happened.

---

## 17. Open decisions

Nothing below has been guessed. Each blocks the section it belongs to.

| ID | Section | Decision needed |
|---|---|---|
| D-01 | §2.1 | May patient safety ever be traded against waiting time? |
| D-02 | §2.2 | Does an unpaid bill block closing the day, or escalate? |
| D-03 | §6.3 | What happens when a patient leaves mid-treatment? |
| D-04 | §6 | Does ownership resolve to a person when one employee holds the role? |
| D-05 | §8.3 | Expected time for all 27 nodes |
| D-06 | §8.4 | The patient-safety escalation ladder |
| D-07 | §8 | The clinic's real resource inventory |
| D-08 | §8 | May one doctor hold two chairs? |
| D-09 | §12 | The overload threshold |
| D-10 | §14.1 | Minimum history before a prediction is shown |
| D-11 | §16.4 | Backfill existing rows, or start the log empty? |
| D-12 | §13.1 | Which SOPs exist in writing today, and where do they live? |
| D-13 | §13.2 | Which communication channels, and who owns contact consent? |
| D-14 | §13.3 | Which documents are legally required per procedure here? |
| D-15 | §9 | Does a decision wait for *every* resource, or proceed on the critical few? |

---

## 18. Status: built, specified, deferred

| Part | Status |
|---|---|
| Events, past-tense discipline | **BUILT**, tested |
| Seven concurrent workflows | **BUILT**, tested |
| Ownership and transfer | **BUILT**, tested |
| Governance refusal | **BUILT**, tested |
| Time and escalation sweep | **BUILT**, tested |
| Role desks | **BUILT**, tested |
| Board derived from flow | **BUILT**, tested |
| Objectives and ranking | **SPECIFIED** §2.1 |
| Laws as invariants | **SPECIFIED** §2.2 |
| Resources and claims | **SPECIFIED** §4.3, §8 |
| Capacity | **SPECIFIED** §12 |
| Exceptions | **SPECIFIED** §12 |
| Decision engine | **SPECIFIED** §12 |
| Prediction, command centre | **SPECIFIED** §12 |
| Event log persistence | **SPECIFIED** §16 |
| Pattern layer | **DEFERRED** to v1.1 |
| UI | **NOT SPECIFIED.** Deliberately. |

### The freeze protocol

v1.0 freezes when the owner accepts it. After that:

- Corrections queue for v1.1 in a register, exactly as Matrix v2.0 does.
- No engine is implemented before its section is frozen.
- An implementation that needs a decision from §15 stops and asks.

### The roadmap, as the owner set it

| Phase | What | Gate to the next |
|---|---|---|
| **1 — Freeze** | Answer the fifteen decisions in §17; lock v1.0 | Owner acceptance |
| **2 — Dental domain** | A separate *Dental Practice Domain Model*: patients, appointments, clinical records, treatment plans, procedures, lab cases, imaging, billing, inventory, equipment, staff, knowledge, communication, documents | That document frozen too |
| **3 — Engines** | Event log, workflow, decision, resource, governance, capacity — exactly as specified | Every engine tested against §2.2 laws |
| **4 — Role UI** | Eight screens, each rendering `decisions(world, role, now)` and containing no business logic | §2.3 drift tests pass |

**This specification stops expanding here.** The owner's warning is recorded as
a rule: *"I would not let Claude continue expanding this architecture
indefinitely."* Anything raised after this point goes to a v1.1 register and
waits, exactly as Matrix v2.0 corrections do. A specification that keeps
growing is a specification nothing is ever built from.

### Build order within Phase 3

1. **Objectives and laws** — nothing else can be ordered without them.
2. **Event log persistence** — the truth needs somewhere to live.
3. **Resources** — the decision engine cannot say `WAIT` without them.
4. **Decision engine** — the centre.
5. **Exceptions** — needs decisions to attach to.
6. **Capacity** — needs resources and claims.
7. **Prediction** — needs history, so it is genuinely last.
8. **UI** — renders `decisions()` and computes nothing.

---

*All examples in this document are synthetic. No patient named here exists.*
