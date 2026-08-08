# Clinic opening readiness — as it actually runs

Source: the owner's *Staff Entry & Personal Hygiene Protocol* + *Clinic
Preparedness* + *Sterilization and Disinfection Equipments and Protocols*,
supplied 2026‑08‑08.

**Status: the readiness model is built and running.** Everything under
"Answered" below is in the engine, the database and the API, with tests. The
open questions further down are still open and nothing has been guessed to
close them.

## Answered by the owner, 2026‑08‑08

| Question | Answer | Where it lives now |
|---|---|---|
| How many operatories? | **Four** — *"but you will have to make a master to decide the number"* | `operatories` table, migration 0022. The number is a row count; nothing in the code says four. |
| What is in each? | Dental chair, x‑ray, hand instruments, suction. *"do not put special instruments and equipments as they can be taken any where on a movable trolley"* | Four columns on the master, all true for this clinic |
| The special equipment? | Still checked — *"as a task for dental assistant as she is the one who checks the working"* | One `EQUIPMENT` block owned by the assistant, not four per‑room ones |
| How long? | **15 minutes** per operatory | `OPERATORY_MINUTES`. Every other block carries `null`, because no other duration was stated |
| Five steps or sixteen? | *"it is called the 5 step protocol, 16 as a number is sub steps"* | Recorded; the five headline steps are still needed |
| How to measure readiness | *"i leave it upto you to decide how to check"* | Opening‑checklist compliance as a share of blocks, and first‑patient readiness vs target as a signed variance |

Everything below is the owner's document restructured so it can be counted,
sequenced and checked — not a new design. Where the document does not say who
does something, the Owner column reads **`INFERRED`** and needs confirming.
Where the document says two things, it is marked **`CONFLICT`** and is left
unresolved rather than picked between.

---

## What this changes about what we held

The activity matrix had the *headings* for the morning. This document has the
*work*.

| Matrix row | What it said | What this document says it is |
|---|---|---|
| `OPEN-003` Treatment room readiness | one checklist row | **24 disinfection actions per operatory**, then 6 items wrapped in cling film |
| `OPEN-002` Reception readiness | one checklist row | **15 items** — 9 touchpoints plus forms, paper, shoe covers, DVR, UV |
| `HK-001` Treatment-room cleaning | one checklist row | 3‑bucket floor technique, morning **and after every patient** |
| `OPEN-004/005/006` chair, suction, compressor | 3 checks | **10 equipment checks**, one with a 5‑minute warm‑up wait |
| — | absent entirely | **staff entry hygiene**, a per‑person gate before anything |
| — | absent entirely | **the morning sterilization run** — 16 steps ending in an autoclave |
| — | absent entirely | inventory verification (12 lines), BMW, fumigation |

Conversely, the matrix holds six things this document does not mention:
`OPEN-001` open second‑floor clinic, `OPEN-007` AC at 24 °C, `OPEN-008` air
diffuser, `OPEN-009` water availability, `OPEN-010` water pump, `OPEN-011`
lights/fans, `OPEN-012` morning emergency readiness. **Neither document is the
whole morning on its own.**

---

## 1 · Staff entry — a gate on each person, not on the clinic

*"To be completed before any clinical or administrative activity begins."*

This is structurally unlike everything else we hold. It is not a clinic state;
it is a per‑person state, and it gates that person's ability to do any task at
all — including reception work.

| ID | Item | Owner | Notes |
|---|---|---|---|
| ENT‑01 | Commute in regular clothing | Every person | |
| ENT‑02 | External footwear off; clinic slippers on | Every person | at the door |
| ENT‑03 | Handwash, soap and water, **≥ 20 s**, all surfaces | Every person | *K. B. Dental Hand Hygiene Protocol* — **we do not have this document** |
| ENT‑04 | Alcohol‑based hand sanitizer | Every person | after ENT‑03, not instead of |
| ENT‑05 | Change into uniform + 3‑layer surgical mask + head cap | Every person | |
| ENT‑06 | Fresh laundered uniform each day | Every person | daily, no exception |
| ENT‑07 | Gloves on before any cleaning task | Janitor / Housekeeping | the one role the document names explicitly |
| ENT‑08 | Personal belongings — bags, wallets, keys, phones — **90 s** in UV cabinet | Every person | stated at §2.2 G; belongs here in practice |

