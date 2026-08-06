# KuBi Architecture Specification v1.0

**A Clinic Decision Operating System**

| | |
|---|---|
| **Status** | DRAFT — for owner review. Nothing is frozen until §16 says so. |
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
| 1. Core domain entities | §3 |
| 2. Events | §4 |
| 3. Workflows | §5 |
| 4. Ownership rules | §6 |
| 5. Decision rules | §10 |
| 6. Resource rules | §8 |
| 7. Escalation rules | §7.4 |
| 8. State transition rules | §5.3 |
| 9. APIs between engines | §13 |
| 10. Database / event-log schema | §14 |

Three conventions run throughout:

- **DECIDED** — settled, and implementable as written.
- **DECISION_REQUIRED** — the specification deliberately carries no value.
  Every one is listed in §15. None is guessed, and none may be filled in by
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

## 3. Domain entities

Entities are nouns the clinic already talks about. Anything invented for the
software's convenience is marked as such.

### 3.1 People and identity

| Entity | Key fields | Notes |
|---|---|---|
| `Patient` | uhid, displayLabel, clinicId | Exists. Org-scoped identity, ADR-002. |
| `Employee` | id, roles[], competencies[] | Exists. Distinct from `User` — authority has seven axes, never collapsed. |
| `Role` | code | Exists, 14 codes. §6 uses these and never a person. |

### 3.2 The clinical record

| Entity | Key fields | Notes |
|---|---|---|
| `Visit` | patientId, date, chairId?, status | **NEW.** One attendance. Today `Appointment` carries this and shouldn't — a walk-in has a visit and no appointment. |
| `Appointment` | patientId, scheduledStart, visitType, status | Exists. An intention. A visit is what happened. |
| `Procedure` | code, category, requirements[] | Exists. The protocol. |
| `PatientProcedure` | patientId, procedureId, status | Exists. One planned or delivered treatment. |
| `Consent` | patientProcedureId, signedAt, version | Exists. Immutable once signed. |
| `Radiograph` | patientId, takenAt, kind | **NEW.** Referenced by L-2 and currently a boolean fact. |

### 3.3 Resources — the layer that was missing

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

### 3.4 Operations

| Entity | Key fields | Notes |
|---|---|---|
| `SterilizationBatch` | ref, stage, operatorId, releasedBy | Exists. L-3's separation of duties lives here. |
| `LabCase` | ref, patientId, vendor, dispatchedAt, expectedReturnAt, qcResult | Exists. |
| `StockItem` | code, onHand, minimum, unit | Exists. |
| `Equipment` | assetId, nextServiceAt, state | Exists as `Asset`. Also a `Resource` (§3.3). |
| `Invoice` | visitId, amount, settledAt | **NEW.** Billing is a flow with no table today. |

### 3.5 The operating model itself

| Entity | Key fields | Notes |
|---|---|---|
| `Event` | seq, type, subjectId, at, byEmployeeId, byRole, payload | **The only writable table.** §14. |
| `Flow` | id, kind, subjectId, at, heldSince, done | DERIVED from events. Never written directly. |
| `Decision` | see §10 | DERIVED. Never stored at all. |
| `Objective` | code | §2.1. Static. |
| `Exception` | id, kind, subjectId, raisedAt, flowId | **NEW.** §9. |

---

## 4. Events

### 4.1 Rules

1. **Past tense, always.** `PATIENT_ARRIVED`, never `SEAT_PATIENT`. An
   imperative in the catalogue means a button crept into the model. Enforced by
   test today.
2. **An event records something a person did**, not something the software
   should do.
3. **Events are immutable and ordered.** Correction is a new event, never an
   edit. There is no `UPDATE` grant on the table.
4. **Every event names its objective(s)** (Invariant O-1).
5. **An event is refused or admitted, never partially applied.**

### 4.2 Catalogue

Twenty-seven events exist today across seven flows. v1.0 adds the exception
events of §9. The full catalogue lives in
`packages/contracts/src/operating-model.ts` and is the normative list; it is
not duplicated here, because a specification that restates a catalogue is a
specification that will disagree with it by Thursday.

### 4.3 Objective mapping

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

## 5. Workflows

### 5.1 The seven, concurrent

`CLINIC · PATIENT · CLINICAL · STERILIZATION · LAB · INVENTORY · BILLING`

They run simultaneously and never queue behind one another. Implemented and
tested.

### 5.2 A node

| Field | Meaning |
|---|---|
| `id`, `label` | What the holder is doing, in their words |
| `owner` | A role. Never a person. |
| `completedBy` | The single event that ends it |
| `expectMinutes` | §7 |
| `escalateTo` | §7.4 |
| `requires` | **NEW.** Resources that must be claimable. §8 |
| `objectives` | **NEW.** What this node is for |

### 5.3 State transition rules

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

## 6. Ownership rules

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

## 7. Time

Time is an object, not a timestamp.

### 7.1 The five times

| Time | Meaning | Source |
|---|---|---|
| `expectedAt` | When this should be finished | `heldSince + expectMinutes` |
| `currentAt` | Now, clinic-local | Injected clock. Never `Date.now()`. |
| `lateBy` | `max(0, currentAt − expectedAt)` | DERIVED |
| `escalateAt` | When somebody else is told | §7.4 |
| `predictedAt` | When it will *actually* finish | §11. **UNKNOWN until there is history.** |

### 7.2 The clinic clock drives the system

Events are not the only thing that changes the world. The passage of time
changes it too — work goes late, decisions become escalations, and the owner's
screen changes with nobody having opened the app. This is `sweep(world, now)`
and it is not optional garnish; it is half the system.

### 7.3 Expected times

Every node carries one. **All current values are estimates and none is the
owner's.**

