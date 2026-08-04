/**
 * The Daily Operating Standard — the non-negotiables.
 *
 * The owner's own words: *"the daily recurring tasks should only include
 * non-negotiable activities — the tasks that must be completed every single
 * day without exception, regardless of patient load."*
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this exists alongside the frozen matrix
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The matrix (101 activities, v2.0, frozen) is the **control** layer. It says
 * what must be true, who owns it, what evidence closes it, how it escalates,
 * and which KPI it feeds. It is deliberately abstract: OPN-001 "Open
 * clinic/floors" covers unlocking, power, AC, compressor, suction and RO in
 * one control.
 *
 * This file is the **rhythm** layer. It says what a named person actually
 * does, in what order, at what point in the day. That is the thing the matrix
 * does not carry and the thing a new assistant on her first morning needs.
 * The matrix has Trigger and Frequency; it has no spine.
 *
 * Neither replaces the other. A standard here without a `covers` is not
 * governed by anything yet — that is a v3.0 proposal, and the register below
 * says so out loud rather than quietly implying coverage. Constitution rule 4.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What comparing the two revealed
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Seventeen of the forty-seven non-negotiables have no control behind them.
 * They fall into four clusters, and each is a real hole rather than an
 * oversight in transcription:
 *
 *   1. **Housekeeping has no controls at all.** There is no HK- prefix in the
 *      matrix. Cleaning, mopping, bins, washroom rounds, high-touch
 *      disinfection and deep clean are seven of the seventeen — the single
 *      largest gap, and the one an infection-control auditor opens with.
 *   2. **Money is entirely absent.** Estimate, financial acceptance, invoice,
 *      payment collection and cash reconciliation. KuBi cannot currently tell
 *      you whether a patient paid.
 *   3. **Waterlines and suction lines.** Flushed twice daily in the owner's
 *      standard; nowhere in the matrix. DUWL management is a named NABH
 *      infection-control item.
 *   4. **The morning huddle, between-patient turnaround, next-appointment
 *      booking, and data backup.** One each.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The honesty rule
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every entry declares how KuBi would *know* it happened. Where the answer is
 * "it could not", `proof` is NOT_YET and `gap` names what is missing. A
 * checklist that renders a tick next to something nobody can verify is worse
 * than no checklist: it produces an audit trail that is confidently wrong.
 * Same principle as AP-1 — UNKNOWN is never PASS.
 */
import { RoleCode } from './enums.js';
import { ACTIVITY_LIBRARY } from './activity-library.js';

/* -------------------------------------------------------------------------
 * The rhythm
 *
 * Seven slots, in the order a day actually happens. This total order is what
 * "everyone knows how it moves" means in code: given any two non-negotiables,
 * the system can say which comes first, without anybody scheduling them.
 *
 * Three of the seven are not clock times at all — EVERY_PATIENT repeats per
 * visit, HOURLY and TWO_HOURLY repeat on a cadence. They are still ordered,
 * because a day is read top to bottom even when parts of it loop.
 * ---------------------------------------------------------------------- */

export const Rhythm = {
  BEFORE_OPENING: 'BEFORE_OPENING',
  EVERY_PATIENT: 'EVERY_PATIENT',
  HOURLY: 'HOURLY',
  TWO_HOURLY: 'TWO_HOURLY',
  LUNCH: 'LUNCH',
  LAST_PATIENT: 'LAST_PATIENT',
  CLOSING: 'CLOSING',
} as const;
export type Rhythm = (typeof Rhythm)[keyof typeof Rhythm];

/** The day, in order. Nothing else may define this sequence. */
export const RHYTHM_ORDER: readonly Rhythm[] = [
  Rhythm.BEFORE_OPENING,
  Rhythm.EVERY_PATIENT,
  Rhythm.HOURLY,
  Rhythm.TWO_HOURLY,
  Rhythm.LUNCH,
  Rhythm.LAST_PATIENT,
  Rhythm.CLOSING,
] as const;