---

## 2 · Operatory preparation — 24 actions, **per operatory**

Owner: `INFERRED` **Dental Assistant**. The document heads §2 with *"Designated
staff responsible for complete Cleaning, Disinfection, and Sterilization"* and
never names them.

Agent throughout: alcohol‑based disinfectant (Bacilol or equivalent).

**A · Dental chair — 11**

1. Instrument tray · 2. Chair upholstery (seat) · 3. Patient headrest ·
4. Patient armrest · 5. Dental light handle · 6. Spittoon tray and metal/plastic
tube · 7. **Suction filter** — remove from casing, clean under running water,
disinfect, and clean the casing interior · 8. All surfaces of the doctor's stool ·
9. External surfaces of every handpiece tube (air‑rotor, air motor, scaler,
suction, three‑way syringe) · 10. **Cling‑film wrap after disinfection**:
instrument tray, patient armrest, headrest, light handle, three‑way syringe,
suction tube · 11. Booster bottle filled with distilled water

**B · Other operatory surfaces — 5**

Countertops (everything into drawers — *nothing left on the countertop*) ·
drawers and handles · operatory door and handles · partition between
operatories · laptop/desktop, keyboard, mouse — **keyboard wrapped in cling film
after disinfection**

**C · Equipment — 8**

Portable RVG unit, sensor and cable (**all surfaces except the sensor wrapped**) ·
lead aprons and thyroid collar · intraoral camera/scanner (no seepage into the
sensor) · instrument trolley exterior · motorised suction exterior · aerosol
suction device (**used for all AGPs, operated within 23 cm of the field**) ·
day‑to‑day articles into the **UV chamber** · **formalin chamber on each
operatory slab, 4–6 tablets**

> **Order matters and is stated:** disinfect *then* wrap. Six chair items, the
> keyboard, and the RVG unit are wrapped — that is a second pass, not part of
> the first.

---

## 3 · Waiting & billing area — 15

Owner: `INFERRED` **Receptionist**, with `INFERRED` **Housekeeping** for the
surfaces. Maps to `OPEN-002`.

**Touchpoints (9):** side table with flower pot · all tables and countertops ·
coffee machine · sofas and chairs · main entry wood and glass door + handle ·
TV, AC, fridge + remotes · printer, card machine, landline · cabinets, drawers
and handles · water available as disposable bottles on request

**Preparation (6):** demarcated "Used" shoe‑cover bin, lidded, foot‑operated,
with the dispenser box stocked · A4 paper pre‑loaded for the whole day ·
new registration forms stocked in the drawer for the whole day · old forms
scanned and filed **immediately** (UV chamber available for forms) · DVR, fire
alarm/cylinder and DVD player function‑checked in the morning *specifically to
avoid touching them during the day* · personal belongings 90 s UV → moved to
ENT‑08

---

## 4 · Pantry (4) and washroom (4)

Owner: `INFERRED` **Housekeeping**.

**Pantry:** countertops · refrigerator · induction/LPG stove · cleaning waste
into the **black bin** (lidded, foot‑operated)

**Washroom:** washbasin and taps · faucets and jet spray · door and handle ·
refill soap dispenser and tissue

---

## 5 · Equipment readiness — 10 checks, before first patient

Owner: `INFERRED` **Dental Assistant**. Maps to `OPEN-004/005/006`.

