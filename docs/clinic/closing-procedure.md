# Clinic closing — the structure

Built the same way as `opening-readiness.md`: your controls restructured so
they can be counted, sequenced and checked.

**Status: built and running**, against the owner's *Clinic closing drill*
supplied 2026‑08‑08, plus the four matrix controls the drill had no home for,
added on the owner's instruction. Seven sections, eleven blocks, enforced
server‑side.

Sources: the owner's closing drill (the seven protocols), the activity matrix
sheet 15 (`CLOSE-001`–`CLOSE-016`), and the closing items in the
infection‑control document.

## The eleven blocks

Seven come from the seven protocols. Two more — `RESTOCK` and `TOMORROW` —
were added on the owner's instruction to cover the matrix controls the drill
was silent about. They are listed grouped by owner rather than interleaved:
two people working at once is what makes thirty minutes possible, and a list
that alternates between them reads like a queue when it is not one.

| Block | Protocol | Owner | Critical |
|---|---|---|---|
| `OPERATORY_CLOSED` × 4 | Operatory Closing (a–g) | Dental Assistant | ✔ |
| `RESTOCK` | *added* — consumables replenished for tomorrow (`CLOSE-009`) | Dental Assistant | |
| `PAYMENTS` | End‑of‑Day Payment Reconciliation (a–f) | Reception | |
| `REPORT` | Daily Report Submission (a–b) | Reception | |
| `TOMORROW` | *added* — lab cases due and tomorrow's list (`CLOSE-013`, `CLOSE-014`) | Reception | |
| `WASTE` | BMW Closing (a–e) | Housekeeping | ✔ |
| `ENVIRONMENT` | Clinic Environment Closing (a–g), incl. fumigation and the water pump (`CLOSE-012`) | Housekeeping | ✔ |
| `SECURITY` | Security & Lockdown (a–h) | Reception | |

None of the added work is `critical`. The matrix scores priorities PS / C / I,
and only **PS** is patient safety; `CLOSE-009`, `012` and `013` are I and
`CLOSE-014` is C. Not critical is not optional — every block holds the lockup —
but calling this work a 🔴 CLOSING WITH CRITICAL EXCEPTION would empty the
phrase of meaning.

`CLOSING_MINUTES` stays **30**. The rooms were already being restocked and
tomorrow already being looked at on the way out of the door; what changed is
that the system can now see it.

`STAFF_LEFT` counts people out through the End‑of‑Day Staff Protocol —
reported, not enforced, the same limit as staff entry.

## When the clinic shuts

*"Clinic shut time is 6.30 normally with exceptions of some days that is 7."*
Two facts, so two places — and the exception days are the point, because a
clinic that only knew 18:30 would call every one of those evenings an overrun
by the team that stayed late.

| | |
|---|---|
| `clinics.shut_minute` | the normal time — **18:30** for this clinic |
| `clinic_shut_overrides` | the days it is not, with a date and a reason |

Today's override wins; the normal time stands behind it. Neither set means
`shutAt` is null, and null is not a plausible hour.

**Shutting is when the drill starts, not a deadline it has to beat.** So the
measure is `overrunMinutes` — the gap between the door closing and the team
leaving — not lateness. On a seven o'clock day, leaving at 19:50 is the same
fifty minutes of work as leaving at 19:20 on a normal one, and reporting eighty
would blame the team for the exception.

The drill now appears on people's lists **the moment the clinic shuts**, as
well as when the last visit finishes. Some evenings the door closes at 18:30
with nobody in the chair and the drill still to do.

## Thirty minutes

The drill takes **30 minutes**, so the team should be out by **19:00** — or
19:30 on a seven o'clock day. Like the morning's fifty, it is a whole‑clinic
figure and not the sum of the blocks: reception reconciles while housekeeping
mops.

That gives closing the measure the morning already had. `overrunMinutes` says
how long it took; `varianceMinutes` says whether that was longer than thirty,
negative when the team got out early. Outstanding work escalates once the hour
passes — *"15 min past when the team should have left"*.

## Same-day sterilisation does not fit — this is arithmetic, not a worry

Three of your own numbers, put together:

| | |
|---|---|
| clinic shuts | 18:30 |
| closing drill | 30 min → team leaves **19:00** |
| sterilisation cycle | 75 min to cooling |

Working back from when the team leaves, the **last instrument that can be
stored the same day must be collected by 17:45** — three quarters of an hour
*before the clinic shuts*. Instruments used in the last treatment of the day
cannot be stored the same day. Not through carelessness; the numbers do not
leave room.