/** Said the way a person would say it, never the enum. */
export const RHYTHM_LABEL: Record<Rhythm, string> = {
  BEFORE_OPENING: 'Before opening',
  EVERY_PATIENT: 'Every patient',
  HOURLY: 'Every hour',
  TWO_HOURLY: 'Every two hours',
  LUNCH: 'Lunch time',
  LAST_PATIENT: 'After the last patient',
  CLOSING: 'Closing',
};

/**
 * Whether the clinic may open, or close, with this outstanding.
 *
 * BEFORE_OPENING and CLOSING are gates on the two journeys. The middle five
 * are cadences — being behind on the two-hourly washroom round does not stop
 * a clinic, it raises an exception.
 */
export function isGate(r: Rhythm): boolean {
  return r === Rhythm.BEFORE_OPENING || r === Rhythm.CLOSING;
}

/* -------------------------------------------------------------------------
 * The target
 *
 * The owner's KPI column, made machine-readable. A standard written only as
 * prose can be displayed and never evaluated, which is how "100% completed"
 * ends up meaning whatever the person reading it wants it to mean.
 * ---------------------------------------------------------------------- */

export type Target =
  /** "100% completed", "≥95% confirmed". */
  | { kind: 'PERCENT'; atLeast: number }
  /** "Zero equipment failures", "Zero cash variance". */
  | { kind: 'ZERO'; of: string }
  /** "Completed within 10 minutes", "Average waiting <15 minutes". */
  | { kind: 'WITHIN_MINUTES'; minutes: number }
  /** "Before consultation", "Before patient exits". Ordering, not quantity. */
  | { kind: 'BEFORE'; moment: string }
  /** "Completed daily", "As per protocol". Once, every day, no exception. */
  | { kind: 'DAILY' };

/* -------------------------------------------------------------------------
 * The proof
 *
 * How KuBi would know. Ordered by how much it can be trusted, and the order
 * matters: a clinic whose non-negotiables are 80% CONFIRMATION has a diary,
 * not a control system.
 * ---------------------------------------------------------------------- */

export const Proof = {
  /** KuBi already knows, without anybody saying so. */
  SYSTEM: 'SYSTEM',
  /** A number or value is recorded — a cycle result, a count, a reading. */
  READING: 'READING',
  /** A person says they did it. True until it isn't. */
  CONFIRMATION: 'CONFIRMATION',
  /** KuBi could not know this today. Named, never rendered as a tick. */
  NOT_YET: 'NOT_YET',
} as const;
export type Proof = (typeof Proof)[keyof typeof Proof];

export interface DailyStandard {
  id: string;
  rhythm: Rhythm;
  role: RoleCode;
  /** The owner's wording, unedited. Rewriting it loses the clinic's voice. */
  task: string;
  /** The owner's Standard/KPI column, unedited. */
  standard: string;
  target: Target;
  proof: Proof;
  /**
   * The frozen matrix control this sits under, or null when nothing governs
   * it yet. Null is a v3.0 proposal, not an omission.
   */
  covers: string | null;
  /** Required whenever proof is NOT_YET or covers is null. Never empty. */
  gap?: string;
}

const pct = (atLeast: number): Target => ({ kind: 'PERCENT', atLeast });
const zero = (of: string): Target => ({ kind: 'ZERO', of });
const mins = (minutes: number): Target => ({ kind: 'WITHIN_MINUTES', minutes });
const before = (moment: string): Target => ({ kind: 'BEFORE', moment });
const daily: Target = { kind: 'DAILY' };

/**
 * The forty-seven. Transcribed from the owner's operating standard, in the
 * owner's order and the owner's words.
 */