| # | Check | Pass test | Existing |
|---|---|---|---|
| 1 | Dental chair | back, up/down, headrest all move | `OPEN-004` |
| 2 | Dental light | bulb lights | new |
| 3 | Compressor | on, **5 min warm‑up**, pressure gauge read | `OPEN-006` |
| 4 | Suction unit | suction strength | `OPEN-005` |
| 5 | Ultrasonic scaler | activates | new |
| 6 | RVG / X‑ray | power and connectivity | new |
| 7 | Intraoral camera | captures an image | new |
| 8 | Autoclave | water level and heating | new |
| 9 | Ultrasonic cleaner | solution level | new |
| 10 | UV cabinets | UV activates | new |

Plus: any fault logged in the **Equipment Fault Register** and the **Clinic
Manager notified**; backup instruments confirmed for every critical procedure.

> The 5‑minute compressor warm‑up is a real wait — the morning has to start it
> early enough, not merely tick it.

---

## 6 · Inventory verification — 12 lines, before first patient

Owner: `INFERRED` **Dental Assistant** (checking), **Clinic Manager**
(purchase requests).

Gloves (exam + surgical) · 3‑layer surgical and N95 masks · head caps · cling
film · patient drapes/bibs · cotton, gauze, dressing packs · anaesthetic
cartridges and needles · suction tips and saliva ejectors · sterilization
pouches · autoclave distilled water · Bacilol · hand sanitizer

At or below minimum → **Purchase Request to the Clinic Manager, immediately**.

**§4c is a dependency, not a stock check:** *sterilized instrument packs
available in UV cabinets, sufficient for the day's appointments.* That cannot
pass until the morning sterilization run (§7) has finished — and "sufficient
for the day's appointments" means it is a function of the booked list, not a
fixed number.

---

## 7 · The morning sterilization run — 16 steps

Owner: `INFERRED` **Sterilization Technician**. The document says *"All Dental
Assistants"* and *"the team in‑charge"*; the owner has named a Sterilization
Technician as a distinct person. **This needs settling.**

Runs **twice**: once in the morning before patient arrival, and again after
each patient.

PPE first: disposable gown, face mask, household gloves; then handwash,
sanitizer, and **heavy‑duty gloves against sharps injury**.

| Step | Action | Measured value |
|---|---|---|
| 1 | Non‑foaming neutral detergent | **pH 5–9**, measured detergent to measured water. **Not washing liquid** |
| 2 | Nylon brush | **not** green pads or wire brushes |
| 3 | First wash under running water | |
| 4 | Fill tub, lukewarm | **< 35 °C** — warmer coagulates proteins and prevents their removal |
| 5 | Fully immerse, wash by hand, **avoid scrubbing** (reduces aerosol), disassemble multi‑part tools, final rinse warm | |
| 6 | Dry | prevents carryover of polluted water |
| 7 | Soak in pre‑formed soapy solution | **15 min**, then scrub‑wash |
| 8 | Wash under running water | all remnants removed |
| 9 | Re‑check handles, tips, drills under **magnifying glass with light**, dry | |
| 10 | Ultrasonic cleaner | **5–10 min** · **950 ml distilled water + 50 ml Korsolex** |
| 11 | Wash with warm distilled water | |
| 12 | Inspect; any hand scrubbing done **under warm water** | reduces aerosol |
| 13 | Dry with clean towel | |
| 14 | Pack in pouches, seal all open ends; **write date + initials/signature on the back** | ← *decontamination ends here* |
| 15 | Autoclave | **121–131 °C**, to kill spores |
| 16 | Remove with gloved hands and **Chitel forceps**; store in UV cabinets and drawers | |

**Storage standard:** dust‑proof, spacious enough to rotate so the earliest
sterilized is used first, not moist, and items not crushed, bent or punctured.

**Sterilization room surfaces** also disinfected: countertops; autoclave,
ultrasonic cleaner, sealing machine, water distiller, needle cutter; all
cabinets, UV cabinets, drawers and handles; the glass door and handle.

**The document's own failure modes:** inadequate preparation before
decontamination · improper packaging, loading and positioning · failure to time
the cycles · loss of orderly, incremental method.

### Which instruments take which route