The seven o'clock day is no better: the whole schedule shifts and the shortfall
stays at 45 minutes.

`lastCollection(shutAt)` computes this, and reports `reachable: false` with the
shortfall rather than a plausible-looking cut-off time. **KuBi still refuses to
close with instruments in the loop** — the arithmetic is a finding, not a
licence — so until you rule, the behaviour is exactly as before.

Three ways out, and it is your call which:

1. **Somebody stays.** The sterilisation technician works past 19:45.
2. **The morning run catches yesterday.** Which is what the opening procedure
   already has, and would make "same-day at 100%" the wrong target rather than
   a failure.
3. **A collection cut-off**, with anything after it explicitly tomorrow's.

`CLINIC_LOCKED` is refused until all nine are reported, and the refusal names
the section: *"The waste bins are not closed and the logbook is not written"*.
The three existing refusals — unfinished visit, unwritten note, instruments in
the loop — still fire first, because a manager who has left a patient
mid‑visit should be told about the patient and not about the bins.

## Two things the document settled

**Fumigation is not the long pole.** The hour the rooms stay shut is spent
with nobody in the building — it constrains re‑entry, not departure, and the
clinic does not reopen inside it. The earlier guess that it would drive the
closing schedule has been dropped.

**Same-day sterilisation is not the rule.** The arithmetic said it could not
be: cycle 75 min, team out 30 min after the door, so the last storable
collection would be 17:45 — three quarters of an hour *before* the clinic
shuts. The owner ruled that **the morning run catches yesterday's
instruments**, which is why the opening procedure has one.

So a batch waiting overnight is the normal end of a day, and the safety net
sits at opening: the clinic cannot be called ready until a run is released.
What closing still refuses is the one thing that is genuinely a today problem —
**a cycle that ran and was never released**. Nobody has attested it passed, the
operator has gone home, and tomorrow those packs look identical to sterile ones
on the shelf. That is the owner's own *"Autoclave cycle result never
recorded"*.

Before this, `CLINIC_LOCKED` refused whenever any batch was mid-loop. On these
hours that would have ended **every single evening** in a refusal nobody on
shift could clear — and a rule that cannot be satisfied is one people learn to
route around.

**Revenue reconciliation is a closing control after all**, with a Discrepancy
Log and a petty‑cash balance behind it. That closes the gap between your KPI
list and the matrix, which had no `CLOSE-` row for it.

---

## Closing is not opening in reverse

Opening asks *"may the clinic open?"* and the answer is yes or no. The matrix
asks something different of closing, and it is the most important line in the
sheet:

> *"But KuBi should distinguish **Task Completed** from **Clinic Safe to
> Close**. If a critical sterilization or patient-safety task remains
> unresolved, the system should display 🔴 CLOSING WITH CRITICAL EXCEPTION and
> require manager acknowledgement."*

**Settled by the owner: keep refusing at lockup.** There is no manager
acknowledgement and no override path, which agrees with constitution rule 2 —
a BLOCK_HARD gate has no override, enforced by the absence of a permission
rather than by a runtime check.

The critical-exception *state* is still named and reported, because a manager
is entitled to see which patient-safety item is holding the door. Nothing lets
them through it: the gate is tested against Clinic Manager, Clinic Head and
Owner Director, and refuses all three.

---

## The sixteen, grouped by who is actually doing them

Priorities are the matrix's own: **PS** patient safety · **C** critical ·
**I** important. Owners in **bold** are the matrix's; `INFERRED` is mine and
needs your word, exactly as the seven "Assigned Staff" rows did at opening.

### The patient is finished — Reception and the doctor

| ID | Control | Owner | Pri |
|---|---|---|---|
| CLOSE‑001 | Remaining patients checked — no patient workflow pending | **Reception** | C |
| CLOSE‑002 | Clinical notes checked — no required notes pending | **System / Doctor** | C |
| CLOSE‑003 | Follow‑ups generated — all applicable | **System** | C |

CLOSE‑002 and CLOSE‑003 are already enforced: the day cannot end with a
clinical note unwritten, and follow‑ups are generated as consequences rather
than remembered.

### The instrument loop — the one that cannot be fudged

| ID | Control | Owner | Pri |
|---|---|---|---|
| CLOSE‑004 | Instruments collected — no dirty instruments left | **Assistant** | PS |
| CLOSE‑005 | Sterilization complete — same day | **Assistant** | PS |
| CLOSE‑006 | Sterile instruments stored — correctly | **Assistant** | PS |

The matrix's rule, verbatim: **"Used today + sterilization incomplete at
closing = RED EXCEPTION"**, target **Same‑Day Sterilization = 100%**.

