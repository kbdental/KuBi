# Acceptance inventory

> *"Create an explicit numbered acceptance-test inventory so that the total
> number of scenarios and their status is unambiguous. Do not delete or combine
> a scenario merely to make the percentage look better."* — owner

This file is the single answer to "how many scenarios are there and how many
pass". It exists because the count had drifted: progress had been reported
against a moving denominator, and a percentage whose bottom half changes is not
a measurement.

`tests/unit/acceptance-inventory.test.ts` fails if this table and
`tests/scenarios/clinic-day.test.ts` disagree.

## The denominator

**Ten.** The owner gave ten numbered scenarios, once, in one message. No
eleventh scenario was ever set. Earlier work referred to a "Scenario 11" that
does not exist in anything the owner wrote — it has been removed rather than
back-filled with an invented scenario.

`8b` is **not** an eleventh scenario. It is a correction the owner demanded
inside Scenario 8 (*"A bill being financially important does not mean a
clinical note can safely be left incomplete"*), and it is counted as part of
Scenario 8 — which is why the denominator stays at ten.

## The ten

| # | Scenario, as the owner wrote it | Status | Where |
|---|---|---|---|
| 1 | 8:45 AM — clinic opening | **PASS** | `Scenario 1 · 08:45, clinic opening` |
| 2 | 9:00 AM — patient arrives 12 minutes early | **PASS** | `Scenario 2 · patient arrives twelve minutes early` |
| 3 | Doctor is running 20 minutes late | **PASS** | `Scenario 3 · doctor running twenty minutes late` |
| 4 | Patient needs extraction but consent is missing | **PASS** | `Scenario 4 · treatment needed, consent missing` |
| 5 | Chair 2 becomes free while three patients are waiting | **BLOCKED** | `Not yet — the scenario blocked on an engine that does not exist` |
| 6 | Autoclave cycle completes | **PASS** | `Scenario 6 · autoclave cycle completes` |
| 7 | Implant case is due but required lab case hasn't arrived | **PASS** | `Scenario 7 · lab case has not arrived` |
| 8 | Patient completes treatment but billing hasn't happened | **PASS** | `Scenario 8` + `Scenario 8b` |
| 9 | Emergency patient arrives during a full schedule | **PARTIAL** | `Scenario 9 · emergency arrives while the clinic is full` |
| 10 | Clinic closes with one sterilisation batch still unresolved | **PASS** | `Scenario 10 · closing with sterilisation unresolved` |

**8 pass · 1 partial · 1 blocked.**

Not "80%". A partial is not half a pass, and averaging them would hide exactly
the thing worth reading.

### Scenario 5 — BLOCKED, on D-07 and D-08

The engine cannot say WAIT because nothing in the model knows a chair exists.
Re-sequencing three waiting patients onto a freed chair needs the resource
inventory (**D-07**) and the answer to whether one doctor may hold two chairs
(**D-08**). Both are open owner decisions. Nothing has been guessed; the
scenario stays blocked and visible.

### Scenario 9 — PARTIAL, and precisely how

Seven of its behaviours pass:

- the emergency flow starts from the event, with no triage button anywhere
- it lands on the treating doctor without anybody routing it
- it ranks first among everything that doctor holds (PATIENT_SAFE, rank 1)
- nothing is cancelled to make room — §11 rule 1, both run
- every safety rule survives it: an emergency is not a reason to skip somebody
  else's consent
- triage hands to documentation, because frozen-matrix control EMR-003 says
  every medical emergency creates an incident record
- an untriaged emergency escalates to the clinic head on the clock alone

Two boundaries are **reported, not papered over**, each with a test that pins
the current behaviour so it cannot drift silently:

1. **It cannot re-sequence the queue.** §11 says the emergency "pre-empts the
   queue"; pre-empting means taking a chair from somebody, and the model has no
   chairs. Same blocker as Scenario 5 — D-07, D-08.
2. **It does not outrank a *late* patient-safety item.** §11 rule 2 says a
   medical emergency "outranks every decision in the system, by §2.1". It does
   not: §2.1 orders by objective and then by lateness, so a sterilisation
   release forty minutes overdue — also rank 1 — sorts above a fresh emergency.
   Making the emergency win would need a rule §2.1 does not contain. The
   architecture is frozen, so this is filed as a **v1.1 correction against the
   specification** — `docs/architecture/v1-corrections.md`, C-1 — not fixed by
   inventing a rule.

## Exception flows — 1 of 13

The frozen matrix names thirteen exception types. One, the medical emergency,
has a node sequence in the frozen specification (§11, EMR-003) and is built.
The other twelve have no node sequences anywhere in V1.0 — there is nothing to
implement against, and writing sequences for them would be adding to a frozen
architecture. They are counted here as unbuilt rather than omitted, and queued
as C-2 in `docs/architecture/v1-corrections.md`.

## Restart survival — proven, not asserted

`tests/integration/event-log.test.ts`, 14 tests against real PostgreSQL. A
brand-new `EventStore` — as close as a test gets to pulling the plug — rebuilds
the same flows at the same nodes, the same ownership, the same timers (a patient
who waited twenty minutes still has), and the same refusals. It also proves
there is no second source of truth, and that the log is append-only *by GRANT*:
the application role's UPDATE, DELETE and TRUNCATE are all refused by the
database, not by the good manners of the code above it.
