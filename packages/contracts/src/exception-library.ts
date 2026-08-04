/**
 * The exception library — sixty-eight exceptions and the escalation matrix.
 *
 * The last of the six libraries, and the one that closes the loop. The other
 * five say what should happen. This says what happens when it doesn't.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The escalation matrix supersedes the default ladder
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `work-model.ts` carries a default ladder of 15 / 30 / 60 minutes, chosen
 * when nothing better existed. The owner's matrix is better and it is
 * different in kind: it escalates by **severity**, not by elapsed time.
 *
 *   Level 1 — Operational   within 15 minutes
 *   Level 2 — Clinical      immediate
 *   Level 3 — Safety        immediate
 *   Level 4 — Critical      immediate
 *
 * Three of the four are immediate. That is the whole point and it is easy to
 * lose: a wrong-tooth identification does not wait fifteen minutes for a
 * first rung. `escalateWithin()` returns 0 for those, and the type makes the
 * difference explicit rather than encoding "immediate" as a small number.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Some exceptions stop work; most create it
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Read out of the owner's verbs again, and there are more of them here than
 * anywhere else: "Stop procedure immediately", "Block procedure", "Hold
 * implant surgery", "Stop surgery", "Stop using affected instruments",
 * "Quarantine instrument sets", "Suspend aerosol procedures", "Suspend
 * prosthetic phase", "Hold further elective treatment", "Disable photography
 * module", "Manager approval required". Twelve refusals. A clinic that turns
 * those into reminders has a to-do list, not an operating system.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The escalation targets are the owner's job titles, kept as written
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "Implantologist", "Endodontist", "Infection Control Officer", "Lab Head",
 * "Front Office Manager", "HR" — none of these are RoleCode values. Mapping
 * them onto the thirteen would name the wrong person; inventing six new roles
 * would be a decision the owner has not made. They stay as strings, and
 * `unmappedRoles()` returns the list so the decision is visible instead of
 * silently made.
 */
import { ActionKind } from './automation.js';

/* -------------------------------------------------------------------------
 * The escalation matrix
 * ---------------------------------------------------------------------- */

export const EscalationSeverity = {
  /** Delay, missing stock, scheduling issue. */
  OPERATIONAL: 'OPERATIONAL',
  /** High BP, incomplete records, treatment deviation. */
  CLINICAL: 'CLINICAL',
  /** Sterilization failure, equipment failure, wrong patient identified. */
  SAFETY: 'SAFETY',
  /** Medical emergency, wrong-site surgery risk, severe adverse event, legal. */
  CRITICAL: 'CRITICAL',
} as const;
export type EscalationSeverity = (typeof EscalationSeverity)[keyof typeof EscalationSeverity];

export interface SeverityLevel {
  level: 1 | 2 | 3 | 4;
  severity: EscalationSeverity;
  label: string;
  examples: string;
  /** Minutes. Zero means immediate, and immediate is not "very soon". */
  withinMinutes: number;
  escalateTo: string;
}

export const ESCALATION_MATRIX: readonly SeverityLevel[] = [
  {
    level: 1, severity: EscalationSeverity.OPERATIONAL, label: 'Operational',
    examples: 'Delay, missing stock, scheduling issue',
    withinMinutes: 15, escalateTo: 'Reception/Clinic Manager',
  },
  {
    level: 2, severity: EscalationSeverity.CLINICAL, label: 'Clinical',
    examples: 'High BP, incomplete records, treatment deviation',
    withinMinutes: 0, escalateTo: 'Treating Dentist',
  },
  {
    level: 3, severity: EscalationSeverity.SAFETY, label: 'Safety',
    examples: 'Sterilization failure, equipment failure, wrong patient identified',
    withinMinutes: 0, escalateTo: 'Clinical Head',
  },
  {
    level: 4, severity: EscalationSeverity.CRITICAL, label: 'Critical',
    examples: 'Medical emergency, wrong-site surgery risk, severe adverse event, legal issue',
    withinMinutes: 0, escalateTo: 'Owner + Clinical Director',
  },
] as const;