**CLOSE‑005 as written is superseded.** The owner ruled that the morning run
catches yesterday's instruments, so "same day" is not the standard and 100% is
not the target — the arithmetic above shows it never could be. CLOSE‑004
(nothing dirty left out) is covered by the operatory close‑down; CLOSE‑006 is
the morning's job. Queued as a matrix correction rather than edited, since the
matrix is frozen.

### The premises — Housekeeping

| ID | Control | Owner | Pri |
|---|---|---|---|
| CLOSE‑007 | Biomedical waste — managed to protocol | `INFERRED` **Housekeeping** (matrix: "Assigned Staff") | PS |
| CLOSE‑008 | Chairs cleaned — all rooms | **Assistant** | C |
| — | Floors — the 3‑bucket technique, second pass of the day | `INFERRED` **Housekeeping** | — |
| — | Fumigation — daily, end of day, room closed ≥ 1 hour | `INFERRED` **Housekeeping** | — |

CLOSE‑008 is **per operatory**, like the morning — four blocks from the
master, not one.

### Shutting down — who?

| ID | Control | Owner | Pri |
|---|---|---|---|
| CLOSE‑009 | Consumables replenished — ready for next day | **Assistant** | I |
| CLOSE‑010 | Equipment shutdown — per equipment protocol | `INFERRED` **Senior Assistant** (matrix: "Assigned Staff") | C |
| CLOSE‑011 | AC / lights / fans — unnecessary utilities OFF | `INFERRED` **Housekeeping** | I |
| CLOSE‑012 | Water pump — OFF / status verified | `INFERRED` **Housekeeping** | I |

CLOSE‑010 is inferred to the Senior Assistant to mirror the morning equipment
round, which you assigned to the head assistant. Say if shutdown is different.

### Tomorrow — Reception and the manager

| ID | Control | Owner | Pri |
|---|---|---|---|
| CLOSE‑013 | Lab cases reviewed — pending / due identified | **Reception / Assistant** | I |
| CLOSE‑014 | Tomorrow's cases reviewed — special requirements identified | **Reception / Manager** | C |
| CLOSE‑015 | Clinic secured — final security check | `INFERRED` **Reception** (matrix: "Assigned Staff") | C |
| CLOSE‑016 | Day closed — critical exceptions acknowledged | **Manager** | C |

CLOSE‑016 was drafted as an acknowledgement gate. The owner ruled against an
acknowledgement, so it is not built as one: the day closes when the drill is
done, and a critical exception refuses rather than being signed off. Also
queued as a matrix correction.

### Not in the matrix, but in your KPIs

**Daily revenue reconciliation.** Listed under Clinic Opening & Closing
Discipline in the KPIs with no matching CLOSE‑ control. The closing drill
supplied it: End‑of‑Day Payment Reconciliation and Daily Report Submission,
both Reception. Built as the `PAYMENTS` and `REPORT` blocks.

---

## The shape, mirroring the morning

```
CLOSE-016  Day closed  ─────────────────────────────  Manager
   ↑ calculated, never ticked — same as ROOMS_READY

   patient      instruments        premises        shutdown      tomorrow
   ─────────    ───────────        ────────        ────────      ────────
   001 002 003  004 005 006        007 008×N       010 011       009 013 014
   Reception    Assistant          Housekeeping    012 015       Assistant
   Doctor       Sterilization      + Assistant     Hskpg/Recn    Reception
```

Same three properties as the morning:

1. **Calculated, not ticked.** `CLINIC_LOCKED` refuses until every block is
   reported. No acknowledgement, no override — the owner's ruling.
2. **Per‑operatory blocks come from the master.** Four rooms, four blocks.
3. **The refusal names the thing.** *"The waste bins are not closed and the
   logbook is not written"*, never *"3 items outstanding"*.

---

## Settled

| Question | Ruling |
|---|---|
| Refuse, or acknowledge? | **Keep refusing at lockup.** No override path. |
| Same‑day sterilisation? | **No — the morning run catches yesterday's instruments.** Closing refuses only on a cycle that ran and was never released. |
| Total closing minutes | **30**, from the moment the clinic shuts |
| Instrument cut‑off | Not needed — superseded by the morning‑run ruling |
| Daily revenue reconciliation | A closing control, Reception. Built. |
| Fumigation | Daily at end of day. Not the long pole: the hour the rooms stay shut is spent with nobody in the building. |
| Is there a closing document? | Yes — supplied, and this is built from it. |
| The four controls with no home | **Add them to the drill.** Two blocks and one fold; no extra minutes. |

