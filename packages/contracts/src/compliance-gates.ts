/**
 * The compliance gates — seventeen universal, twelve treatment-specific.
 *
 * The other four libraries describe work. This one refuses it. That makes it
 * the most consequential thing in the product and the one place where getting
 * the semantics wrong is dangerous rather than untidy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Two constitution rules meet here, and their combination is the point
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **Rule 1 — UNKNOWN is never PASS.** A requirement KuBi cannot evaluate does
 * not quietly succeed. It returns UNKNOWN.
 *
 * **Rule 2 — BLOCK_HARD gates have no override path.** Not a runtime check
 * with a manager's password behind it. There is simply no permission that
 * grants passage.
 *
 * Put together: **a gate switched on today would block almost everything.**
 * Not because the gate is wrong, but because KuBi cannot yet evaluate most of
 * what the owner listed — it holds no allergy field, no pregnancy status, no
 * invoice, no odontogram, no uploaded radiograph. 122 requirements across the
 * seventeen gates, and the system can decide PASS or FAIL on a minority.
 *
 * That is not a reason to soften the gates. It is the roadmap, in the exact
 * order the clinic itself would use it: `blockingToday()` returns what would
 * stop the clinic if this were switched on tomorrow, and every entry names the
 * one thing KuBi would need to hold.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The wording is the owner's, including "Block If"
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The Block If lines are kept verbatim and separately from the requirements,
 * because they are not the same thing. "Medical history incomplete" is the
 * clinic's own statement of what makes the gate refuse — the sentence a
 * receptionist will read at the moment they are stopped. A gate that refuses
 * without saying which requirement refused is the thing that makes staff hate
 * compliance software.
 */
import { EnforcementMode, EvaluationResult } from './enums.js';

export interface GateRequirement {
  id: string;
  /** The owner's wording, unedited. */
  label: string;
  /**
   * Whether KuBi can decide PASS or FAIL on this today. False means the
   * requirement evaluates to UNKNOWN, which for a BLOCK_HARD gate means it
   * refuses — correctly, and unhelpfully, until the data exists.
   */
  evaluable: boolean;
  /** Required whenever `evaluable` is false. What KuBi would need to hold. */
  needs: string | null;
}

export interface ComplianceGate {
  id: string;
  number: number;
  name: string;
  /** What opens the gate. Only gate 1 was given one; the rest are inferred by position. */
  trigger: string | null;
  requirements: GateRequirement[];
  /** The owner's Block If wording, verbatim. Read by whoever is stopped. */
  blockIf: string[];
  /**
   * Every one of these is BLOCK_HARD. The owner wrote "Block If", not
   * "warn if" — and a consent gate with an override is not a consent gate.
   */
  enforcement: typeof EnforcementMode.BLOCK_HARD;
}

/* Shorthand. `needs` present ⇒ not evaluable. */
let rn = 0;
function req(label: string, needs?: string): GateRequirement {
  rn += 1;
  return {
    id: `REQ-${String(rn).padStart(3, '0')}`,
    label,
    evaluable: needs === undefined,
    needs: needs ?? null,
  };
}

/* The recurring reasons, named once so the count per capability is countable. */
const NO_MEDICAL = 'a structured medical history — allergies, conditions, medications '
  + 'and habits held as fields rather than free text';
const NO_MONEY = 'the billing domain — no estimate, invoice, receipt or payment exists';
const NO_FILES = 'file storage — KuBi has no object store, so nothing can be uploaded';
const NO_CODING = 'coded diagnosis and procedure fields, not free-text clinical notes';
const NO_DEMOG = 'the full demographic record — DOB, gender, occupation, emergency contact';
const NO_CONSENT_TYPES = 'consent held per type, not as a single yes/no on the visit';
const NO_ODONTOGRAM = 'an odontogram — KuBi has no tooth-level chart';

function gate(
  number: number, name: string, trigger: string | null,
  requirements: GateRequirement[], blockIf: string[],
): ComplianceGate {
  return {
    id: `GATE-${String(number).padStart(2, '0')}`,
    number, name, trigger, requirements, blockIf,
    enforcement: EnforcementMode.BLOCK_HARD,
  };
}

