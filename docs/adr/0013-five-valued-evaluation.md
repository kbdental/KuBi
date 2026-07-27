# ADR-013 — Five-valued evaluation; UNKNOWN never resolves to PASS

Status: Accepted · Additional Principle 1

## Context
Phase 0 modelled gate evaluation as a boolean. A boolean cannot distinguish
"the consent is absent" from "the consent service could not be reached", and
resolves the second silently in whichever direction the guard happens to be
written.

## Decision
All control evaluation returns `EvaluationResult`:
`PASS | FAIL | NOT_APPLICABLE | UNKNOWN | NOT_CONFIGURED`.

Enforcement is configured PER OUTCOME via `ENFORCEMENT_MATRIX`. In every mode,
UNKNOWN and NOT_CONFIGURED behave at least as strictly as FAIL; under
BLOCK_HARD they are non-overridable.

`NOT_APPLICABLE` requires a POSITIVE rule. Absence of information is always
`UNKNOWN`.

Composite gates resolve to their WORST member (`resolveComposite`), so one
unreachable evaluator blocks the composite.

## Verification
`tests/unit/enums.test.ts` asserts that no enforcement mode yields PROCEED for
UNKNOWN or NOT_CONFIGURED, and that BLOCK_HARD is non-overridable for all three
non-passing outcomes. These run on every commit.

## Consequences
- More blocking early, and an operational obligation to keep evaluability high.
  KPI-SYS-01 (Control Evaluability %) exists to measure exactly that.
