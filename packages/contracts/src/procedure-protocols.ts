/**
 * The procedure protocols — sixteen treatments, 173 steps.
 *
 * This library is a different shape from the other five, and the difference is
 * the whole point.
 *
 *   daily-standard      the clock raises it        no order beyond the day
 *   patient-journey     a patient raises it        thirteen stages, one path
 *   condition-library   a fact raises it           no order at all
 *   compliance-gates    it refuses                 a checkpoint, not a path
 *   exception-library   a failure raises it        no order at all
 *   → this             a *procedure* raises it    ordered, per treatment
 *
 * A protocol is a **sequence inside one procedure**. An implant surgery is not
 * a set of twenty-five tasks that happen to belong together; it is nine things
 * before, ten during and six after, and the order is clinical rather than
 * administrative. Recording the insertion torque before the implant is placed
 * is not "out of order" — it is impossible, and a system that allowed it would
 * be producing a record that reads correctly and is false.
 *
 * So this file carries `phase` and `order`, and `runProtocol()` returns the
 * *next* step rather than a list. That is the mechanism the owner asked about:
 * a sequential protocol is not a longer checklist, it is a path with a
 * position on it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What the owner specified
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Protocol 1 (new patient consultation) arrived with a Responsible column and
 * a Mandatory column against every step. The other fifteen arrived with the
 * condition and the task only. Those are recorded null, as everywhere else.
 *
 * Four of the sixteen arrived with the owner's own phase headings — RCT,
 * extraction, implant surgery, and by implication the rest. Where a heading
 * was given it is used verbatim. Where it was not, the phase is read off the
 * condition's verb: "advised", "planned" and "accepted" are BEFORE; "started",
 * "placed", "opened", "prepared" and "used" are DURING; "completed" and
 * "delivered" are AFTER. `phaseStated` records which is which, so an inferred
 * phase never passes as a clinical decision somebody made.
 */
import { RoleCode } from './enums.js';