export const COMPLIANCE_GATES: readonly ComplianceGate[] = [
  gate(1, 'Appointment verification', 'Patient checks in', [
    req('Patient identity verified'),
    req('Mobile number verified', 'a verified-contact flag, not merely a stored number'),
    req('Appointment verified'),
    req('Medical record available'),
    req('Previous records retrieved'),
    req('Outstanding alerts reviewed', NO_MEDICAL),
    req('Returning patient history opened'),
  ], ['Wrong patient', 'Duplicate patient', 'Missing records']),

  gate(2, 'Registration completion', null, [
    req('Demographic details complete', NO_DEMOG),
    req('Address complete', NO_DEMOG),
    req('DOB entered', NO_DEMOG),
    req('Gender entered', NO_DEMOG),
    req('Emergency contact', NO_DEMOG),
    req('Occupation', NO_DEMOG),
    req('Aadhaar/ID (if clinic policy)', NO_DEMOG),
    req('Consent for data storage', NO_CONSENT_TYPES),
    req('Privacy policy acknowledgement', NO_CONSENT_TYPES),
  ], ['Mandatory demographic fields missing']),

  gate(3, 'Medical safety', null, [
    req('Medical history updated'),
    req('Drug history', NO_MEDICAL),
    req('Allergy history', NO_MEDICAL),
    req('Pregnancy status', NO_MEDICAL),
    req('Diabetes status', NO_MEDICAL),
    req('Hypertension status', NO_MEDICAL),
    req('Cardiac history', NO_MEDICAL),
    req('Bleeding disorders', NO_MEDICAL),
    req('Current medications', NO_MEDICAL),
    req('Previous surgeries', NO_MEDICAL),
    req('Tobacco habit', NO_MEDICAL),
    req('Alcohol history', NO_MEDICAL),
  ], ['Medical history incomplete']),

  gate(4, 'Clinical assessment', null, [
    req('Chief complaint', NO_CODING),
    req('Clinical examination', NO_CODING),
    req('Diagnosis entered', NO_CODING),
    req('Tooth number selected', NO_ODONTOGRAM),
    req('Radiographs reviewed', NO_FILES),
    req('Clinical photographs (if required)', NO_FILES),
  ], ['Diagnosis missing']),

  gate(5, 'Treatment planning', null, [
    req('Treatment plan documented', NO_CODING),
    req('Alternative options explained'),
    req('Risks explained'),
    req('Benefits explained'),
    req('Estimated cost prepared', NO_MONEY),
    req('Patient questions answered'),
  ], ['Treatment plan missing']),

  gate(6, 'Financial approval', null, [
    req('Estimate approved', NO_MONEY),
    req('Package selected', NO_MONEY),
    req('Payment plan chosen', NO_MONEY),
    req('Advance received (if required)', NO_MONEY),
  ], ['Financial approval pending']),

  gate(7, 'Consent', null, [
    req('General treatment consent'),
    req('Procedure-specific consent'),
    req('Anaesthesia consent', NO_CONSENT_TYPES),
    req('Implant consent', NO_CONSENT_TYPES),
    req('Surgical consent', NO_CONSENT_TYPES),
    req('Photography consent', NO_CONSENT_TYPES),
    req('Parent consent', NO_CONSENT_TYPES),
    req('Sedation consent', NO_CONSENT_TYPES),
    req('Blood product consent', NO_CONSENT_TYPES),
    req('Medical clearance uploaded (if required)', NO_FILES),
  ], ['Any required consent missing']),

  gate(8, 'Pre-operative safety', null, [
    req('Patient identity confirmed'),
    req('Correct tooth verified', NO_ODONTOGRAM),
    req('Correct treatment verified'),
    req('Correct side verified', NO_ODONTOGRAM),
    req('Correct implant verified'),
    req('Correct shade verified', 'shade recorded on the procedure'),
    req('Correct prosthesis verified'),
    req('Sterility confirmed'),
    req('Equipment functional'),
    req('Emergency drugs available'),
    req('Oxygen available'),
  ], ['Any verification fails']),

  gate(9, 'Anaesthesia safety', null, [
    req('Drug verified', 'a drug administration record'),
    req('Expiry checked', 'a drug administration record'),
    req('Batch number recorded', 'a drug administration record'),
    req('Dose recorded', 'a drug administration record'),
    req('Injection site documented', 'a drug administration record'),
    req('Time documented', 'a drug administration record'),
  ], ['Drug documentation incomplete']),

  gate(10, 'Procedure documentation', null, [
    req('Procedure started'),
    req('Materials recorded', 'consumables recorded against the procedure'),
    req('Implant batch'),
    req('Graft batch', 'consumables recorded against the procedure'),
    req('Membrane batch', 'consumables recorded against the procedure'),
    req('Suture type', 'consumables recorded against the procedure'),
    req('Lot numbers'),
    req('Clinical notes'),
  ], ['Traceability incomplete']),

  gate(11, 'Laboratory', null, [
    req('Impression verified'),
    req('Digital scan uploaded', NO_FILES),
    req('Shade selected', 'shade recorded on the lab case'),
    req('Bite recorded', 'shade recorded on the lab case'),
    req('Lab prescription generated'),
    req('Delivery date entered'),
  ], ['Lab prescription incomplete']),

  gate(12, 'Prosthesis delivery', null, [
    req('Trial approved'),
    req('Fit verified'),
    req('Margins verified', 'a delivery checklist on the lab case'),
    req('Contacts verified', 'a delivery checklist on the lab case'),
    req('Occlusion verified', 'a delivery checklist on the lab case'),
    req('Patient approval', 'a delivery checklist on the lab case'),
    req('Cement/screw details recorded', 'a delivery checklist on the lab case'),
  ], ['Occlusion not verified']),

  gate(13, 'Post-operative care', null, [
    req('Instructions explained'),
    req('Written instructions issued'),
    req('Prescription issued', 'prescriptions held as records'),
    req('Emergency contact shared', NO_DEMOG),
    req('Follow-up appointment booked'),
  ], ['Instructions not documented']),

  gate(14, 'Billing closure', null, [
    req('Treatment entered'),
    req('Invoice generated', NO_MONEY),
    req('Discounts approved', NO_MONEY),
    req('Payment collected', NO_MONEY),
    req('Receipt generated', NO_MONEY),
  ], ['Billing incomplete']),

  gate(15, 'Clinical documentation closure', null, [
    req('Clinical notes complete'),
    req('Odontogram updated', NO_ODONTOGRAM),
    req('Diagnosis coded', NO_CODING),
    req('Procedures coded', NO_CODING),
    req('Materials documented', 'consumables recorded against the procedure'),
    req('Attachments uploaded', NO_FILES),
    req('Radiographs uploaded', NO_FILES),
    req('Photos uploaded', NO_FILES),
  ], ['Clinical record incomplete']),

  gate(16, 'Patient exit', null, [
    req('Next appointment booked'),
    req('Feedback requested', 'feedback captured as a record with a score'),
    req('Recall entered', 'a recall clock per procedure type'),
    req('Reports delivered', NO_FILES),
    req('Warranty issued (if applicable)', 'a warranty record on the prosthesis'),
  ], ['Recall not created']),

  gate(17, 'End-of-day clinical closure', null, [
    req('All notes signed', 'a signature state on the clinical note'),
    req('All prescriptions signed', 'prescriptions held as records with a signature state'),
    req('All laboratory cases dispatched'),
    req('Sterilization complete'),
    req('Biomedical waste logged'),
    req('Equipment shut down'),
    req('Cash reconciled', NO_MONEY),
  ], ['Day cannot be closed']),
] as const;