## The four that had no home, and how they were added

Four matrix controls had no place in the drill, and three of the four were
"get ready for tomorrow" work — the drill was thorough about shutting the
building down and silent about handing the day on. The owner's instruction was
to add them. They became **two blocks and one fold**, not four blocks:

| Control | | Where it went |
|---|---|---|
| `CLOSE-009` | Consumables replenished — ready for next day | `RESTOCK`, Dental Assistant — the same hands that just cleared the trays, in the same rooms |
| `CLOSE-013` | Lab cases reviewed — pending / due identified | `TOMORROW`, Reception |
| `CLOSE-014` | Tomorrow's cases reviewed — special requirements identified | `TOMORROW`, Reception — one sit‑down, not two: you cannot review tomorrow's list without noticing which case is at the lab |
| `CLOSE-012` | Water pump — OFF / status verified | folded into `ENVIRONMENT` — same protocol section, same hands as the fans and ACs, and one switch does not earn its own block in a thirty‑minute drill |

The fold is named in the block's own refusal sentence — *"…the water pump…"* —
so it reaches the person doing the round rather than being covered on paper and
dropped in the building. `UNCOVERED_CLOSING_CONTROLS` is now empty, and a test
asserts that rather than the prose claiming it.

## Still open

**Two matrix corrections queued**, since the matrix is frozen: `CLOSE-005`
("Sterilization complete — same day") no longer states the standard, and
`CLOSE-016` is not an acknowledgement gate.

---

## The sixteen controls, traced

Seven of the matrix's owners read *"Assigned Staff"*, which is not an owner.
Each is now traced to the section of the closing drill that contains the work —
the drill assigns owners per protocol, so the owner falls out of which protocol
the control belongs to. **A derivation, not an inference**, and checked by a
test rather than believed: `CLOSING_CONTROLS` in `closing.ts`.

| Control | Covered by | From |
|---|---|---|
| `CLOSE-001` Remaining patients | governance | `CLINIC_LOCKED` refuses on an unfinished visit |
| `CLOSE-002` Clinical notes | governance | refuses on an unwritten note |
| `CLOSE-003` Follow-ups | governance | the day-after call is a consequence of finishing treatment |
| `CLOSE-004` Instruments collected | `OPERATORY_CLOSED` | Operatory Closing (a) |
| `CLOSE-005` Sterilization same day | *the morning* | superseded by the morning-run ruling |
| `CLOSE-006` Sterile instruments stored | *the morning* | storage follows the morning release |
| `CLOSE-007` Biomedical waste | `WASTE` · **Housekeeping** | BMW Closing Protocol |
| `CLOSE-008` Chairs cleaned, all rooms | `OPERATORY_CLOSED` | Operatory Closing (b), per room |
| `CLOSE-009` Consumables replenished | `RESTOCK` · **Dental Assistant** | *added* — not in the drill |
| `CLOSE-010` Equipment shutdown | `OPERATORY_CLOSED` · **Dental Assistant** | Operatory Closing (d, e) |
| `CLOSE-011` AC / lights / fans | `ENVIRONMENT` · **Housekeeping** | Clinic Environment Closing (d) |
| `CLOSE-012` Water pump | `ENVIRONMENT` · **Housekeeping** | *added* — folded into the same round |
| `CLOSE-013` Lab cases reviewed | `TOMORROW` · **Reception** | *added* — not in the drill |
| `CLOSE-014` Tomorrow's cases | `TOMORROW` · **Reception** | *added* — not in the drill |
| `CLOSE-015` Clinic secured | `SECURITY` · **Reception** | Security & Lockdown Protocol |
| `CLOSE-016` Day closed | governance | `CLINIC_LOCKED` is the day closing |

### CLOSE-010 was one row and is three jobs

The matrix had a single "Equipment shutdown". The drill splits it across three
protocols with three different owners:

- **the dental light, compressor and suction** — Operatory Closing (d, e),
  Dental Assistant, once per room
- **the chairs raised and electricity off** — Clinic Environment (a),
  Housekeeping
- **the board, non-critical points off** — Security & Lockdown (c), Reception

All three are covered. The matrix row was simply coarser than the clinic.

### Floors, which turned out to have two owners

The morning's 3-bucket floors are Housekeeping. At closing the **operatory**
floor is mopped inside the Operatory Closing Protocol (g) — so it belongs to
whoever closes the room down, not to housekeeping. The general floors stay with
housekeeping under Clinic Environment. Two owners, and the drill says which is
which.
