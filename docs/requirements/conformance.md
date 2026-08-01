# Requirements conformance — what the documents ask for vs what exists

Source of truth: `operations-app.docx` (numbered sections 1–8 plus the engines,
roles and closing sections) and `operations-app.xlsx` (Master Activity
Dictionary, sheets A–N). Both are committed alongside this file. Extracted
plain text sits in `operations-app.txt` and `master-activity-dictionary.txt` so
that any claim about a requirement is checkable with grep rather than memory.

This document exists because I previously worked from a compressed recollection
of the Word file and got its most important section wrong. Every row below was
checked against the code, not recalled.

---

## §8 — the operating principle. This is the USP, and I missed most of it.

The document states one fundamental loop:

> **PLAN → TRIGGER → ASSIGN → EXECUTE → PROVE → VERIFY → ESCALATE → MEASURE → IMPROVE**

I had recorded §8 as "four management outcomes: GREEN / AMBER / RED / GREY".
The colours are in §8, but they are its *smallest* claim — the outcome vocabulary
of the loop, not the loop. Building the vocabulary and not the loop is how you
end up with a dashboard that colours things correctly and changes nothing.

| Stage | Status | Where |
|---|---|---|
| PLAN | Built | `ActivityDefinition`, all 22 fields of the final master record |
| TRIGGER | **Partial — 1 of 6 engines** | Time engine only (`scheduler.service.ts`) |
| ASSIGN | Built | doer / checker / owner / escalation, with separation of duties |
| EXECUTE | Built | 7 task states, `ActivityInstance` |
| PROVE | Built | evidence classes E0–E4 |
| VERIFY | Built | `Verification`, checker distinct from doer |
| ESCALATE | Built | `AttentionItem`, L1/L2/L3, risk-weighted |
| MEASURE | Built | parameter scores → Operational Health |
| **IMPROVE** | **Not built at all** | — |

**The loop does not close.** `ActivityDefinition.capaPolicy` exists as a column
and has *zero consumers* anywhere in the codebase — no `Incident` model, no
`Capa` model, no root cause, no corrective or preventive action, no responsible
person, no due date, no verification, no closure. The document is explicit about
why this stage exists:

> This is how your clinic starts learning from failures rather than repeatedly
> correcting them.

Without IMPROVE, KuBi detects the same failure every day and files it identically
every day. It is a line, not a loop. **This is the single largest gap in the
build**, and it is the one that most directly undercuts what §8 says the app is.

The second §8 miss is the drill-down:

> Then clicking Lab 76% should reveal **only the exceptions**: 3 lab cases
> overdue, 1 crown received but QC pending, 2 patients awaiting appointment,
> 1 remake.

The Overview returns aggregate counts (`problems.open`, `patientSafety`,
`overdue`). There is no per-parameter exception list, so a red parameter cannot
be opened to see *what* is red. §6 makes the same demand in different words —
"Management needs to see the exceptions, not 18 green ticks" — as does the role
section: "Everything else stays in the background."

---

## §1–§7, the engines, roles and dictionary

| Requirement | Asked for | Built | Gap |
|---|---|---|---|
| §1 parameters | 15 + CAPA as 16th | 16 | none |
| §2 activity record | 22 named fields | 22 | none |
| §3 five object types | Recurring, Patient-triggered, Condition-based, Compliance gates, Exception/escalation | Recurring + gates + exception | **Patient-triggered and condition-based objects do not exist** |
| §7 KPI rollup | 16 parameters → **~8 management scores** → owner dashboard | 16 → 1 | **the 8-score middle layer is missing** — the owner reads Opening / Clinical / Patient Experience / Infection Control / Lab / Inventory / Equipment / Team, and those eight are not modelled |
| 6 engines | Time, Patient Event, Equipment, Inventory, Compliance, Exception | Time, Exception | **4 missing**, incl. the Compliance engine the doc calls the point where "KuBi becomes significantly more useful than ordinary clinic software" |
| Role views | Assistant, Reception, **Doctor**, Manager, Owner | Assistant, Senior Assistant, Reception, Manager | **no Doctor view** — medical alerts, pending treatment plans, consent status, documentation, scans required, Lab QC |
| Activity IDs | permanent IDs, never changing | `OPN-001`, `CLS-001` | **correct after all** — see the correction below |
| Master Activity Matrix v2.0 | **101 activities, 23 columns, fully populated** | 9 | **~9% seeded** |

### Domain objects the documents specify that do not exist

Lab Cases (sheet K, 17 controls and a 10-state lifecycle) · Sterilization
Batches (sheet L — explicitly "don't manage sterilization as one closing tick",
which is exactly how it is currently built) · Inventory and Implant Inventory
(sheet M) · Equipment/Assets and Maintenance · Incidents · CAPA · Complaints ·
Attendance and Leave · Training & Competency · Consent Records · Follow-ups ·
Patient Protocols · SOP Master.

### Named rules in the dictionary that are not implemented