/* -------------------------------------------------------------------------
 * Treatment-specific gates
 *
 * These sit on top of the seventeen rather than replacing any of them. An
 * implant surgery passes gates 1–17 *and* its own seven.
 * ---------------------------------------------------------------------- */

export interface TreatmentGate {
  treatment: string;
  requirements: GateRequirement[];
}

export const TREATMENT_GATES: readonly TreatmentGate[] = [
  {
    treatment: 'Composite restoration',
    requirements: [
      req('Shade selection', 'shade recorded on the procedure'),
      req('Isolation method documented', 'an isolation field on the procedure'),
      req('Occlusion checked', 'a finishing checklist on the procedure'),
      req('Restoration finished and polished', 'a finishing checklist on the procedure'),
    ],
  },
  {
    treatment: 'Root canal treatment',
    requirements: [
      req('Working length verified', 'endodontic measurements on the procedure'),
      req('Rubber dam documented (or reason for omission)',
        'an isolation field that accepts a documented reason for omission'),
      req('Irrigation protocol recorded', 'endodontic measurements on the procedure'),
      req('Master cone verified', 'endodontic measurements on the procedure'),
      req('Obturation radiograph uploaded', NO_FILES),
    ],
  },
  {
    treatment: 'Crown & bridge',
    requirements: [
      req('Tooth preparation approved', NO_ODONTOGRAM),
      req('Retraction completed', 'a prosthetic checklist on the procedure'),
      req('Impression/scan accepted'),
      req('Temporary restoration placed', 'a prosthetic checklist on the procedure'),
      req('Lab prescription completed'),
      req('Cementation documented', 'a prosthetic checklist on the procedure'),
    ],
  },
  {
    treatment: 'Extraction',
    requirements: [
      req('Medical fitness confirmed', NO_MEDICAL),
      req('Pre-operative radiograph available', NO_FILES),
      req('Haemostasis achieved', 'a surgical checklist on the procedure'),
      req('Socket inspected', 'a surgical checklist on the procedure'),
      req('Post-operative instructions acknowledged',
        'an acknowledgement from the patient, not merely an issued instruction'),
    ],
  },
  {
    treatment: 'Surgical extraction',
    requirements: [
      req('Surgical consent', NO_CONSENT_TYPES),
      req('Flap design documented', 'a surgical checklist on the procedure'),
      req('Bone removal documented', 'a surgical checklist on the procedure'),
      req('Suture details recorded', 'a surgical checklist on the procedure'),
      req('Review appointment scheduled'),
    ],
  },
  {
    treatment: 'Implant surgery',
    requirements: [
      req('CBCT approved', NO_FILES),
      req('Surgical plan approved', 'a surgical plan record with an approval state'),
      req('Implant batch scanned'),
      req('Insertion torque recorded', 'implant placement measurements'),
      req('ISQ recorded (if applicable)', 'implant placement measurements'),
      req('Post-operative radiograph uploaded', NO_FILES),
      req('Implant passport generated', 'an implant passport document'),
    ],
  },
  {
    treatment: 'Implant prosthetics',
    requirements: [
      req('Osseointegration confirmed', 'implant placement measurements'),
      req('Impression accuracy verified', 'a prosthetic checklist on the procedure'),
      req('Prosthetic screw torque recorded', 'implant placement measurements'),
      req('Occlusion verified', 'a prosthetic checklist on the procedure'),
      req('Maintenance schedule created', 'a recall clock per procedure type'),
    ],
  },
  {
    treatment: 'Complete denture',
    requirements: [
      req('Jaw relation approved', 'a denture stage checklist'),
      req('Try-in accepted', 'a denture stage checklist'),
      req('Aesthetics approved', 'a denture stage checklist'),
      req('Delivery checklist completed', 'a denture stage checklist'),
      req('Pressure point review scheduled'),
    ],
  },
  {
    treatment: 'Orthodontics',
    requirements: [
      req('Diagnostic records complete', NO_FILES),
      req('Cephalometric analysis approved', NO_FILES),
      req('Treatment objectives documented', NO_CODING),
      req('Oral hygiene assessed at each visit', 'an oral hygiene score per visit'),
    ],
  },
  {
    treatment: 'Pediatric dentistry',
    requirements: [
      req('Parent consent obtained', NO_CONSENT_TYPES),
      req('Behaviour assessment documented', 'a paediatric assessment record'),
      req('Weight recorded when relevant', 'vitals held as numbers'),
      req('Post-treatment instructions given to guardian',
        'an acknowledgement from the guardian'),
    ],
  },
  {
    treatment: 'Periodontal surgery',
    requirements: [
      req('Full periodontal charting completed', NO_ODONTOGRAM),
      req('Pocket depths recorded', NO_ODONTOGRAM),
      req('Surgery notes documented'),
      req('Dressing placed', 'a surgical checklist on the procedure'),
      req('Suture review scheduled'),
    ],
  },
  {
    treatment: 'Cosmetic dentistry',
    requirements: [
      req('Smile design approved', NO_FILES),
      req('Shade accepted', 'shade recorded on the procedure'),
      req('Mock-up approved', 'a cosmetic stage checklist'),
      req('Pre- and post-operative photographs documented', NO_FILES),
    ],
  },
] as const;