export function levelOf(s: EscalationSeverity): SeverityLevel {
  return ESCALATION_MATRIX.find((l) => l.severity === s)!;
}

/** Minutes before it must be escalated. Zero means now, not soon. */
export function escalateWithin(s: EscalationSeverity): number {
  return levelOf(s).withinMinutes;
}

/** True where waiting is not permitted at all. Three of the four levels. */
export function isImmediate(s: EscalationSeverity): boolean {
  return levelOf(s).withinMinutes === 0;
}

/* -------------------------------------------------------------------------
 * The exceptions
 * ---------------------------------------------------------------------- */

export const ExceptionGroup = {
  CLINICAL: 'CLINICAL',
  CONSENT: 'CONSENT',
  MEDICAL: 'MEDICAL',
  TREATMENT: 'TREATMENT',
  LABORATORY: 'LABORATORY',
  INFECTION_CONTROL: 'INFECTION_CONTROL',
  EQUIPMENT: 'EQUIPMENT',
  FINANCIAL: 'FINANCIAL',
  RECEPTION: 'RECEPTION',
  DOCUMENTATION: 'DOCUMENTATION',
  STAFF: 'STAFF',
  COMMUNICATION: 'COMMUNICATION',
} as const;
export type ExceptionGroup = (typeof ExceptionGroup)[keyof typeof ExceptionGroup];

export const EXCEPTION_GROUP_LABEL: Record<ExceptionGroup, string> = {
  CLINICAL: 'Clinical exceptions',
  CONSENT: 'Consent exceptions',
  MEDICAL: 'Medical exceptions',
  TREATMENT: 'Treatment exceptions',
  LABORATORY: 'Laboratory exceptions',
  INFECTION_CONTROL: 'Infection control exceptions',
  EQUIPMENT: 'Equipment exceptions',
  FINANCIAL: 'Financial exceptions',
  RECEPTION: 'Reception exceptions',
  DOCUMENTATION: 'Documentation exceptions',
  STAFF: 'Staff exceptions',
  COMMUNICATION: 'Patient communication exceptions',
};

export interface ExceptionRule {
  id: string;
  group: ExceptionGroup;
  /** The owner's wording, unedited. */
  exception: string;
  task: string;
  /** The owner's job title, kept as written. See the header. */
  escalateTo: string;
  /**
   * Severity where the owner stated one (group 1 only), otherwise inferred
   * from the escalation target against the matrix — never left absent, because
   * an exception with no severity has no escalation clock.
   */
  severity: EscalationSeverity;
  /** Whether the owner gave the severity, or it was read off the matrix. */
  severityStated: boolean;
  /** Read out of the owner's verb. Twelve of these stop work rather than create it. */
  action: ActionKind;
}

let xn = 0;
function x(
  group: ExceptionGroup, exception: string, task: string, escalateTo: string,
  severity: EscalationSeverity, opts: { stated?: boolean; action?: ActionKind } = {},
): ExceptionRule {
  xn += 1;
  return {
    id: `EXC-${String(xn).padStart(3, '0')}`,
    group, exception, task, escalateTo, severity,
    severityStated: opts.stated ?? false,
    action: opts.action ?? ActionKind.RAISE,
  };
}

const X = ExceptionGroup;
const S = EscalationSeverity;
const BLOCK = { action: ActionKind.BLOCK };

