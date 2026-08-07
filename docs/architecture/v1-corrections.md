# Corrections queued against the frozen V1.0

The architecture is frozen. *"Do not add any new engines, domains, workflows,
principles, features, or architectural abstractions."* That instruction is what
makes implementation possible, and it also means that when implementation finds
the specification wrong, the answer is not to quietly fix it — a specification
that gets edited whenever it is inconvenient is not frozen and was never a
specification.

So corrections queue here, the same way matrix corrections queue for v3.0. Each
one names what the spec says, what the code does, and why the gap was not
closed unilaterally. None of them is applied until the owner rules.

---

## C-1 · §11 rule 2 — a medical emergency does not outrank a *late* rank-1 item

**The specification says.** §11, rule 2: a `MEDICAL_EMERGENCY` "outranks every
decision in the system, **by §2.1**".

**The code does.** It does not, and it cannot while §2.1 is the mechanism. §2.1
orders by objective rank, then by lateness. `PATIENT_SAFE` is rank 1 and it is
shared: a sterilisation release forty minutes overdue is also rank 1, so it
sorts above an emergency that arrived a minute ago. The clause is
self-contradictory — "outranks everything" and "by §2.1" cannot both hold,
because §2.1 contains no tie-break that an emergency wins.

**Why it was not fixed.** Making the emergency win requires a rule §2.1 does
not contain — an exception class above objective rank, or a lateness exemption.
Either is a new architectural abstraction, which is the specific thing the
freeze prohibits.

**What was done instead.** The behaviour is pinned by a test that asserts the
overdue release currently sorts first
(`tests/scenarios/clinic-day.test.ts`, *"does not outrank a LATE
patient-safety item"*). The gap is visible, cannot drift silently, and flips
into a real assertion the moment the owner rules.

**The owner's call.** Either §11 rule 2 is reworded to what §2.1 actually
delivers — *an emergency enters at rank 1 and is ordered among rank-1 work by
lateness* — or §2.1 gains a tie-break, which is a v1.1 architectural change and
needs to be made deliberately rather than discovered in a sort function.

**Clinical note.** This is not obviously the wrong behaviour. An overdue
sterilisation release is itself a patient-safety item, and a system that
always demoted it beneath every new arrival would have its own failure mode.
That is exactly why it is the owner's call and not the implementer's.

---

## C-2 · §11 — twelve of thirteen exception types have no node sequence

**The specification says.** Thirteen exception types exist.

**The code does.** One is built: the medical emergency, whose nodes come from
§11 and frozen-matrix control EMR-003.

**Why it was not fixed.** The other twelve have no node sequences anywhere in
V1.0. There is nothing to implement against, and writing sequences for them
would be authoring architecture, not implementing it.

**What was done instead.** Counted as unbuilt in
`docs/architecture/acceptance-inventory.md` rather than omitted from the count.

**The owner's call.** Supply node sequences — owner, expected minutes,
escalation target and objective per node — for the remaining twelve, or rule
that V1.0 ships with one exception flow.

---

## C-3 · §11 "pre-empts the queue" is not computable in V1.0

**The specification says.** An emergency "pre-empts the queue".

**The code does.** Raises, owns, ranks and escalates the emergency. It does not
re-sequence anybody, because pre-empting means taking a chair from somebody and
nothing in the model knows a chair exists.

**Why it was not fixed.** Blocked on **D-07** (the clinic's real resource
inventory) and **D-08** (may one doctor hold two chairs). Both are open owner
decisions, and the working agreement is explicit: never silently resolve an
open Owner Decision.

**What was done instead.** Scenario 5 stays BLOCKED and visible, and Scenario 9
carries a test recording that the queue is not re-sequenced.

**The owner's call.** D-07 and D-08. This one is a blocker, not a wording
problem — it unblocks Scenario 5 and the resource engine together.