export const DAILY_STANDARD: readonly DailyStandard[] = [
  /* ---- Before opening ------------------------------------------------- */
  {
    id: 'DOS-01', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.HOUSEKEEPING,
    task: 'Unlock clinic, switch on electricity, AC, compressor, suction, RO water system',
    standard: '100% before clinic opens', target: pct(100),
    proof: Proof.CONFIRMATION, covers: 'OPN-001',
  },
  {
    id: 'DOS-02', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.HOUSEKEEPING,
    task: 'Clean reception, waiting area, washroom, doctor’s room, operatories',
    standard: '100% checklist completed', target: pct(100),
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'No housekeeping control exists in matrix v2.0 — there is no HK- prefix at all.',
  },
  {
    id: 'DOS-03', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.HOUSEKEEPING,
    task: 'Mop floors with disinfectant',
    standard: '100% completed', target: pct(100),
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'No housekeeping control exists in matrix v2.0.',
  },
  {
    id: 'DOS-04', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.HOUSEKEEPING,
    task: 'Empty all waste bins and place fresh liners',
    standard: '100% completed', target: pct(100),
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'General waste is not STER-007, which governs biomedical waste only.',
  },
  {
    id: 'DOS-05', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Start compressor, suction, autoclave, X-ray/RVG, scanner, intraoral camera '
      + 'and check functionality',
    standard: 'Zero equipment failures before first patient',
    target: zero('equipment failures'),
    proof: Proof.CONFIRMATION, covers: 'EQP-001',
  },
  {
    id: 'DOS-06', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Flush dental unit waterlines',
    standard: 'As per protocol', target: daily,
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'Dental unit waterline management is absent from matrix v2.0 — a named '
      + 'NABH infection-control item, and flushed twice daily in this standard.',
  },
  {
    id: 'DOS-07', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Disinfect all chairs, trays, light handles and work surfaces',
    standard: '100% completed', target: pct(100),
    proof: Proof.CONFIRMATION, covers: 'OPN-002',
  },
  {
    id: 'DOS-08', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Arrange sterile instrument trays for all planned procedures',
    standard: 'No missing trays', target: zero('missing trays'),
    proof: Proof.SYSTEM, covers: 'CLN-005',
  },
  {
    id: 'DOS-09', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Verify emergency drug kit and oxygen availability',
    standard: '100% available', target: pct(100),
    proof: Proof.CONFIRMATION, covers: 'EMR-001',
  },
  {
    id: 'DOS-10', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Check implant motor, curing light and scaler function',
    standard: '100% functional', target: pct(100),
    proof: Proof.CONFIRMATION, covers: 'EQP-001',
  },
  {
    id: 'DOS-11', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.RECEPTION,
    task: 'Log into clinic software and verify internet, printer and payment systems',
    standard: 'Operational before first patient', target: before('the first patient'),
    proof: Proof.SYSTEM, covers: 'OPN-003',
  },
  {
    id: 'DOS-12', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.RECEPTION,
    task: 'Review day’s appointments and identify pending confirmations',
    standard: '100% reviewed', target: pct(100),
    proof: Proof.SYSTEM, covers: 'APT-001',
  },
  {
    id: 'DOS-13', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.RECEPTION,
    task: 'Confirm all remaining appointments',
    standard: '≥95% confirmed', target: pct(95),
    proof: Proof.SYSTEM, covers: 'APT-002',
  },
  {
    id: 'DOS-14', rhythm: Rhythm.BEFORE_OPENING, role: RoleCode.CLINIC_MANAGER,
    task: 'Conduct morning huddle with team',
    standard: 'Completed within 10 minutes', target: mins(10),
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'The huddle has no control in matrix v2.0. It is the one place the day '
      + 'is set verbally, so its absence is felt everywhere else.',
  },

  /* ---- Every patient --------------------------------------------------- */
  {
    id: 'DOS-15', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.RECEPTION,
    task: 'Register patient and verify demographic details',
    standard: 'Completed before consultation', target: before('the consultation'),
    proof: Proof.SYSTEM, covers: 'APT-004',
  },
  {
    id: 'DOS-16', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.RECEPTION,
    task: 'Verify consent forms and previous records',
    standard: '100% completed', target: pct(100),
    proof: Proof.SYSTEM, covers: 'CLN-002',
  },
  {
    id: 'DOS-17', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Prepare treatment room before patient enters',
    standard: 'Ready within 3 minutes', target: mins(3),
    proof: Proof.CONFIRMATION, covers: 'CLN-005',
  },
  {
    id: 'DOS-18', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.TREATING_DOCTOR,
    task: 'Complete examination and diagnosis documentation',
    standard: 'Before treatment begins', target: before('treatment begins'),
    proof: Proof.SYSTEM, covers: 'CLN-011',
  },
  {
    id: 'DOS-19', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.TREATING_DOCTOR,
    task: 'Explain treatment plan, risks, benefits and alternatives',
    standard: '100% documented', target: pct(100),
    proof: Proof.SYSTEM, covers: 'CLN-002',
  },
  {
    id: 'DOS-20', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.RECEPTION,
    task: 'Generate estimate and obtain financial acceptance',
    standard: 'Before treatment starts (except emergencies)',
    target: before('treatment starts'),
    proof: Proof.NOT_YET, covers: null,
    gap: 'KuBi holds no money. There is no estimate, no invoice and no payment '
      + 'anywhere in the matrix or the schema.',
  },
  {
    id: 'DOS-21', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Maintain aseptic protocol during procedure',
    standard: 'Zero protocol violations', target: zero('protocol violations'),
    proof: Proof.NOT_YET, covers: null,
    gap: 'Nothing observes a procedure in progress. This can only be measured by '
      + 'audit or by a second person, so it needs an observation event first.',
  },
  {
    id: 'DOS-22', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Record implant lot numbers/material batch numbers where applicable',
    standard: '100% traceability', target: pct(100),
    proof: Proof.READING, covers: 'IMP-005',
  },
  {
    id: 'DOS-23', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Disinfect chair and operatory after patient leaves',
    standard: 'Completed within 5 minutes', target: mins(5),
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'OPN-002 governs readiness at opening, not between-patient turnaround. '
      + 'The busiest infection-control moment of the day is ungoverned.',
  },
  {
    id: 'DOS-24', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.RECEPTION,
    task: 'Raise invoice and collect payment',
    standard: 'Before patient exits', target: before('the patient exits'),
    proof: Proof.NOT_YET, covers: null,
    gap: 'KuBi holds no money — no invoice, no receipt, no payment record. This '
      + 'is the standard a patient notices missing first.',
  },
  {
    id: 'DOS-25', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.RECEPTION,
    task: 'Schedule next appointment before patient leaves',
    standard: '≥95% patients booked', target: pct(95),
    proof: Proof.SYSTEM, covers: null,
    gap: 'Booking exists in the schema but no control requires the next visit to '
      + 'be booked before the patient leaves — which is where retention is won.',
  },
  {
    id: 'DOS-26', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.RECEPTION,
    task: 'Send prescription/instructions digitally if applicable',
    standard: '100% completed', target: pct(100),
    proof: Proof.SYSTEM, covers: 'CLN-010',
  },
  {
    id: 'DOS-27', rhythm: Rhythm.EVERY_PATIENT, role: RoleCode.TREATING_DOCTOR,
    task: 'Complete clinical notes',
    standard: 'Before end of working day', target: before('the end of the working day'),
    proof: Proof.SYSTEM, covers: 'CLN-011',
  },

  /* ---- Every hour ------------------------------------------------------ */
  {
    id: 'DOS-28', rhythm: Rhythm.HOURLY, role: RoleCode.RECEPTION,
    task: 'Review patient waiting time',
    standard: 'Average waiting <15 minutes', target: mins(15),
    proof: Proof.SYSTEM, covers: 'APT-005',
  },
  {
    id: 'DOS-29', rhythm: Rhythm.HOURLY, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Verify sterile instrument availability',
    standard: 'No procedure delayed', target: zero('procedures delayed'),
    proof: Proof.SYSTEM, covers: 'STER-005',
  },

  /* ---- Every two hours -------------------------------------------------- */
  {
    id: 'DOS-30', rhythm: Rhythm.TWO_HOURLY, role: RoleCode.HOUSEKEEPING,
    task: 'Inspect and clean washroom',
    standard: 'Checklist completed', target: daily,
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'No housekeeping control exists in matrix v2.0.',
  },
  {
    id: 'DOS-31', rhythm: Rhythm.TWO_HOURLY, role: RoleCode.HOUSEKEEPING,
    task: 'Disinfect high-touch surfaces (door handles, reception desk, POS machine, chairs)',
    standard: '100% completed', target: pct(100),
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'No housekeeping control exists in matrix v2.0.',
  },

  /* ---- Lunch ------------------------------------------------------------ */
  {
    id: 'DOS-32', rhythm: Rhythm.LUNCH, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Replenish consumables in all operatories',
    standard: 'No stock shortage', target: zero('stock shortages'),
    proof: Proof.SYSTEM, covers: 'INV-001',
  },
  {
    id: 'DOS-33', rhythm: Rhythm.LUNCH, role: RoleCode.RECEPTION,
    task: 'Review afternoon appointments and reconfirm if required',
    standard: '100% completed', target: pct(100),
    proof: Proof.SYSTEM, covers: 'APT-002',
  },

  /* ---- After the last patient ------------------------------------------- */
  {
    id: 'DOS-34', rhythm: Rhythm.LAST_PATIENT, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Start final sterilization cycle',
    standard: 'All used instruments processed', target: pct(100),
    proof: Proof.READING, covers: 'STER-004',
  },

  /* ---- Closing ---------------------------------------------------------- */
  {
    id: 'DOS-35', rhythm: Rhythm.CLOSING, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Clean suction lines',
    standard: 'Completed daily', target: daily,
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'Suction line maintenance is absent from matrix v2.0.',
  },
  {
    id: 'DOS-36', rhythm: Rhythm.CLOSING, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Flush dental unit waterlines',
    standard: 'Completed daily', target: daily,
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'Dental unit waterline management is absent from matrix v2.0.',
  },
  {
    id: 'DOS-37', rhythm: Rhythm.CLOSING, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Switch off compressor, suction and clinical equipment',
    standard: 'Zero equipment left running', target: zero('equipment left running'),
    proof: Proof.CONFIRMATION, covers: 'CLS-004',
  },
  {
    id: 'DOS-38', rhythm: Rhythm.CLOSING, role: RoleCode.DENTAL_ASSISTANT,
    task: 'Store sterile instruments correctly',
    standard: '100% completed', target: pct(100),
    proof: Proof.CONFIRMATION, covers: 'STER-005',
  },
  {
    id: 'DOS-39', rhythm: Rhythm.CLOSING, role: RoleCode.RECEPTION,
    task: 'Verify all treatments entered in software',
    standard: 'Zero missing entries', target: zero('missing entries'),
    proof: Proof.SYSTEM, covers: 'CLS-001',
  },
  {
    id: 'DOS-40', rhythm: Rhythm.CLOSING, role: RoleCode.RECEPTION,
    task: 'Collect and reconcile all payments',
    standard: 'Zero cash variance', target: zero('cash variance'),
    proof: Proof.NOT_YET, covers: null,
    gap: 'KuBi holds no money, so there is nothing to reconcile against.',
  },
  {
    id: 'DOS-41', rhythm: Rhythm.CLOSING, role: RoleCode.RECEPTION,
    task: 'Complete daily patient register',
    standard: '100% completed', target: pct(100),
    proof: Proof.SYSTEM, covers: 'CLS-001',
  },
  {
    id: 'DOS-42', rhythm: Rhythm.CLOSING, role: RoleCode.RECEPTION,
    task: 'Backup patient data (if required by system)',
    standard: 'Completed daily', target: daily,
    proof: Proof.NOT_YET, covers: null,
    gap: 'Backup is an infrastructure job, not a reception task, once KuBi is on '
      + 'a real database. It stays on the register so nobody assumes it is handled.',
  },
  {
    id: 'DOS-43', rhythm: Rhythm.CLOSING, role: RoleCode.CLINIC_MANAGER,
    task: 'Verify attendance and duty completion',
    standard: '100% staff accounted for', target: pct(100),
    proof: Proof.SYSTEM, covers: 'ATT-002',
  },
  {
    id: 'DOS-44', rhythm: Rhythm.CLOSING, role: RoleCode.CLINIC_MANAGER,
    task: 'Review pending treatments and next day’s schedule',
    standard: 'Completed before leaving', target: before('leaving'),
    proof: Proof.CONFIRMATION, covers: 'CLS-001',
  },
  {
    id: 'DOS-45', rhythm: Rhythm.CLOSING, role: RoleCode.HOUSEKEEPING,
    task: 'Deep clean operatories, reception and washroom',
    standard: '100% completed', target: pct(100),
    proof: Proof.CONFIRMATION, covers: null,
    gap: 'No housekeeping control exists in matrix v2.0.',
  },
  {
    id: 'DOS-46', rhythm: Rhythm.CLOSING, role: RoleCode.HOUSEKEEPING,
    task: 'Dispose biomedical waste as per BMW rules and segregate waste correctly',
    standard: '100% compliant', target: pct(100),
    proof: Proof.READING, covers: 'STER-007',
  },
  {
    id: 'DOS-47', rhythm: Rhythm.CLOSING, role: RoleCode.HOUSEKEEPING,
    task: 'Lock clinic after final security check',
    standard: 'Zero security lapses', target: zero('security lapses'),
    proof: Proof.CONFIRMATION, covers: 'CLS-006',
  },
] as const;