/* -------------------------------------------------------------------------
 * Evaluating a gate
 * ---------------------------------------------------------------------- */

export interface GateVerdict {
  gateId: string;
  name: string;
  /** PASS only when every requirement passed. Anything else refuses. */
  verdict: typeof EvaluationResult.PASS | typeof EvaluationResult.FAIL;
  passed: GateRequirement[];
  /** Evaluable, and not satisfied. The clinic can fix these today. */
  failed: GateRequirement[];
  /** Not evaluable at all. UNKNOWN — and UNKNOWN is never PASS. */
  unknown: GateRequirement[];
  /** The owner's own words for why it refuses, shown to whoever is stopped. */
  blockIf: string[];
}

/**
 * Run a gate.
 *
 * `satisfied` holds the requirement ids the clinic has actually met. Anything
 * evaluable and absent from it is a FAIL. Anything not evaluable is UNKNOWN,
 * and UNKNOWN never passes — so a gate with one unevaluable requirement
 * refuses, permanently, until KuBi can hold the thing it needs.
 *
 * That is deliberately uncomfortable. A gate that shrugged at what it could
 * not measure would be a gate that passes an implant surgery with no consent
 * on file, and would be worth less than nothing.
 */
export function evaluateGate(
  gate: ComplianceGate, satisfied: ReadonlySet<string> = new Set(),
): GateVerdict {
  const passed: GateRequirement[] = [];
  const failed: GateRequirement[] = [];
  const unknown: GateRequirement[] = [];

  for (const r of gate.requirements) {
    if (!r.evaluable) unknown.push(r);
    else if (satisfied.has(r.id)) passed.push(r);
    else failed.push(r);
  }

  return {
    gateId: gate.id,
    name: gate.name,
    verdict: failed.length === 0 && unknown.length === 0
      ? EvaluationResult.PASS
      : EvaluationResult.FAIL,
    passed,
    failed,
    unknown,
    blockIf: gate.blockIf,
  };
}