**DECISION_REQUIRED (D-05):** the expected time for all 27 nodes. The ones most
worth arguing about: chair wait 15 min, treatment 50 min, lab QC 60 min,
day-after call 1440 min.

### 7.4 Escalation rules

1. Escalation fires at `expectedAt + escalationDelay`, not at a fixed clock time.
2. The ladder is three rungs, from `work-model.ts`: doer's level at +15,
   their senior at +30, clinic head at +60 — measured from the due moment.
3. An escalation reaches a **named role** (L-8). Raising an alert to nobody is
   a defect, not a state.
4. Escalation is idempotent — re-running `sweep` does not re-alert.
5. A patient-safety node escalates on a tighter ladder.

**DECISION_REQUIRED (D-06):** the patient-safety ladder. Suggestion: +5 / +10 / +15.

---

## 8. Resource rules

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

---

## 9. Capacity rules

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

## 10. Exceptions

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

## 11. The Decision Engine

The centre. Everything above is input to this.

### 11.1 A decision

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
| `dueAt`, `lateBy` | §7 |

### 11.2 The four questions, answered every minute

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

### 11.3 Verdicts

- **PROCEED** — the person can act now. One action, named.
- **WAIT** — nothing is wrong; a resource is busy. Says what and for how long.
- **ESCALATE** — overdue. Still owned by the holder (§6.4), and now visible to
  the escalation role.
- **BLOCKED** — would be unsafe or non-compliant. One reason, one fix. The
  words *gate, requirement, compliance, validation, rule* never appear.

### 11.4 Why every screen becomes trivial

| Screen | Is |
|---|---|
| A role's Today | `decisions(w, now).filter(d => d.owner === me)` |
| The board | patient flows grouped by node |
| Command centre | the whole list, plus §12 |
| A block | one decision with `verdict === BLOCKED` |

No screen computes anything. That is the test of whether this specification is
right.

---

## 12. Prediction and the Command Centre

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

Every line above is a function of `decisions()` and §12.2. None of it is
stored, and none of it is a report of the past.

### 12.4 The pattern layer

The owner's examples — *"every Tuesday the doctor runs late"*, *"sterilisation
takes 17 minutes longer after lunch"*, *"patients cancel mostly after the
estimate"* — are periodic analyses over the event log, surfaced as
**suggestions to a person**, never as automatic changes.

Deferred to v1.1. It needs months of real events, and specifying it now would
be specifying a guess.

---

## 13. Engine APIs

### 13.1 Layering

Strict. An engine may only call downward.

```
  L5  DECISION      decisions(world, now) → Decision[]
       │
  L4  CAPACITY      utilisation() · bottlenecks() · recommendations()
      PREDICTION    predict(node) → Prediction | UNKNOWN
       │
  L3  RESOURCE      claimable() · claim() · release() · onFree()
      GOVERNANCE    admit(world, event) → Refusal | null
       │
  L2  WORKFLOW      record(world, event) → EventOutcome
      OWNERSHIP     ownerOf(flow) · deskOf(world, role)
      TIME          sweep(world, now) → Alert[]
       │
  L1  EVENT LOG     append(event) · replay() → World
       │
  L0  OBJECTIVES    rank(objective) → 1..7
```

### 13.2 Rules

1. **Every engine is a pure function of `(world, …, now)`.** No clock, no
   database, no I/O. This is what lets a test stand at 09:14 and again at 09:16.
2. **No engine mutates the world.** Each returns a new one.
3. **Consequences are returned as data, never performed.** Notifications, audit
   writes and metric updates are done by the caller. An engine that sends email
   is an engine that cannot be tested.
4. **No upward calls and no cycles.** Governance may not ask the decision
   engine anything.
5. **One write path.** `record()`. Everything else reads.

### 13.3 Ports

The impure edges, injected:

| Port | For |
|---|---|
| `Clock` | The current instant. Exists. |
| `EventStore` | Append and replay |
| `Notifier` | Delivering what `NOTIFY` consequences describe |
| `Roster` | Which employees hold which roles on shift |

---

## 14. Event log and schema

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

## 15. Open decisions

Nothing below has been guessed. Each blocks the section it belongs to.

| ID | Section | Decision needed |
|---|---|---|
| D-01 | §2.1 | May patient safety ever be traded against waiting time? |
| D-02 | §2.2 | Does an unpaid bill block closing the day, or escalate? |
| D-03 | §5.3 | What happens when a patient leaves mid-treatment? |
| D-04 | §6 | Does ownership resolve to a person when one employee holds the role? |
| D-05 | §7.3 | Expected time for all 27 nodes |
| D-06 | §7.4 | The patient-safety escalation ladder |
| D-07 | §8 | The clinic's real resource inventory |
| D-08 | §8 | May one doctor hold two chairs? |
| D-09 | §9 | The overload threshold |
| D-10 | §12.1 | Minimum history before a prediction is shown |
| D-11 | §14.4 | Backfill existing rows, or start the log empty? |

---

## 16. Status: built, specified, deferred

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
| Resources and claims | **SPECIFIED** §3.3, §8 |
| Capacity | **SPECIFIED** §9 |
| Exceptions | **SPECIFIED** §10 |
| Decision engine | **SPECIFIED** §11 |
| Prediction, command centre | **SPECIFIED** §12 |
| Event log persistence | **SPECIFIED** §14 |
| Pattern layer | **DEFERRED** to v1.1 |
| UI | **NOT SPECIFIED.** Deliberately. |

### The freeze protocol

v1.0 freezes when the owner accepts it. After that:

- Corrections queue for v1.1 in a register, exactly as Matrix v2.0 does.
- No engine is implemented before its section is frozen.
- An implementation that needs a decision from §15 stops and asks.

### Build order, once frozen

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