export const Phase = {
  BEFORE: 'BEFORE',
  DURING: 'DURING',
  AFTER: 'AFTER',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const PHASE_ORDER: readonly Phase[] = [Phase.BEFORE, Phase.DURING, Phase.AFTER];
export const PHASE_LABEL: Record<Phase, string> = {
  BEFORE: 'Before', DURING: 'During', AFTER: 'After',
};

export interface ProtocolStep {
  id: string;
  procedure: string;
  phase: Phase;
  /** Position within the whole protocol. Unique per procedure, and meaningful. */
  order: number;
  /** What raises this step, in the owner's wording. */
  when: string;
  /** The step itself, in the owner's wording. */
  task: string;
  /** Null where the clinic has not decided. Never guessed. */
  role: RoleCode | null;
  /** True only where the owner wrote it. */
  mandatory: boolean | null;
  /** False where the phase was read off the condition's verb rather than given. */
  phaseStated: boolean;
}

/**
 * Read the phase out of the condition's verb.
 *
 * Only used where the owner gave no heading. Kept as one function so the
 * reading is consistent and auditable rather than decided row by row.
 */
export function phaseOf(when: string): Phase {
  const w = when.toLowerCase();
  if (/\b(completed|delivered|placed on|visit completed)\b/.test(w)) return Phase.AFTER;
  if (/\b(advised|planned|accepted|required|registered|patient|due)\b/.test(w)) return Phase.BEFORE;
  if (/\b(started|placed|opened|prepared|used|raised|taken|removal|relation|try-in|preparation|mock-up|every visit|impression|trial|healed|received|delivery)\b/.test(w)) {
    return Phase.DURING;
  }
  return Phase.DURING;
}

const counters = new Map<string, number>();
/**
 * A stable short code per procedure.
 *
 * The first attempt sliced the first six letters of the name, and "Implant
 * surgery" and "Implant prosthetics" both became IMPLAN — nine duplicate ids,
 * caught by the uniqueness test rather than by reading. Sequence number
 * instead: dull, and it cannot collide.
 */
const codes = new Map<string, string>();
function codeFor(procedure: string): string {
  if (!codes.has(procedure)) codes.set(procedure, `P${String(codes.size + 1).padStart(2, '0')}`);
  return codes.get(procedure)!;
}

function step(
  procedure: string, when: string, task: string,
  opts: { phase?: Phase; role?: RoleCode; mandatory?: boolean } = {},
): ProtocolStep {
  const n = (counters.get(procedure) ?? 0) + 1;
  counters.set(procedure, n);
  return {
    id: `PRO-${codeFor(procedure)}-${String(n).padStart(2, '0')}`,
    procedure,
    phase: opts.phase ?? phaseOf(when),
    order: n,
    when,
    task,
    role: opts.role ?? null,
    mandatory: opts.mandatory ?? null,
    phaseStated: opts.phase !== undefined,
  };
}

const B = Phase.BEFORE;
const D = Phase.DURING;
const A = Phase.AFTER;
const REC = RoleCode.RECEPTION;
const AST = RoleCode.DENTAL_ASSISTANT;
const DEN = RoleCode.TREATING_DOCTOR;

const P1 = 'New patient consultation';
const P2 = 'Oral examination';
const P3 = 'Radiographs';
const P3b = 'CBCT';
const P4 = 'Scaling and polishing';
const P5 = 'Composite filling';
const P6 = 'Root canal treatment';
const P7 = 'Crown and bridge';
const P8 = 'Extraction';
const P9 = 'Surgical extraction / wisdom tooth';
const P10 = 'Implant surgery';
const P11 = 'Implant prosthetics';
const P12 = 'Complete denture';
const P13 = 'Orthodontics';
const P14 = 'Pediatric dentistry';
const P15 = 'Periodontal surgery';
const P16 = 'Cosmetic dentistry / veneers';

export const PROCEDURE_PROTOCOLS: readonly ProtocolStep[] = [
  /* ---- 1. New patient consultation — fully specified -------------------- */
  step(P1, 'New patient registered', 'Verify patient identity', { role: REC, mandatory: true }),
  step(P1, 'New patient', 'Capture complete demographic details', { role: REC, mandatory: true }),
  step(P1, 'New patient', 'Record medical history', { role: AST, mandatory: true }),
  step(P1, 'New patient', 'Record dental history', { role: DEN, mandatory: true }),
  step(P1, 'New patient', 'Record chief complaint', { role: DEN, mandatory: true }),
  step(P1, 'New patient', 'Record baseline photographs (if consented)', { role: AST, mandatory: true }),
  step(P1, 'New patient', 'Obtain General Treatment Consent', { role: REC, mandatory: true }),
  step(P1, 'New patient', 'Create digital patient file', { role: REC, mandatory: true }),

  /* ---- 2. Oral examination ---------------------------------------------- */
  step(P2, 'Examination started', 'Medical history review'),
  step(P2, 'Examination started', 'Drug allergy verification'),
  step(P2, 'Examination started', 'BP recording (if indicated)'),
  step(P2, 'Examination started', 'Extraoral examination'),
  step(P2, 'Examination started', 'TMJ examination'),
  step(P2, 'Examination started', 'Soft tissue examination'),
  step(P2, 'Examination started', 'Hard tissue examination'),
  step(P2, 'Examination started', 'Periodontal charting'),
  step(P2, 'Examination started', 'Existing restorations charting'),
  step(P2, 'Examination started', 'Caries charting'),
  step(P2, 'Examination started', 'Diagnosis entry'),
  step(P2, 'Examination completed', 'Treatment planning'),

  /* ---- 3. Radiographs, and CBCT -------------------------------------------
     The owner wrote these as one section, but they are two protocols with two
     different triggers — "X-ray advised" and "CBCT advised" — and read as one
     sequence the phases ran backwards. Split, faithfully to the triggers. */
  step(P3, 'X-ray advised', 'Verify indication'),
  step(P3, 'X-ray advised', 'Pregnancy status confirmation'),
  step(P3, 'X-ray advised', 'Radiation consent (if clinic policy)'),
  step(P3, 'X-ray taken', 'Upload image', { phase: D }),
  step(P3, 'X-ray taken', 'Doctor reporting', { phase: A }),
  step(P3b, 'CBCT advised', 'CBCT consent'),
  step(P3b, 'CBCT completed', 'Upload DICOM'),
  step(P3b, 'CBCT completed', 'Review and document findings'),

  /* ---- 4. Scaling and polishing ------------------------------------------ */
  step(P4, 'Scaling planned', 'Scaling consent'),
  step(P4, 'Scaling planned', 'Calculate periodontal indices'),
  step(P4, 'Scaling planned', 'Pre-operative photographs'),
  step(P4, 'Scaling completed', 'Oral hygiene instructions'),
  step(P4, 'Scaling completed', 'Demonstrate brushing technique'),
  step(P4, 'Scaling completed', 'Recommend interdental aids'),
  step(P4, 'Scaling completed', 'Schedule recall'),

  /* ---- 5. Composite filling ---------------------------------------------- */
  step(P5, 'Filling planned', 'Restoration consent'),
  step(P5, 'Filling planned', 'Shade selection'),
  step(P5, 'Filling planned', 'Rubber dam assessment'),
  step(P5, 'Filling started', 'Isolation verification'),
  step(P5, 'Filling completed', 'Check occlusion'),
  step(P5, 'Filling completed', 'Polish restoration'),
  step(P5, 'Filling completed', 'Update tooth chart'),

  /* ---- 6. Root canal treatment — the owner's own four headings ----------- */
  step(P6, 'RCT advised', 'Endodontic consent', { phase: B }),
  step(P6, 'RCT advised', 'Explain multiple visit protocol', { phase: B }),
  step(P6, 'RCT advised', 'Explain crown requirement', { phase: B }),
  step(P6, 'RCT advised', 'Pre-operative radiograph', { phase: B }),
  step(P6, 'RCT advised', 'Rubber dam availability check', { phase: B }),
  step(P6, 'Access started', 'Working length radiograph', { phase: D }),
  step(P6, 'Canal preparation', 'Irrigation protocol', { phase: D }),
  step(P6, 'Canal preparation', 'Instrument log', { phase: D }),
  step(P6, 'Visit completed', 'Temporary restoration', { phase: D }),
  step(P6, 'Visit completed', 'Next appointment', { phase: D }),
  step(P6, 'Obturation planned', 'Master cone radiograph', { phase: D }),
  step(P6, 'Obturation completed', 'Final radiograph', { phase: D }),
  step(P6, 'Obturation completed', 'Clinical notes', { phase: D }),
  step(P6, 'RCT completed', 'Crown reminder', { phase: A }),
  step(P6, 'RCT completed', 'Follow-up review', { phase: A }),

  /* ---- 7. Crown and bridge ------------------------------------------------ */
  step(P7, 'Crown advised', 'Crown consent'),
  step(P7, 'Crown advised', 'Shade selection'),
  step(P7, 'Tooth prepared', 'Gingival retraction', { phase: D }),
  step(P7, 'Tooth prepared', 'Digital scan/impression', { phase: D }),
  step(P7, 'Impression completed', 'Laboratory prescription', { phase: D }),
  step(P7, 'Temporary crown placed', 'Temporary cement instructions', { phase: D }),
  step(P7, 'Lab case received', 'Trial appointment', { phase: D }),
  step(P7, 'Crown delivery', 'Occlusion check', { phase: A }),
  step(P7, 'Crown delivery', 'Cementation record', { phase: A }),
  step(P7, 'Crown delivery', 'Warranty card', { phase: A }),
  step(P7, 'Crown delivery', 'Post-operative instructions', { phase: A }),

  /* ---- 8. Extraction — the owner's own three headings --------------------- */
  step(P8, 'Extraction advised', 'Extraction consent', { phase: B }),
  step(P8, 'Extraction advised', 'Medical clearance verification', { phase: B }),
  step(P8, 'Extraction advised', 'Drug allergy verification', { phase: B }),
  step(P8, 'Extraction advised', 'Bleeding disorder assessment', { phase: B }),
  step(P8, 'Extraction advised', 'Anticoagulant assessment', { phase: B }),
  step(P8, 'Extraction advised', 'Pregnancy assessment', { phase: B }),
  step(P8, 'Extraction advised', 'Pre-operative radiograph', { phase: B }),
  step(P8, 'Extraction started', 'Anaesthetic recording', { phase: D }),
  step(P8, 'Extraction completed', 'Tooth count verification', { phase: D }),
  step(P8, 'Extraction completed', 'Socket inspection', { phase: D }),
  step(P8, 'Extraction completed', 'Hemostasis verification', { phase: D }),
  step(P8, 'Extraction completed', 'Sutures recorded', { phase: D }),
  step(P8, 'Extraction completed', 'Post-operative instructions', { phase: A }),
  step(P8, 'Extraction completed', 'Prescription', { phase: A }),
  step(P8, 'Extraction completed', 'Schedule review', { phase: A }),
  step(P8, 'Sutures placed', 'Suture removal appointment', { phase: A }),

  /* ---- 9. Surgical extraction / wisdom tooth ------------------------------- */
  step(P9, 'Surgery planned', 'Surgical consent'),
  step(P9, 'Surgery planned', 'OPG review'),
  step(P9, 'Surgery planned', 'CBCT review (if required)'),
  step(P9, 'Surgery planned', 'Sterile surgical setup'),
  step(P9, 'Bone removal', 'Record bur used', { phase: D }),
  step(P9, 'Flap raised', 'Record flap type', { phase: D }),
  step(P9, 'Surgery completed', 'Irrigation completed'),
  step(P9, 'Surgery completed', 'Sutures documented'),
  step(P9, 'Surgery completed', 'Ice pack instructions'),
  step(P9, 'Surgery completed', 'Review after 7 days'),

  /* ---- 10. Implant surgery — the owner's own three headings ---------------- */
  step(P10, 'Implant treatment accepted', 'Implant informed consent', { phase: B }),
  step(P10, 'Implant treatment accepted', 'Financial approval', { phase: B }),
  step(P10, 'Implant treatment accepted', 'Medical fitness review', { phase: B }),
  step(P10, 'Implant treatment accepted', 'Smoking assessment', { phase: B }),
  step(P10, 'Implant treatment accepted', 'HbA1c review (if diabetic)', { phase: B }),
  step(P10, 'Implant treatment accepted', 'CBCT evaluation', { phase: B }),
  step(P10, 'Implant treatment accepted', 'Surgical planning approval', { phase: B }),
  step(P10, 'Implant treatment accepted', 'Implant inventory verification', { phase: B }),
  step(P10, 'Implant treatment accepted', 'Sterile implant kit verification', { phase: B }),
  step(P10, 'Implant opened', 'Record implant batch number', { phase: D }),
  step(P10, 'Implant opened', 'Record expiry date', { phase: D }),
  step(P10, 'Implant placed', 'Record implant size', { phase: D }),
  step(P10, 'Implant placed', 'Record insertion torque', { phase: D }),
  step(P10, 'Implant placed', 'Record ISQ value', { phase: D }),
  step(P10, 'Bone graft used', 'Record graft batch', { phase: D }),
  step(P10, 'Membrane used', 'Record membrane batch', { phase: D }),
  step(P10, 'PRF prepared', 'Record centrifuge cycle', { phase: D }),
  step(P10, 'Healing abutment placed', 'Record size', { phase: D }),
  step(P10, 'Surgery completed', 'Post-operative radiograph', { phase: D }),
  step(P10, 'Surgery completed', 'Implant passport generated', { phase: A }),
  step(P10, 'Surgery completed', 'Post-operative instructions', { phase: A }),
  step(P10, 'Surgery completed', 'Antibiotic protocol', { phase: A }),
  step(P10, 'Surgery completed', '24-hour follow-up', { phase: A }),
  step(P10, 'Surgery completed', '7-day review', { phase: A }),
  step(P10, 'Surgery completed', '3-month osseointegration review', { phase: A }),

  /* ---- 11. Implant prosthetics --------------------------------------------- */
  step(P11, 'Implant healed', 'Implant stability assessment', { phase: B }),
  step(P11, 'Impression planned', 'Impression coping verification', { phase: B }),
  step(P11, 'Impression completed', 'Lab work order', { phase: D }),
  step(P11, 'Crown trial', 'Passive fit verification', { phase: D }),
  step(P11, 'Crown delivery', 'Torque prosthetic screw', { phase: A }),
  step(P11, 'Crown delivery', 'Occlusion verification', { phase: A }),
  step(P11, 'Crown delivery', 'Screw access sealing', { phase: A }),
  step(P11, 'Crown delivery', 'Maintenance instructions', { phase: A }),
  step(P11, 'Crown delivery', 'Annual recall', { phase: A }),

  /* ---- 12. Complete denture -------------------------------------------------- */
  step(P12, 'Denture accepted', 'Denture consent'),
  step(P12, 'Primary impression', 'Material recorded', { phase: D }),
  step(P12, 'Secondary impression', 'Border moulding completed', { phase: D }),
  step(P12, 'Jaw relation', 'Vertical dimension verified', { phase: D }),
  step(P12, 'Try-in', 'Aesthetics approved', { phase: D }),
  step(P12, 'Delivery', 'Pressure spot evaluation', { phase: A }),
  step(P12, 'Delivery', 'Denture care instructions', { phase: A }),
  step(P12, 'Delivery', '24-hour adjustment appointment', { phase: A }),

  /* ---- 13. Orthodontics ------------------------------------------------------- */
  step(P13, 'Braces accepted', 'Orthodontic consent'),
  step(P13, 'Braces accepted', 'Pre-treatment photographs'),
  step(P13, 'Braces accepted', 'Study models/scan'),
  step(P13, 'Braces accepted', 'Cephalometric analysis'),
  step(P13, 'Every visit', 'Oral hygiene score', { phase: D }),
  step(P13, 'Every visit', 'Archwire details', { phase: D }),
  step(P13, 'Every visit', 'Elastics instructions', { phase: D }),
  step(P13, 'Every visit', 'Next appointment', { phase: D }),

  /* ---- 14. Pediatric dentistry ------------------------------------------------- */
  step(P14, 'Child patient', 'Parent consent'),
  step(P14, 'Child patient', 'Behaviour assessment'),
  step(P14, 'Child patient', 'Caries risk assessment'),
  step(P14, 'Fluoride planned', 'Fluoride consent'),
  step(P14, 'Pulp therapy', 'Pulp treatment consent', { phase: B }),
  step(P14, 'SSC planned', 'Stainless steel crown consent'),
  step(P14, 'Visit completed', 'Parent instructions', { phase: A }),

  /* ---- 15. Periodontal surgery -------------------------------------------------- */
  step(P15, 'Surgery advised', 'Periodontal surgery consent'),
  step(P15, 'Surgery advised', 'Full-mouth charting verified'),
  step(P15, 'Surgery planned', 'Medical clearance'),
  step(P15, 'Surgery completed', 'Dressing placement'),
  step(P15, 'Surgery completed', 'Chlorhexidine instructions'),
  step(P15, 'Sutures placed', 'Suture removal appointment', { phase: A }),

  /* ---- 16. Cosmetic dentistry / veneers -------------------------------------------- */
  step(P16, 'Veneers accepted', 'Cosmetic treatment consent'),
  step(P16, 'Veneers accepted', 'Smile photographs'),
  step(P16, 'Veneers accepted', 'Digital Smile Design approval'),
  step(P16, 'Mock-up completed', 'Patient approval', { phase: D }),
  step(P16, 'Tooth preparation', 'Shade verification', { phase: D }),
  step(P16, 'Delivery', 'Final photography', { phase: A }),
  step(P16, 'Delivery', 'Maintenance instructions', { phase: A }),
] as const;

/* -------------------------------------------------------------------------
 * The universal ten
 *
 * The owner's own heading: "applicable to all treatments, irrespective of the
 * procedure". They are kept separate rather than copied into all sixteen —
 * duplicating them 160 times is how a library rots, and `stepsFor()` merges
 * them in at read time.
 * ---------------------------------------------------------------------- */

export interface UniversalRule {
  id: string;
  when: string;
  task: string;
}

export const UNIVERSAL_PROTOCOL: readonly UniversalRule[] = [
  { id: 'UNI-01', when: 'Local anaesthetic planned',
    task: 'Record anaesthetic drug, concentration, batch number, expiry, dose, site, and operator' },
  { id: 'UNI-02', when: 'Prescription generated',
    task: 'Check allergy interactions and obtain doctor approval' },
  { id: 'UNI-03', when: 'Laboratory work involved',
    task: 'Generate digital lab prescription and track dispatch/return' },
  { id: 'UNI-04', when: 'Clinical photographs taken',
    task: 'Verify photography consent and upload to patient record' },
  { id: 'UNI-05', when: 'Medical history modified',
    task: 'Flag dentist for review before treatment' },
  { id: 'UNI-06', when: 'Patient refuses treatment',
    task: 'Record refusal, reason, counselling, and obtain refusal signature' },
  { id: 'UNI-07', when: 'Treatment interrupted',
    task: 'Record reason, current status, and reschedule' },
  { id: 'UNI-08', when: 'Complication occurs',
    task: 'Generate incident report and notify Clinic Manager' },
  { id: 'UNI-09', when: 'Referral required',
    task: 'Generate referral letter and schedule follow-up' },
  { id: 'UNI-10', when: 'Treatment completed',
    task: 'Complete clinical notes, update odontogram, issue instructions, collect feedback, and schedule recall' },
] as const;

/* -------------------------------------------------------------------------
 * Reading the protocols
 * ---------------------------------------------------------------------- */

export function procedures(): string[] {
  return [...new Set(PROCEDURE_PROTOCOLS.map((s) => s.procedure))];
}

export function stepsFor(procedure: string): ProtocolStep[] {
  return PROCEDURE_PROTOCOLS
    .filter((s) => s.procedure === procedure)
    .sort((a, b) => a.order - b.order);
}

/** One procedure, grouped into its phases, in order. */
export function protocolOf(procedure: string): Array<{
  phase: Phase; label: string; steps: ProtocolStep[];
}> {
  return PHASE_ORDER
    .map((phase) => ({
      phase,
      label: PHASE_LABEL[phase],
      steps: stepsFor(procedure).filter((s) => s.phase === phase),
    }))
    .filter((p) => p.steps.length > 0);
}

/* -------------------------------------------------------------------------
 * Running a protocol
 *
 * The mechanism the other libraries do not have. `runDay()` answers "where is
 * the clinic"; this answers "where is this procedure, and what is next".
 * ---------------------------------------------------------------------- */

export interface ProtocolRun {
  procedure: string;
  /** The step to do now. Null when the protocol is finished. */
  next: ProtocolStep | null;
  done: ProtocolStep[];
  remaining: ProtocolStep[];
  /** Which phase the procedure is in. Null when finished. */
  phase: Phase | null;
  /**
   * Steps completed out of order — recorded, never rejected.
   *
   * A clinic that works around the system is telling you something about the
   * protocol, and a runner that silently discarded the evidence would lose it.
   * Rejecting is the gate's job; this notices and reports.
   */
  outOfOrder: ProtocolStep[];
  /** How far through, as a real fraction of a real denominator. */
  doneCount: number;
  totalCount: number;
}

export function runProtocol(
  procedure: string, done: ReadonlySet<string> = new Set(),
): ProtocolRun {
  const all = stepsFor(procedure);
  const doneSteps = all.filter((s) => done.has(s.id));
  const remaining = all.filter((s) => !done.has(s.id));
  const next = remaining[0] ?? null;

  // Anything ticked while an earlier step is still outstanding.
  const firstOutstanding = next?.order ?? Number.POSITIVE_INFINITY;
  const outOfOrder = doneSteps.filter((s) => s.order > firstOutstanding);

  return {
    procedure,
    next,
    done: doneSteps,
    remaining,
    phase: next?.phase ?? null,
    outOfOrder,
    doneCount: doneSteps.length,
    totalCount: all.length,
  };
}

export function protocolCoverage(): {
  procedures: number; steps: number; universal: number;
  owned: number; phaseStated: number;
} {
  return {
    procedures: procedures().length,
    steps: PROCEDURE_PROTOCOLS.length,
    universal: UNIVERSAL_PROTOCOL.length,
    owned: PROCEDURE_PROTOCOLS.filter((s) => s.role !== null).length,
    phaseStated: PROCEDURE_PROTOCOLS.filter((s) => s.phaseStated).length,
  };
}

/** Steps with nobody assigned — the worklist, as everywhere else. */
export function protocolNeedsOwner(): ProtocolStep[] {
  return PROCEDURE_PROTOCOLS.filter((s) => s.role === null);
}
