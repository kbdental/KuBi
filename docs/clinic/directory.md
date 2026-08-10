# The clinic day — directory

Everything KuBi holds about **clinic readiness (opening)** and **clinic
closing**, in one place, with the stakeholder against each item — so the gaps
can be seen and filled rather than remembered.

Generated against the built system on 2026‑08‑10, not written from intent.
Every block, owner and event below is read out of `readiness.ts` and
`closing.ts`; if the code changes and this document does not, the tests that
assert these lists fail.

- **Morning:** 9 blocks, 8 mandatory · 50 minutes, or 75 when the autoclave
  is the long pole
- **Evening:** 11 blocks, all mandatory · 30 minutes from the moment the
  clinic shuts
- **Matrix controls traced:** 12 opening, 16 closing
- **Uncovered:** 7 opening, 0 closing ← *this is the section to read*

---

## 1 · Stakeholders

Seven roles touch the day. Roles, never names — *"names can change but roles
do not change"*. The log still records which employee did what; that is
provenance, not the interface.

| Role | Morning | Evening |
|---|---|---|
| **Dental Assistant** | 4 operatories (15 min each) · stock, as required | 4 operatories · restock for tomorrow |
| **Senior Assistant** *(head dental nurse / head assistant)* | the equipment round — **only they may report it** | may stand in on the rooms |
| **Sterilization Technician** | the morning run — 75 min to cooling | — |
| **Housekeeping** | floors, pantry, washroom — 45 min | bio‑medical waste · clinic environment and fumigation |
| **Reception** | the waiting and billing area | takings · daily report · tomorrow's list · lockdown and key handover |
| **Clinic Manager** | — | locks the day (`CLINIC_LOCKED`), which is refused until the drill is done |
| **Treating Doctor** | — | clinical notes, via the governance gate on lockup |

**Enforced, not advisory.** A role that does not own a block cannot report it —
the server refuses, in the person's own words: *"Cleaning the floors and shared
areas is not your part of the morning."* This was found live: an assistant
recorded housekeeping's floors and the clinic accepted it, which turned the
whole readiness calculation into a formality.

Senior Assistant counts as an assistant for rooms and stock, and **nowhere
else** — the equipment round is theirs alone, and releasing a sterilisation
batch stays a separation‑of‑duties gate so nobody releases their own work.

---

## 2 · Clinic readiness — the morning

**50 minutes** for everything but the autoclave; the sterilisation cycle is
**75 minutes to cooling** and runs alongside. The clinic is ready when the
longer path finishes, so the start time is the first appointment minus the long
pole — never the sum of the blocks.

| # | Block | What it is | Owner | Completed by | Minutes | Holds the door |
|---|---|---|---|---|---|---|
| 1 | `OPERATORY:op-1` | Prepare Operatory 1 | Dental Assistant | `OPERATORY_READY` | 15 | ✔ |
| 2 | `OPERATORY:op-2` | Prepare Operatory 2 | Dental Assistant | `OPERATORY_READY` | 15 | ✔ |
| 3 | `OPERATORY:op-3` | Prepare Operatory 3 | Dental Assistant | `OPERATORY_READY` | 15 | ✔ |
| 4 | `OPERATORY:op-4` | Prepare Operatory 4 | Dental Assistant | `OPERATORY_READY` | 15 | ✔ |
| 5 | `STERILE` | Release the morning sterilisation run | Sterilization Technician | `BATCH_RELEASED` | 75 | ✔ |
| 6 | `EQUIPMENT` | Check the equipment | **Senior Assistant only** | `EQUIPMENT_VERIFIED` | in the 50 | ✔ |
| 7 | `COMMON_AREAS` | Clean the floors, pantry and washroom | Housekeeping | `COMMON_AREAS_READY` | 45 | ✔ |
| 8 | `RECEPTION` | Ready the waiting and billing area | Reception | `RECEPTION_READY` | in the 50 | ✔ |
| 9 | `STOCK` | Check stock, as required | Dental Assistant | `STOCK_VERIFIED` | as required | — advisory |

The four rooms are generated from the **operatory master**, so a fifth room is
a row in a table, not a release.

**Per operatory** is fixed at four checks — dental chair, x‑ray, hand
instruments, suction — because *"do not put special instruments and equipments
as they can be taken any where on a movable trolley"*. The trolley kit is the
equipment round instead, checked once for the whole clinic. Buying a second
scanner therefore does not change the shape of anybody's morning.