| Chemical | Heat (autoclave) |
|---|---|
| Plastic spatulas | All burs and bur changers |
| Glass and rubber dappen dishes | Air‑water syringe tips |
| Vinyl/glass objects not for disposal | High‑volume evacuator tips |
| Mirrors for intra‑oral photography | All surgical appliances and tools |
| Cheek retractors | Metallic impression trays |
| Intra‑oral scan abutments | All stainless steel, tungsten carbide, Teflon‑coated tools |

---

## 8 · Floors

Owner: `INFERRED` **Housekeeping**.

**3‑bucket technique:** detergent + warm water in one, plain water in one,
**Virulex** in the third. Mop with detergent solution → rinse mop in plain water
and squeeze → mop again with Virulex after drying → work **from the far corner
towards the door**.

- Operatory floor: **once in the morning, then after every patient**
- Waiting, billing, doctor's room, pantry, washroom: **minimum twice a day**
- **No broom sweeping** — aerosol
- Mop care: hot water and detergent, disinfect with Virulex, dry upside‑down

**Fumigation:** daily, with Germishield (Virex II), **50 ml in 950 ml water**
covers 2–3 surgeries; room stays **closed ≥ 1 hour** afterwards. Alternative:
10 % formaldehyde 5–10 ml with potassium permanganate.

---

## 9 · Bio‑medical waste

All bins puncture‑proof, lidded, foot‑operated, bio‑hazard symbol, non‑chlorinated
bags labelled compostable/biodegradable with manufacturer name, registration
number and thickness.

| Bin | Contents |
|---|---|
| **Yellow** — contaminated non‑plastics | extracted teeth and tissues; blood/saliva‑contaminated cotton, gauze, linen, paper; discarded medicines |
| **Red** — contaminated plastics | gloves, face mask, gown, eye shield, suction tip, syringes, IV set |
| **Blue sharps** — glass | vial, ampule, slide and coverslip, implant |
| **White sharps** — metals | needles, blades, wire/arch bar/band/bracket, burs, endodontic instruments, cast post/crown |
| **Black** | dental impressions, casts, acrylic prosthesis (no clasp) |

Pre‑treatment of infectious waste: **1 % sodium hypochlorite, 15–20 min**.

**Sharps:** gloves on · 1 % hypochlorite in blue and white boxes, topped up
daily · puncture‑, leak‑ and tamper‑proof · **seal at ¾ full** · **never recap a
needle**.

Collection by the BMW vendor **daily**; a missed collection goes to the **Clinic
Head** for immediate resolution.

---

## 10 · Morning huddle

**10–15 minutes before the first patient.** Clinic Manager facilitates; Doctor
contributes clinical notes. Agenda: the day's schedule · special patients
(anxious, medical alerts, VIPs) · equipment or inventory issues carried from
yesterday · operational updates · recognition of yesterday's achievements.
Action items carry **an owner and a deadline**. Weekly meeting 15–20 min at
week's end.

---

## What has to be settled before any of this is built

### Blocking

1. ~~How many operatories, and what is in each?~~ **Answered** — four, from a
   master. See above.
2. **Sterilization Technician vs Dental Assistant.** The document assigns the
   16‑step run to "all Dental Assistants" and "the team in‑charge"; you have
   named a Sterilization Technician as a separate person. Who owns the morning
   run, and who owns the per‑patient run? *Currently the `STERILE` block is
   owned by the Sterilization Technician, and the release stays with the
   Senior Assistant — an operator may not release their own batch.*
3. **Owners for the remaining blocks — now enforced, so worth confirming.**
   The document names a role only for janitors (§1 g) and Dental Assistants
   (PPE, manual cleaning). What is in force today, and refused if anybody else
   tries: rooms, equipment and stock → **Dental Assistant** (or Senior
   Assistant); waiting and billing → **Reception**; floors, pantry, washroom →
   **Housekeeping**. Correct any of these and it is a one‑line change.
