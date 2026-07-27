# Reserved bounded contexts (ADR-011)

"Out of MVP" is not "out of product architecture." These contexts are named,
seamed and dependency-analysed but NOT built. Each must satisfy three tests at
every phase exit:

1. **No schema break** — adding it requires new tables and nullable columns only.
2. **No engine change** — the workflow, gate and trigger engines must drive it
   by configuration alone.
3. **A named seam** — documented below.

| Context | Would own | Would read | Seam reserved in Phase 1 |
|---|---|---|---|
| Consultation | consultation record, chief complaint | patient, visit | `InstanceScope.CONSULTATION` |
| Diagnosis | diagnosis codes, findings | consultation, imaging | `InstanceScope` + future `patient_procedure.diagnosis_id` (nullable) |
| Treatment Planning | treatment_plan, plan items, approval | diagnosis, procedure catalogue | `InstanceScope.TREATMENT_PLAN` |
| Payments | invoice, payment, ledger | visit, patient_procedure | **Outbound event contract** (`VisitClosed`, `ProcedureCompleted`) — deliberately NOT a foreign key, so payments can be internal or external without the core knowing which |
| Recall | recall schedule, cohort rules | patient, procedure history | Shares the follow-up scheduling engine |

Full EMR charting, insurance, accounting and a patient portal remain
integration seams only.