**Ready is calculated, never ticked.** `ROOMS_READY` is refused by governance
until every block underneath it has actually been reported. Nobody can assert a
ready clinic; they can only do the work that makes it one.

**Staff entry** (§1 of the opening procedure) is *counted, not gated* — the
protocol gates each **person**, and an event in this model carries the role
that recorded it rather than the individual. Counting is honest; refusing would
not be. Recorded as a known limit rather than quietly enforced on a role.

---

## 3 · Clinic closing — the evening

**30 minutes** from the moment the clinic shuts. Shut time is **18:30**, with
exception days at **19:00** — both are data, because a clinic that only knew
18:30 would call every one of those evenings an overrun by the team that
stayed late.

Ordered by owner, not interleaved: two people working at once is what makes
thirty minutes possible.

| # | Block | What it is | Owner | Completed by | Patient safety |
|---|---|---|---|---|---|
| 1 | `OPERATORY_CLOSED:op-1` | Close down Operatory 1 | Dental Assistant | `OPERATORY_CLOSED` | ✔ |
| 2 | `OPERATORY_CLOSED:op-2` | Close down Operatory 2 | Dental Assistant | `OPERATORY_CLOSED` | ✔ |
| 3 | `OPERATORY_CLOSED:op-3` | Close down Operatory 3 | Dental Assistant | `OPERATORY_CLOSED` | ✔ |
| 4 | `OPERATORY_CLOSED:op-4` | Close down Operatory 4 | Dental Assistant | `OPERATORY_CLOSED` | ✔ |
| 5 | `RESTOCK` | Restock the rooms for tomorrow | Dental Assistant | `CONSUMABLES_RESTOCKED` | |
| 6 | `PAYMENTS` | Reconcile the day's takings | Reception | `PAYMENTS_RECONCILED` | |
| 7 | `REPORT` | Send the daily collection report | Reception | `DAY_REPORTED` | |
| 8 | `TOMORROW` | Review tomorrow's list and the lab cases due | Reception | `TOMORROW_REVIEWED` | |
| 9 | `WASTE` | Close the bio‑medical waste | Housekeeping | `WASTE_CLOSED` | ✔ |
| 10 | `ENVIRONMENT` | Close the clinic down and fumigate | Housekeeping | `ENVIRONMENT_CLOSED` | ✔ |
| 11 | `SECURITY` | Secure the premises and hand over the key | Reception | `PREMISES_SECURED` | |

All eleven hold the lockup. **Patient safety** decides which one the manager is
told about *first*, not whether it can be skipped — there is no override path
and no acknowledgement, on the owner's ruling.

**Locked is calculated too.** `CLINIC_LOCKED` refuses on four things in
priority order: an unfinished visit → an unwritten clinical note → an autoclave
cycle that ran and was never released → the closing drill. A manager who left a
cycle unreleased is told about the cycle, not about the bins.

**Same‑day sterilisation is not reachable and the arithmetic says so.** Cycle
75 min, team leaves 30 min after shut: the last collection that could be stored
today is 17:45 — forty‑five minutes *before* the clinic shuts. The owner's
ruling: **the morning run catches yesterday's instruments**, and the safety net
sits at opening, where the clinic cannot be called ready until a run is
released. A batch waiting overnight is the normal end of a day.

**Staff exit** is counted and not gated, for the same reason as staff entry.

---

## 4 · The events

The morning and evening write 19 of the 47 event types. Past tense throughout,
enforced by a test — an event records what happened, never what should.

**Morning:** `STAFF_READY` · `OPERATORY_READY` · `EQUIPMENT_VERIFIED` ·
`STOCK_VERIFIED` · `RECEPTION_READY` · `COMMON_AREAS_READY` · `BATCH_RELEASED`
· `ROOMS_READY` *(governed)* · `CLINIC_UNLOCKED`

**Evening:** `OPERATORY_CLOSED` · `CONSUMABLES_RESTOCKED` ·
`PAYMENTS_RECONCILED` · `DAY_REPORTED` · `TOMORROW_REVIEWED` · `WASTE_CLOSED` ·
`ENVIRONMENT_CLOSED` · `PREMISES_SECURED` · `STAFF_LEFT` · `CLINIC_LOCKED`
*(governed)*

The log is **append‑only by database grant** — `UPDATE`, `DELETE` and
`TRUNCATE` are revoked from the application's own role, so a corrected mistake
is a new event and never an edited one. Proven against a live restart and a
`kill -9`.

---

## 5 · The gaps