- **Sheet B**: `OPEN-004` chair check fails → that chair becomes NOT AVAILABLE
  FOR PATIENT ALLOCATION. Equipment state feeding scheduling; no such link.
- **Sheet K**: crown delivery appointment requires Lab Received = YES **AND**
  QC = PASSED, else CASE NOT READY. This is the doc's flagship example, cited
  twice, and it is the one I proposed building next — correctly, but it needs
  the Lab Case object first.
- **Sheet J**: surgery follow-up must capture pain / swelling / bleeding /
  medication rather than a "called" tick, and severe pain + excessive swelling
  must auto-raise CLINICAL REVIEW REQUIRED.
- **Sheet N**: distinguish "Task Completed" from "Clinic Safe to Close";
  closing with an unresolved patient-safety task must show CLOSING WITH CRITICAL
  EXCEPTION and **require manager acknowledgement**. The handover screen shows
  what is outstanding but does not gate or require acknowledgement.
- **Sheet G**: procedure-specific protocol engine — the selected procedure
  determines the required checklist (RCT vs Implant Surgery have different
  mandatory sets). Gates exist generically; procedure-driven gate selection does not.

---

## Honest summary

What is built is the **spine**: a 22-field activity record, seven states, five
evidence classes, four-level responsibility, dependency gates, risk-weighted
escalation, tenant isolation, and a scheduler that generates the day. That spine
is sound and matches §2 exactly.

What is thin is the **body**. Eight of the nine loop stages exist as machinery,
but they are exercised by nine seeded activities out of roughly a hundred and
eighteen, across two of six engines, with no lab, no inventory, no equipment, no
sterilization batches, and no CAPA. The spine was mistaken for the product.

The correction order that follows from §8 rather than from convenience:

1. **CAPA / Incident** — closes the loop. Nothing else in the document is
   described as the mechanism by which the clinic *learns*.
2. **Exception drill-down** — makes MEASURE actionable; small, and §8 asks for
   it directly.
3. **The 8 management scores** — the layer the owner actually reads.
4. **Lab Case object, then the crown-delivery gate** — the doc's own flagship
   example, and the first real test of the Patient Event and Compliance engines.
5. **The Master Activity Matrix v2.0** — all 101 activities, under the IDs the
   frozen matrix already assigns.

---

## Correction (2026-08-01): there is a third source, and it is the authoritative one

The uploads contained three documents nobody had opened: `KuBi_FRS_v1.0.docx`,
`KuBi_Developer_Build_Pack_v1.0.docx`, and — the important one —
**`KuBi_Master_Activity_Automation_Matrix_v2.0.xlsx`**. CLAUDE.md already
referred to "Matrix v2.0 is frozen"; this is that matrix. All are now committed
here.

It contains **101 activities across 23 columns**, every field of the 22-field
record populated, plus 23 automation rules, the enum register, and a KPI
dictionary. It is the extensive definition, and this file's earlier claims must
be corrected against it:

- **The seeded IDs were right.** `OPN-001` and `CLS-001` match Matrix v2.0
  exactly. The `OPEN-`/`CLOSE-` prefixes I said they should have been come from
  the earlier `Operation_App.xlsx` brainstorm (sheets B and N), which v2.0
  supersedes. Nothing needs renaming.
- **The 16-parameter enum is right.** The §1 control table lives in a Word
  *table*, which the original paragraph-only extraction skipped entirely — so
  the list was never actually read. Checked now, all 16 enum values match it
  one for one.
- **The eight management scores are specified**, in another skipped table:
  Clinic Readiness, Patient Care Compliance, Clinical Documentation, Infection
  Control, Appointment Efficiency, Lab Efficiency, Inventory Readiness, Team
  Compliance. §7's missing middle layer is not underspecified; it was unread.
- **The three escalation levels are specified** in a third skipped table: L1
  reminder on approaching deadline, L2 on deadline crossed (responsible *and*
  checker), L3 on unresolved or patient-safety (owner/manager).

### The genuine finding

Matrix v2.0 groups its 101 activities into **17 execution groups**, which are
not the §1 **16 control parameters**. That is not an error in either document —
v2.0 groups by how work runs (who does it, in which pass), §1 groups by what
the owner is accountable for. But the mapping between them was never written
down, so it is written down now in `scripts/build-parameter-spec.mjs` and
rendered in `docs/kubi-parameters.html`.

Mapping them exposes two real gaps in the frozen matrix:

- **Cleanliness & Housekeeping (parameter 3) has zero activities.** The earlier
  workbook defines fourteen (`HK-001`–`HK-014`); v2.0 carries none of them. The
  parameter can therefore never score anything but GREY.
- **Room & Chair Readiness (parameter 6) has zero activities**, though several
  v2.0 activities (`CLN-005` chairside setup, `INV-001` consumable check) plainly
  serve it and are filed elsewhere.

Both are gaps in the dictionary, not in the code, and both need an owner
decision rather than a guess.
