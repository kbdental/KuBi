/**
 * Seed provenance. Phase 1 Step 8 / owner control 11: loaders must be
 * idempotent AND preserve provenance.
 *
 * Every seeded register row records where its value came from. A row marked
 * DECISION_REQUIRED carries no value — it is a placeholder proving the question
 * was asked, not answered. Control 4 forbids inventing values for these.
 */
import type { Provenance } from '@kubi/contracts';

export interface SeedRow<T> {
  /** Stable natural key. Never reissued. Used for idempotent upsert. */
  code: string;
  /** Where this row came from: a document reference, a decision id, or NEW. */
  provenance: Provenance;
  /** Human-readable citation, e.g. "Matrix v2.0 STER-005" or "ADR-004". */
  source: string;
  /**
   * The value. `null` where provenance is DECISION_REQUIRED or NOT_SPECIFIED —
   * a missing owner decision must remain visibly missing.
   */
  value: T | null;
  /** Open owner decision blocking this row, if any. */
  blockedBy?: string;
}

/** A loader refuses to write a value for a row the owner has not decided. */
export function assertNoInventedValues(rows: readonly SeedRow<unknown>[], register: string): void {
  const invented = rows.filter(
    (r) =>
      (r.provenance === 'DECISION_REQUIRED' || r.provenance === 'NOT_SPECIFIED') &&
      r.value !== null,
  );
  if (invented.length > 0) {
    throw new Error(
      `[seed:${register}] ${invented.length} row(s) carry a value despite being ` +
        `DECISION_REQUIRED/NOT_SPECIFIED — this violates owner control 4 ` +
        `(do not create policy values for undecided fields): ` +
        invented.map((r) => r.code).join(', '),
    );
  }
}

/** Summary emitted by every loader so an unanswered question is loud, not silent. */
export interface LoadReport {
  register: string;
  total: number;
  loaded: number;
  blockedOnDecision: number;
  notSpecified: number;
  warnings: string[];
}

export function summarize<T>(register: string, rows: readonly SeedRow<T>[]): LoadReport {
  const blocked = rows.filter((r) => r.provenance === 'DECISION_REQUIRED');
  const notSpec = rows.filter((r) => r.provenance === 'NOT_SPECIFIED');
  return {
    register,
    total: rows.length,
    loaded: rows.filter((r) => r.value !== null).length,
    blockedOnDecision: blocked.length,
    notSpecified: notSpec.length,
    warnings: blocked.map(
      (r) => `${r.code}: awaiting ${r.blockedBy ?? 'owner decision'} (${r.source})`,
    ),
  };
}