### 5a · Opening — seven matrix controls nothing covers

Six of the seven are **one thing wearing six matrix rows: opening the
building.** Neither source document has that section. The closing drill has its
exact mirror image — Clinic Environment Closing switches all of it off — and
the opening procedure begins with people already inside a working building. The
clinic plainly does this work every morning; KuBi has no block for it and
nobody has said whose job it is.

| Control | What it is |
|---|---|
| `OPEN-001` | Open the second‑floor clinic |
| `OPEN-007` | ACs at 24 °C |
| `OPEN-008` | Air diffuser |
| `OPEN-009` | Water availability |
| `OPEN-010` | **Water pump** — *"starting the water pump is a task of opening"* |
| `OPEN-011` | Lights and fans |

**The seventh is not one of that cluster and should not be filled like one:**

| Control | What it is |
|---|---|
| `OPEN-012` | **Morning emergency readiness** — the emergency kit, the drugs and their expiry dates, the oxygen |

`OPEN-012` is patient safety, and it is missing from the matrix's detail, from
the opening procedure, and from every block. It is the most serious gap on this
page.

### 5b · Documents still owed

| | |
|---|---|
| *K. B. Dental Hand Hygiene Protocol* | *"will provide later"* — the staff‑entry gate (ENT‑03, 20‑second handwash) has no standard behind it |

### 5c · Conflicts between two statements in the opening procedure

Neither can be resolved by reading harder; both statements are in the document.

| | Conflict |
|---|---|
| 1 | **Reception floor agent** — the 3‑bucket technique says **Virulex**; the reception paragraph says **1 % sodium hypochlorite** |
| 2 | **Eye shield** — PPE says disinfect and reuse; BMW says red bin as contaminated plastic. Both can be true only if these are two different items |
| 3 | **Needles** — the formalin chamber lists needles; BMW puts needles in the white sharps box, never recapped. Sterilising and discarding the same item cannot both be the rule |
| 4 | **Fumigation cadence** — *"once every day"* and *"on a holiday or end of the day"* are not the same schedule |

### 5d · Ordering the documents do not state

| | |
|---|---|
| 5 | Floors before surfaces, or after? |
| 6 | Equipment check before the sterilisation run, or after? The autoclave is checked in §3 and used in §7 |
| 7 | Where does the chemical route run? The 16 steps end in an autoclave; the chemical‑route instruments presumably go to the formalin chamber, but no sequence is given |

### 5e · One model limit, raised rather than worked around

| | |
|---|---|
| 8 | **Per‑patient sterilisation has one owner and you have named two.** The flow gives each step a single owning role, so the turnover run shows as the technician's even when a dental assistant does it. Nothing is refused — role ownership is enforced only on the readiness and closing blocks — but the *displayed* owner is narrower than the clinic. Widening it means letting a node have two owners, which changes the frozen model |

---

## 6 · Matrix corrections queued

The matrix is frozen at v2.0, so these queue for v3.0 rather than being edited.

| Control | Correction |
|---|---|
| `CLOSE-005` | *"Sterilization complete — same day"* is not reachable at these hours and no longer states the standard |
| `CLOSE-012` | Water pump is filed under closing; **starting** it is an opening task |
| `CLOSE-016` | Drafted as a manager acknowledgement gate; it is not one — the day closes when the drill is done |

---

## 7 · Settled, so it is not reopened by accident

| Question | Ruling |
|---|---|
| How many operatories? | **Four, from a master** — a fifth is a row, not a release |
| Sterilization Technician vs Dental Assistant | Technician owns the morning run; either does the per‑patient runs |
| Who owns each block? | Rooms and stock → Assistant (or Senior) · equipment round → **Senior only** · waiting and billing → Reception · floors → Housekeeping · morning run → Technician |
| Two unknown durations | The equipment round and the waiting area *"happen in that 50 min"* — no clock of their own, which is different from unknown |
| Is the first appointment the target? | **Yes.** A day with nothing booked reports no target rather than an invented one |
| Total readiness minutes | **50**, excluding the sterilisation cycle |
| Total closing minutes | **30**, from the moment the clinic shuts |
| Clinic shut time | **18:30**, exception days **19:00** — both data |
| Refuse, or acknowledge, at lockup? | **Keep refusing.** No override path |
| Same‑day sterilisation? | **No** — the morning run catches yesterday's instruments |
| Fumigation | Daily at end of day. Not the long pole — the hour the rooms stay shut is spent with nobody in the building |
| Names in the interface? | **Roles only** |