export const EXCEPTION_LIBRARY: readonly ExceptionRule[] = [
  /* ---- 1. Clinical — the only group with a stated priority -------------- */
  x(X.CLINICAL, 'Patient refused treatment', 'Record refusal, obtain refusal signature',
    'Treating Dentist', S.CLINICAL, { stated: true }),
  x(X.CLINICAL, 'Patient refused X-ray', 'Record refusal and explain risks',
    'Treating Dentist', S.SAFETY, { stated: true }),
  x(X.CLINICAL, 'Patient refused consent', 'Stop treatment and document',
    'Clinic Head', S.CRITICAL, { stated: true, ...BLOCK }),
  x(X.CLINICAL, 'Patient refuses anesthesia', 'Clinical reassessment',
    'Treating Dentist', S.SAFETY, { stated: true }),
  x(X.CLINICAL, 'Patient leaves before completion',
    'Record unfinished treatment and contact patient',
    'Reception + Dentist', S.SAFETY, { stated: true }),
  x(X.CLINICAL, 'Wrong tooth identified before treatment', 'Stop procedure immediately',
    'Senior Dentist', S.CRITICAL, { stated: true, ...BLOCK }),
  x(X.CLINICAL, 'Wrong treatment planned', 'Verify diagnosis',
    'Clinical Director', S.CRITICAL, { stated: true }),
  x(X.CLINICAL, 'Medical history cannot be verified', 'Obtain clarification before treatment',
    'Dentist', S.CRITICAL, { stated: true }),
  x(X.CLINICAL, 'Allergy discovered during procedure', 'Activate allergy protocol',
    'Clinical Director', S.CRITICAL, { stated: true }),
  x(X.CLINICAL, 'Medical emergency', 'Activate emergency protocol',
    'Owner/Clinical Head', S.CRITICAL, { stated: true }),

  /* ---- 2. Consent — four of five stop work ------------------------------ */
  x(X.CONSENT, 'Consent not signed', 'Block procedure', 'Treating Dentist', S.CRITICAL, BLOCK),
  x(X.CONSENT, 'Parent unavailable', 'Reschedule or verify guardian',
    'Clinic Manager', S.CLINICAL),
  x(X.CONSENT, 'Implant consent incomplete', 'Hold implant surgery',
    'Implantologist', S.CRITICAL, BLOCK),
  x(X.CONSENT, 'Surgical consent missing', 'Stop surgery',
    'Clinical Director', S.CRITICAL, BLOCK),
  x(X.CONSENT, 'Photography consent refused', 'Disable photography module',
    'Dentist', S.CLINICAL, BLOCK),

  /* ---- 3. Medical -------------------------------------------------------- */
  x(X.MEDICAL, 'BP above clinic limit', 'Repeat BP, physician consultation',
    'Dentist', S.CLINICAL),
  x(X.MEDICAL, 'Random blood sugar above protocol', 'Review before treatment',
    'Dentist', S.CLINICAL),
  x(X.MEDICAL, 'INR above acceptable level', 'Physician clearance',
    'Oral Surgeon', S.SAFETY),
  x(X.MEDICAL, 'Active infection', 'Reassess treatment plan', 'Dentist', S.CLINICAL),
  x(X.MEDICAL, 'Pregnancy discovered', 'Modify treatment plan', 'Senior Dentist', S.SAFETY),
  x(X.MEDICAL, 'Cardiac history without clearance', 'Obtain physician approval',
    'Clinical Director', S.SAFETY),

  /* ---- 4. Treatment ------------------------------------------------------- */
  x(X.TREATMENT, 'Procedure taking longer than expected', 'Review treatment status',
    'Clinic Manager', S.OPERATIONAL),
  x(X.TREATMENT, 'Instrument fracture', 'Record incident', 'Clinical Director', S.SAFETY),
  x(X.TREATMENT, 'Perforation during RCT', 'Specialist review', 'Endodontist', S.SAFETY),
  x(X.TREATMENT, 'Implant instability', 'Suspend prosthetic phase',
    'Implantologist', S.SAFETY, BLOCK),
  x(X.TREATMENT, 'Crown does not fit', 'Return to laboratory', 'Lab Manager', S.OPERATIONAL),
  x(X.TREATMENT, 'Impression inaccurate', 'Repeat impression',
    'Treating Dentist', S.CLINICAL),
  x(X.TREATMENT, 'Occlusion unacceptable', 'Re-evaluate before discharge',
    'Senior Dentist', S.CLINICAL),

  /* ---- 5. Laboratory ------------------------------------------------------- */
  x(X.LABORATORY, 'Lab case delayed', 'Notify patient', 'Lab Manager', S.OPERATIONAL,
    { action: ActionKind.NOTIFY }),
  x(X.LABORATORY, 'Prosthesis damaged', 'Remake authorization', 'Lab Head', S.OPERATIONAL),
  x(X.LABORATORY, 'Shade mismatch', 'Repeat shade selection', 'Dentist', S.CLINICAL),
  x(X.LABORATORY, 'Impression damaged', 'Repeat impression', 'Treating Dentist', S.CLINICAL),
  x(X.LABORATORY, 'STL upload failed', 'Retry upload', 'IT/Admin', S.OPERATIONAL),

  /* ---- 6. Infection control — the group that stops the most ---------------- */
  x(X.INFECTION_CONTROL, 'Sterilization cycle failed', 'Re-sterilize all instruments',
    'Sterilization In-charge', S.SAFETY),
  x(X.INFECTION_CONTROL, 'Autoclave failure', 'Stop using affected instruments',
    'Clinic Manager', S.SAFETY, BLOCK),
  x(X.INFECTION_CONTROL, 'Biological indicator failure', 'Quarantine instrument sets',
    'Owner', S.CRITICAL, BLOCK),
  x(X.INFECTION_CONTROL, 'Cross-contamination suspected', 'Incident report',
    'Infection Control Officer', S.CRITICAL),
  x(X.INFECTION_CONTROL, 'Biomedical waste segregation error', 'Correct immediately',
    'Clinic Manager', S.SAFETY),

  /* ---- 7. Equipment --------------------------------------------------------- */
  x(X.EQUIPMENT, 'Compressor failure', 'Shift patients if required',
    'Clinic Manager', S.SAFETY),
  x(X.EQUIPMENT, 'RVG failure', 'Arrange alternate imaging', 'Dentist', S.OPERATIONAL),
  x(X.EQUIPMENT, 'Scanner malfunction', 'Switch to conventional impression',
    'Clinic Manager', S.OPERATIONAL),
  x(X.EQUIPMENT, 'Dental chair breakdown', 'Move patient to another operatory',
    'Clinic Manager', S.OPERATIONAL),
  x(X.EQUIPMENT, 'Suction failure', 'Suspend aerosol procedures',
    'Owner', S.SAFETY, BLOCK),

  /* ---- 8. Financial ---------------------------------------------------------- */
  x(X.FINANCIAL, 'Payment not received', 'Hold further elective treatment',
    'Front Office Manager', S.OPERATIONAL, BLOCK),
  x(X.FINANCIAL, 'Unauthorized discount', 'Manager approval required',
    'Owner', S.OPERATIONAL, BLOCK),
  x(X.FINANCIAL, 'Refund requested', 'Investigate and document',
    'Clinic Manager', S.OPERATIONAL),
  x(X.FINANCIAL, 'Cash mismatch', 'Cash audit', 'Owner', S.SAFETY),
  x(X.FINANCIAL, 'Estimate disputed', 'Clinical review', 'Treating Dentist', S.CLINICAL),

  /* ---- 9. Reception ------------------------------------------------------------ */
  x(X.RECEPTION, 'Duplicate patient record', 'Merge after verification',
    'Clinic Manager', S.SAFETY),
  x(X.RECEPTION, 'Wrong appointment booked', 'Inform patient and reschedule',
    'Reception Manager', S.OPERATIONAL, { action: ActionKind.NOTIFY }),
  x(X.RECEPTION, 'Patient waiting beyond standard', 'Inform patient and doctor',
    'Clinic Manager', S.OPERATIONAL, { action: ActionKind.NOTIFY }),
  x(X.RECEPTION, 'Doctor absent', 'Rearrange appointments', 'Owner', S.OPERATIONAL),
  x(X.RECEPTION, 'No-show for surgery', 'Contact patient', 'Dentist', S.CLINICAL),

  /* ---- 10. Documentation --------------------------------------------------------- */
  x(X.DOCUMENTATION, 'Clinical notes incomplete', 'Complete before day closure',
    'Treating Dentist', S.CLINICAL),
  x(X.DOCUMENTATION, 'Prescription unsigned', 'Obtain signature', 'Dentist', S.CLINICAL),
  x(X.DOCUMENTATION, 'Implant batch missing', 'Record before case closure',
    'Implantologist', S.SAFETY),
  x(X.DOCUMENTATION, 'Lab prescription missing', 'Generate immediately',
    'Dentist', S.OPERATIONAL),
  x(X.DOCUMENTATION, 'Radiographs not uploaded', 'Upload before completion',
    'Assistant', S.CLINICAL),

  /* ---- 11. Staff -------------------------------------------------------------------- */
  x(X.STAFF, 'Staff absent', 'Arrange replacement', 'Clinic Manager', S.OPERATIONAL),
  x(X.STAFF, 'Repeated checklist failures', 'Retraining', 'HR/Owner', S.CLINICAL),
  x(X.STAFF, 'Unauthorized leave', 'Attendance review', 'HR', S.OPERATIONAL),
  x(X.STAFF, 'PPE violation', 'Immediate correction', 'Clinic Manager', S.SAFETY),
  x(X.STAFF, 'Infection control breach', 'Incident report',
    'Infection Control Officer', S.CRITICAL),

  /* ---- 12. Patient communication ------------------------------------------------------ */
  x(X.COMMUNICATION, 'Patient complaint', 'Register complaint', 'Clinic Manager', S.CLINICAL),
  x(X.COMMUNICATION, 'Negative Google review', 'Contact patient', 'Owner', S.OPERATIONAL),
  x(X.COMMUNICATION, 'Poor satisfaction score', 'Clinical review',
    'Treating Dentist', S.CLINICAL),
  x(X.COMMUNICATION, 'Legal notice received', 'Secure records and notify management',
    'Owner', S.CRITICAL),
  x(X.COMMUNICATION, 'Adverse event reported', 'Clinical investigation',
    'Clinical Director', S.CRITICAL),
] as const;