/* -------------------------------------------------------------------------
 * Reading the day
 *
 * These are the whole point. Nobody should ever hand-write a role's list, a
 * morning gate or an evening gate — they are all views of the one library,
 * so they cannot drift apart.
 * ---------------------------------------------------------------------- */

const rhythmIndex = (r: Rhythm) => RHYTHM_ORDER.indexOf(r);

/** Everything one person owes, in the order the day happens. */
export function dayFor(role: RoleCode): DailyStandard[] {
  return DAILY_STANDARD
    .filter((s) => s.role === role)
    .sort((a, b) => rhythmIndex(a.rhythm) - rhythmIndex(b.rhythm));
}

/** The day as slots, each with who is in it. Empty slots are dropped. */
export function theDay(): Array<{ rhythm: Rhythm; label: string; items: DailyStandard[] }> {
  return RHYTHM_ORDER
    .map((rhythm) => ({
      rhythm,
      label: RHYTHM_LABEL[rhythm],
      items: DAILY_STANDARD.filter((s) => s.rhythm === rhythm),
    }))
    .filter((slot) => slot.items.length > 0);
}

/** Journey 1. The clinic may not open with any of these outstanding. */
export function openingGate(): DailyStandard[] {
  return DAILY_STANDARD.filter((s) => s.rhythm === Rhythm.BEFORE_OPENING);
}