/* -------------------------------------------------------------------------
 * Reading the gates
 * ---------------------------------------------------------------------- */

export function allRequirements(): GateRequirement[] {
  return [
    ...COMPLIANCE_GATES.flatMap((g) => g.requirements),
    ...TREATMENT_GATES.flatMap((t) => t.requirements),
  ];
}

/**
 * What would stop the clinic if these were switched on tomorrow.
 *
 * Every gate whose verdict cannot be PASS even with the clinic doing
 * everything right, because KuBi cannot evaluate at least one requirement.
 */
export function blockingToday(): GateVerdict[] {
  const everything = new Set(allRequirements().map((r) => r.id));
  return COMPLIANCE_GATES
    .map((g) => evaluateGate(g, everything))
    .filter((v) => v.verdict !== EvaluationResult.PASS);
}

/** Gates KuBi could enforce today, with nothing new built. */
export function enforceableToday(): ComplianceGate[] {
  return COMPLIANCE_GATES.filter((g) => g.requirements.every((r) => r.evaluable));
}

/** What KuBi would need to hold, worst first — the roadmap, by unlock size. */
export function missingForGates(): Array<{ needs: string; requirements: GateRequirement[] }> {
  const by = new Map<string, GateRequirement[]>();
  for (const r of allRequirements()) {
    if (r.evaluable || !r.needs) continue;
    by.set(r.needs, [...(by.get(r.needs) ?? []), r]);
  }
  return [...by.entries()]
    .map(([needs, requirements]) => ({ needs, requirements }))
    .sort((a, b) => b.requirements.length - a.requirements.length);
}

export function gateCoverage(): {
  gates: number; treatmentGates: number; requirements: number;
  evaluable: number; enforceable: number;
} {
  const all = allRequirements();
  return {
    gates: COMPLIANCE_GATES.length,
    treatmentGates: TREATMENT_GATES.length,
    requirements: all.length,
    evaluable: all.filter((r) => r.evaluable).length,
    enforceable: enforceableToday().length,
  };
}
