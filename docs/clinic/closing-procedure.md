# Clinic closing — the structure

Built the same way as `opening-readiness.md`: your controls restructured so
they can be counted, sequenced and checked.

**Status: built and running**, against the owner's *Clinic closing drill*
supplied 2026‑08‑08. Seven sections, nine blocks, enforced server‑side.

Sources: the owner's closing drill (the seven protocols), the activity matrix
sheet 15 (`CLOSE-001`–`CLOSE-016`), and the closing items in the
infection‑control document.

## The nine blocks, from the seven protocols

| Block | Protocol | Owner | Critical |
|---|---|---|---|
| `OPERATORY_CLOSED` × 4 | Operatory Closing (a–g) | Dental Assistant | ✔ |
| `PAYMENTS` | End‑of‑Day Payment Reconciliation (a–f) | Reception | |
| `REPORT` | Daily Report Submission (a–b) | Reception | |
| `WASTE` | BMW Closing (a–e) | Housekeeping | ✔ |
| `ENVIRONMENT` | Clinic Environment Closing (a–g), incl. fumigation | Housekeeping | ✔ |
| `SECURITY` | Security & Lockdown (a–h) | Reception | |

`STAFF_LEFT` counts people out through the End‑of‑Day Staff Protocol —
reported, not enforced, the same limit as staff entry.

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

So closing has **three** states, not two:

| | |
|---|---|
| **Clear** | every control passed. Lock up. |
| **Closing with critical exception** | something patient-safety is unresolved. The clinic still closes — people go home — but a manager must acknowledge it, by name, and it becomes tomorrow's first item. |
| **Not closable** | *(does this exist?)* — see question 1 |

**This contradicts what KuBi does today.** `CLINIC_LOCKED` currently *refuses*
outright when instruments are still in the loop, and Scenario 10 tests exactly
that refusal. The matrix says acknowledge, not refuse. Both are defensible and
I have not picked between them — see question 1.

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

Note the tension with your own timing: the cycle takes **75 minutes to
cooling**. A batch collected at 18:30 is not stored by 19:00. So either the
last collection has a cut‑off, or CLOSE‑006 is routinely the red exception —
see question 3.

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

CLOSE‑016 is the acknowledgement gate, not a tick. It is the only control that
exists *because* something may have gone wrong.

### Not in the matrix, but in your KPIs

**Daily revenue reconciliation.** You listed *"Daily Revenue Reconciliation
Accuracy (Quality)"* under Clinic Opening & Closing Discipline, and there is no
CLOSE‑ control for it. Reception, at closing — but it needs adding, and it is
question 4.

---

## The shape, mirroring the morning

```
CLOSE-016  Day closed  ─────────────────────────────  Manager
   ↑ calculated, never ticked — same as ROOMS_READY

   patient      instruments        premises        shutdown      tomorrow
   ─────────    ───────────        ────────        ────────      ────────
   001 002 003  004 005 006        007 008×N       009 010       013 014 015
   Reception    Assistant          Housekeeping    Snr Asst      Reception
   Doctor       Sterilization      + Assistant                   Manager
```

Same three properties as the morning:

1. **Calculated, not ticked.** `CLINIC_LOCKED` refuses until the blocks are
   reported — or, if you take the matrix's design, until they are reported *or*
   a manager has acknowledged the exception.
2. **Per‑operatory blocks come from the master.** CLOSE‑008 is four blocks
   because you have four rooms.
3. **The refusal names the thing.** *"Operatory 3 has not been cleaned"*,
   never *"3 items outstanding"*.

---

## What I need from you

1. **Refuse, or acknowledge?** The matrix says a critical exception is
   acknowledged by a manager and the clinic closes anyway. KuBi today refuses
   outright. My view: the matrix is right, because the clinic physically closes
   whether or not KuBi agrees, and a log that says the day never ended is a log
   that has stopped being true. But it changes Scenario 10, so it is your call.
   *(If acknowledge: does the acknowledgement need a reason typed in, and does
   it become tomorrow's first item?)*

2. **The seven `INFERRED` owners** above — waste, utilities, water pump,
   security, equipment shutdown, floors, fumigation.

3. **How long does closing take, and when does it start?** Opening works
   backwards from the first patient. Closing presumably works backwards from a
   target lock‑up time. Two numbers would do it: **total closing minutes**, and
   the **cut‑off after which instruments are not collected** — because 75
   minutes to cooling means a late batch cannot be stored the same day, and
   CLOSE‑005/006 would fail every evening for a reason nobody can fix.

4. **Daily revenue reconciliation** — a closing control? Who, and what makes it
   pass?

5. **Fumigation.** Your document says both *"once every day"* and *"on a
   holiday or end of the day"*, and the room stays closed an hour afterwards.
   If it is daily at close, it is the last thing anybody does and nothing can
   follow it — which makes it the closing equivalent of the sterilisation
   cycle: the long pole that decides when closing must start.

6. **Is there a closing document** like the opening one? If so this structure
   should be measured against it before anything is built, the same way the
   opening structure was.