/** Journey 3. The clinic may not be locked with any of these outstanding. */
export function closingGate(): DailyStandard[] {
  return DAILY_STANDARD.filter((s) => s.rhythm === Rhythm.CLOSING);
}

/**
 * What KuBi cannot yet prove, and what it would take.
 *
 * Surfaced on screen rather than kept in a comment: a clinic owner reading
 * their own operating standard back should be able to see the four things the
 * system is currently taking on trust.
 */
export function unproven(): DailyStandard[] {
  return DAILY_STANDARD.filter((s) => s.proof === Proof.NOT_YET);
}

/** Non-negotiables with no control behind them — the v3.0 proposal list. */
export function ungoverned(): DailyStandard[] {
  return DAILY_STANDARD.filter((s) => s.covers === null);
}

/**
 * How much of the day rests on somebody's word.
 *
 * The number to watch as KuBi grows: a standard proved by CONFIRMATION is a
 * diary entry. Moving one to SYSTEM or READING is worth more than adding a
 * screen.
 */
export function proofMix(): Record<Proof, number> {
  const mix: Record<Proof, number> = {
    SYSTEM: 0, READING: 0, CONFIRMATION: 0, NOT_YET: 0,
  };
  for (const s of DAILY_STANDARD) mix[s.proof] += 1;
  return mix;
}

/** Every activity id this standard leans on, deduplicated. */
export function governingActivities(): string[] {
  return [...new Set(DAILY_STANDARD.map((s) => s.covers).filter((c): c is string => c !== null))]
    .sort();
}

/** True when the id names a real activity in the frozen library. */
export function isKnownActivity(id: string): boolean {
  return ACTIVITY_LIBRARY.some((a) => a.id === id);
}