/* -------------------------------------------------------------------------
 * Reading the library
 * ---------------------------------------------------------------------- */

export function exceptionsIn(group: ExceptionGroup): ExceptionRule[] {
  return EXCEPTION_LIBRARY.filter((e) => e.group === group);
}

export function theExceptions(): Array<{
  group: ExceptionGroup; label: string; rules: ExceptionRule[];
}> {
  return (Object.values(ExceptionGroup) as ExceptionGroup[]).map((group) => ({
    group,
    label: EXCEPTION_GROUP_LABEL[group],
    rules: exceptionsIn(group),
  }));
}

/** Exceptions that stop work rather than create it. */
export function stopsWork(): ExceptionRule[] {
  return EXCEPTION_LIBRARY.filter((e) => e.action === ActionKind.BLOCK);
}

/** Exceptions that may not wait even a minute. */
export function immediate(): ExceptionRule[] {
  return EXCEPTION_LIBRARY.filter((e) => isImmediate(e.severity));
}

export function byEscalationSeverity(s: EscalationSeverity): ExceptionRule[] {
  return EXCEPTION_LIBRARY.filter((e) => e.severity === s);
}

/**
 * Escalation targets that are not one of KuBi's thirteen roles.
 *
 * "Implantologist", "Endodontist", "Infection Control Officer" and the rest.
 * Mapping them onto an existing role would name the wrong person; creating
 * six new roles is a decision the owner has not made. Returning them makes
 * the decision visible instead of silently made — constitution rule 4.
 */
export function unmappedRoles(): string[] {
  return [...new Set(EXCEPTION_LIBRARY.map((e) => e.escalateTo))].sort();
}

export function exceptionCoverage(): {
  exceptions: number; groups: number; blocks: number;
  immediate: number; severityStated: number;
} {
  return {
    exceptions: EXCEPTION_LIBRARY.length,
    groups: Object.keys(ExceptionGroup).length,
    blocks: stopsWork().length,
    immediate: immediate().length,
    severityStated: EXCEPTION_LIBRARY.filter((e) => e.severityStated).length,
  };
}