4. **How long does each block take?** 15 minutes for an operatory is now
   known. Still unknown: the waiting area, the shared areas, the equipment
   round, the stock count and the sterilisation run. Everything is anchored
   *before first patient*, so until those exist KuBi can say the morning is
   late but cannot say when it should have started. *(D‑05.)*
5. **The two named documents we do not have:** the *K. B. Dental Hand Hygiene
   Protocol* and the *K. B. Dental Five Step Sterilization Protocol*. Which
   five are the headline steps that the sixteen sit under?
6. **Is the first appointment the right target?** Readiness is measured
   against the day's first booked patient. If the clinic's real target is a
   fixed time — "ready by 09:30 whoever is booked" — that is a different
   measure and a one‑line change. On a day with nothing booked KuBi currently
   reports *no target* rather than inventing one.

### Ordering the document does not state

6. **Floors before or after surfaces?** Floors are cleaned in the morning and
   surfaces are disinfected in the morning, and nothing says which comes first.
7. **Equipment check before or after the sterilization run?** The autoclave and
   ultrasonic cleaner are checked in §3, and used in §7. Presumably checked
   first — but it is not written.
8. **Where does the chemical route run?** The 16 steps end in an autoclave. The
   chemical‑route instruments presumably go to the formalin chamber (§2.1 C
   VIII) — but no step sequence is given for them.

### `CONFLICT` — two statements that disagree

9. **Reception floor agent.** §2.3 a says the 3‑bucket technique uses
   **Virulex**; the reception paragraph says **1 % sodium hypochlorite**. The
   3‑bucket steps then say Virulex. Which agent for reception?
10. **Eye shield — disposable or reusable?** PPE says protective eyewear is
    *"disinfected/sterilised after every use… washed with soap and water and
    sanitised in UV chamber"*. BMW puts **eye shield in the red bin** as
    contaminated plastic. Both can be true only if these are two different
    items.
11. **Needles.** The formalin chamber is listed for *"plastics, syringes,
    needles, scissors…"*, while BMW puts **needles in the white sharps box** as
    discarded metal, never recapped. Sterilizing and discarding the same item
    cannot both be the rule.
12. **Fumigation cadence.** *"Once every day"* and *"on a holiday or end of the
    day"* are not the same schedule.

### Found by building it — two defects, both fixed

15. **Anybody could report anybody's work.** Driving a real morning over HTTP,
    the dental assistant recorded `COMMON_AREAS_READY` — housekeeping's floors
    — and the clinic accepted it. `record()` had never compared the recording
    role against the role that owns the work, for any event. A readiness
    report is somebody's word that they did a thing; taken from the wrong
    person it is worth nothing, and it turns the whole calculation into a
    formality. Now refused, server‑side, with the person's own words back:
    *"Cleaning the floors and shared areas is not your part of the morning."*

16. **A guessed readiness target.** The first version defaulted the first
    appointment to midday when nothing was booked, and duly reported a
    readiness variance against it. The working agreement forbids exactly this:
    *"Never imply a state you do not have — absent appointment data is not a
    guessed first-patient time."* The target is now nullable, and a clinic
    with nobody booked reports no target, no variance and no overdue rather
    than a plausible-looking hour.

### A consequence worth knowing about

17. **Law L‑3's sterile clause can no longer fire.** Seating a patient checks
    that the rooms are ready *and* that a pack has been released. Readiness is
    calculated from a released run among other things, so rooms‑ready now
    implies sterile‑released and the two can never disagree. The clause is
    kept as defence in depth — a patient‑safety law should not depend on a
    projection being right — but the scenario that used to demonstrate it is
    unreachable and now tells the same story correctly.

### Probable transcription errors — flagged, not corrected

13. **Virex II composition** reads *"methyl aluminium Chloride (8.7 %) + Benzyl
    Aluminium Chloride (8.19 %)"*. Quaternary ammonium disinfectants of this
    type are **ammonium** chlorides, not aluminium. Worth checking against the
    product label before it goes into a system staff will follow.
14. **Implant in the blue (glass) sharps box.** Titanium implants would fall
    under the white (metal) box.
