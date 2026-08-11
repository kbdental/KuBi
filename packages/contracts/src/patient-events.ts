/**
 * The patient event engine — a booking generates its own work.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The idea, in the owner's words
 * ─────────────────────────────────────────────────────────────────────────
 *
 * *"The patient's clinical journey automatically generates work… Nobody needs
 * to manually create these tasks."*
 *
 * Booking an implant is what makes the consent, the medical-history check, the
 * inventory reservation, the surgical kit and the pre-op scan exist. Nobody
 * types them in, nobody remembers them, and nobody can quietly not create one.
 * Delivering the implant is what makes the post-op instructions, the
 * prescription check, tomorrow's call and the next appointment exist.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Why this is derived and not stored
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `careFor()` is a pure function of the booking, the patient's known facts and
 * the log. There is no task table to fall out of step with the protocol, and
 * correcting the protocol corrects every future booking at once — including
 * the ones already in the diary, which is the whole point of not copying rows
 * out of a template at booking time.
 *
 * It is the same rule the morning and the evening already follow: **calculated,
 * never ticked.** What is stored is that somebody *did* a thing
 * (`CARE_ITEM_MET`), never that the thing was *required* — the requirement is
 * the clinic's opinion and the log is the truth.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Where UNKNOWN is never PASS stops being a slogan
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Some items only apply to some patients: an anticoagulant review applies if
 * the patient is on a blood thinner, antibiotic prophylaxis if they carry a
 * cardiac indication, an MRONJ assessment if they are on a bisphosphonate.
 *
 * The obvious implementation asks `if (patient.anticoagulant)` and skips the
 * item when the answer is false — which silently also skips it when the answer
 * is **not known**, and an unasked question then looks exactly like a
 * negative one. So a fact here is `true | false | null`, `null` means nobody
 * has asked, and a conditional item on an unknown fact resolves to `UNKNOWN`,
 * which never passes and — where the item blocks — holds the appointment.
 *
 * That is constitution rule 1 applied to a person rather than to a checklist,
 * and it is the difference between a clinic that knows a patient is not on
 * warfarin and one that never asked.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * What this file is not
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The catalogue below is an **operational scaffold, not a clinical
 * standard**. The timings, the gates and the conditions are drawn from
 * ordinary practice so that the machinery has something real to run on; every
 * one of them is the clinical director's to confirm or overrule, and
 * `UNRATIFIED_CATALOGUE` says so in the data rather than in a comment nobody
 * reads. Nothing here has been signed off, and the engine does not pretend
 * otherwise.
 */
import { RoleCode } from './enums.js';
import { Objective } from './objectives.js';
import { ClinicEvent } from './operating-model.js';
import type { ReadinessEvent } from './readiness.js';

/* -------------------------------------------------------------------------
 * Time, said the way a clinic says it
 * ---------------------------------------------------------------------- */

const mins = (n: number) => n;
const hours = (n: number) => n * 60;
const days = (n: number) => n * 24 * 60;

/* -------------------------------------------------------------------------
 * What we know about a patient, and what we have not asked
 * ---------------------------------------------------------------------- */

/**
 * The medical facts that change what a treatment requires.
 *
 * Every one is `true | false | null`, and **null is not false**. A clinic that
 * has never asked whether this patient takes a blood thinner is not a clinic
 * where the patient does not take one.
 *
 * Deliberately short. This is not a medical history — it is the subset of a
 * history that changes the *work*, which is a much smaller thing, and keeping
 * it small is what stops it drifting into a second patient record.
 */
export interface PatientFacts {
  /** Warfarin, DOACs, dual antiplatelet — anything that changes bleeding. */
  anticoagulated: boolean | null;
  /** A cardiac indication for antibiotic prophylaxis. */
  prophylaxisIndicated: boolean | null;
  /** Diabetes, which changes healing and appointment timing. */
  diabetic: boolean | null;
  /** Bisphosphonate or antiresorptive therapy — MRONJ risk on extraction. */
  antiresorptive: boolean | null;
  /** Pregnancy, which changes radiography and drug choice. */
  pregnant: boolean | null;
  /** Penicillin allergy, which changes the prescription rather than adding one. */
  penicillinAllergy: boolean | null;
  /** A smoker, which changes implant and graft consent and healing advice. */
  smoker: boolean | null;
  /** Under 18 — consent is the guardian's, not the patient's. */
  minor: boolean | null;
}

export type PatientFactKey = keyof PatientFacts;

/** Nothing asked yet. The honest starting point, and never the same as "no". */
export const NOTHING_KNOWN: PatientFacts = {
  anticoagulated: null,
  prophylaxisIndicated: null,
  diabetic: null,
  antiresorptive: null,
  pregnant: null,
  penicillinAllergy: null,
  smoker: null,
  minor: null,
};

/* -------------------------------------------------------------------------
 * A care item
 * ---------------------------------------------------------------------- */

/** Whether an outstanding item stops the treatment or merely appears on a list. */
export const CareGate = {
  /** The treatment may not start. No override, like every other hard gate. */
  BLOCK: 'BLOCK',
  /** Real work, on somebody's list, that does not hold a patient in a chair. */
  ADVISE: 'ADVISE',
} as const;
export type CareGate = (typeof CareGate)[keyof typeof CareGate];

/** Before the appointment, or after the treatment was delivered. */
export const CareStage = { BEFORE: 'BEFORE', AFTER: 'AFTER' } as const;
export type CareStage = (typeof CareStage)[keyof typeof CareStage];

/**
 * The five-valued result, the same one the constitution names.
 *
 * `NOT_APPLICABLE` requires a positive rule — the fact is known to be false.
 * `UNKNOWN` is the absence of information and is never a pass.
 */
export const CareState = {
  MET: 'MET',
  OUTSTANDING: 'OUTSTANDING',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type CareState = (typeof CareState)[keyof typeof CareState];

export interface CareItem {
  /** Unique within a treatment. `CONSENT`, `IMPLANT_STOCK`, `REVIEW_24H`. */
  id: string;
  label: string;
  owner: RoleCode;
  objective: Objective;
  stage: CareStage;
  /**
   * Minutes before the appointment (`BEFORE`) or after delivery (`AFTER`).
   *
   * This is the part a checklist cannot do. "Pre-op antibiotic" is not a tick
   * — it is a thing that must happen *one hour before*, and an item with no
   * clock is one that gets done in the waiting room or not at all.
   */
  offsetMinutes: number;
  gate: CareGate;
  /** Said to the person who has to be told why the chair is not moving. */
  because: string;
  /**
   * The patient fact this depends on. Absent means it always applies.
   *
   * When the fact is `null`, the item is `UNKNOWN` — never skipped.
   */
  needs?: PatientFactKey;
  /** Applies when the fact is *false* rather than true — e.g. no allergy. */
  needsAbsent?: boolean;
}

const item = (
  id: string, label: string, owner: RoleCode, objective: Objective,
  stage: CareStage, offsetMinutes: number, gate: CareGate, because: string,
  needs?: PatientFactKey, needsAbsent = false,
): CareItem => ({
  id, label, owner, objective, stage, offsetMinutes, gate, because,
  ...(needs ? { needs } : {}),
  ...(needs && needsAbsent ? { needsAbsent } : {}),
});

/* -------------------------------------------------------------------------
 * Bundles — the reason adding a treatment is composition, not typing
 * ---------------------------------------------------------------------- */

const DOC = RoleCode.TREATING_DOCTOR;
const REC = RoleCode.RECEPTION;
const ASST = RoleCode.DENTAL_ASSISTANT;
const STER = RoleCode.STERILIZATION_TECHNICIAN;
const LAB = RoleCode.LAB_COORDINATOR;
const INV = RoleCode.INVENTORY_COORDINATOR;

/**
 * True of every treatment, including a ten-minute check-up.
 *
 * Consent is separated from the medical history on purpose: they are signed by
 * different people at different moments, and a clinic that treats them as one
 * row cannot tell you which of the two is missing.
 */
const universal = (): CareItem[] => [
  item('HISTORY', 'Medical history verified', ASST, Objective.PATIENT_SAFE,
    CareStage.BEFORE, days(1), CareGate.BLOCK,
    'Nobody has confirmed this patient’s medical history for today'),
  // The owner, checking the engine against his own protocol: *"I mean for
  // every treatment."* These three were on the implant list and nowhere else,
  // and there is no treatment they do not belong to — a patient who has not
  // been told what to take, or whether to eat, has not been prepared for a
  // filling either.
  item('PREOP_DOC', 'Pre-operative records complete and in the file', DOC,
    Objective.RECORDS_COMPLETE, CareStage.BEFORE, days(1), CareGate.BLOCK,
    'The pre-operative records for this procedure are not complete'),
  item('MED_INSTRUCTIONS', 'Medicine instructions given to the patient', DOC,
    Objective.PATIENT_SAFE, CareStage.BEFORE, days(1), CareGate.BLOCK,
    'The patient has not been told what to take, and what to stop, before today'),
  // Advisory by default and re-declared as blocking for surgery, where an
  // unfed diabetic or an unfasted sedation case is a real problem rather than
  // an inconvenience.
  item('MEAL_INSTRUCTIONS', 'Eating and drinking instructions given', REC,
    Objective.PATIENT_HAPPY, CareStage.BEFORE, days(1), CareGate.ADVISE,
    'The patient has not been told whether to eat before this appointment'),
  item('CONSENT', 'Consent taken', DOC, Objective.RECORDS_COMPLETE,
    CareStage.BEFORE, mins(15), CareGate.BLOCK,
    'Consent has not been signed'),
  item('GUARDIAN', 'Guardian consent taken', DOC, Objective.RECORDS_COMPLETE,
    CareStage.BEFORE, mins(15), CareGate.BLOCK,
    'The patient is a minor and a guardian has not consented',
    'minor'),
  item('NOTES', 'Clinical note written', DOC, Objective.RECORDS_COMPLETE,
    CareStage.AFTER, hours(4), CareGate.BLOCK,
    'The clinical note for this treatment has not been written'),
  item('CHARGE', 'Treatment charged', REC, Objective.MONEY_COLLECTED,
    CareStage.AFTER, hours(2), CareGate.ADVISE,
    'This treatment has not been billed'),
];

/** Anything where a needle goes in. */
const anaesthetic = (): CareItem[] => [
  item('LA_REVIEW', 'Anaesthetic and allergy check', DOC, Objective.PATIENT_SAFE,
    CareStage.BEFORE, mins(10), CareGate.BLOCK,
    'The anaesthetic and allergy check has not been done'),
  item('VITALS', 'Blood pressure and pulse recorded', ASST, Objective.PATIENT_SAFE,
    CareStage.BEFORE, mins(15), CareGate.ADVISE,
    'Baseline observations have not been recorded'),
];

/** Any procedure that draws blood or opens a flap. */
const bleeding = (): CareItem[] => [
  item('ANTICOAG', 'Anticoagulant plan agreed with the prescriber', DOC,
    Objective.PATIENT_SAFE, CareStage.BEFORE, days(3), CareGate.BLOCK,
    'The patient is anticoagulated and no bleeding plan has been agreed',
    'anticoagulated'),
  item('PROPHYLAXIS', 'Antibiotic prophylaxis given', DOC, Objective.PATIENT_SAFE,
    CareStage.BEFORE, hours(1), CareGate.BLOCK,
    'Prophylaxis is indicated and has not been given — and it must be one hour before, not on the way in',
    'prophylaxisIndicated'),
  item('GLYCAEMIC', 'Glycaemic control confirmed and appointment timed to a meal',
    DOC, Objective.PATIENT_SAFE, CareStage.BEFORE, days(1), CareGate.ADVISE,
    'The patient is diabetic and glycaemic control has not been confirmed',
    'diabetic'),
];

/**
 * The same spine, at the pace an emergency actually runs.
 *
 * A walk-in cannot have had records completed the day before an appointment
 * that was made ten minutes ago. The requirements do not disappear — they are
 * re-declared at zero offset, so they are due now rather than retrospectively
 * late. Dropping them instead would have made the emergency the one place the
 * protocol does not apply, which is the place it matters most.
 */
const emergencyPrep = (): CareItem[] => [
  item('PREOP_DOC', 'Records made at the time, not afterwards', DOC,
    Objective.RECORDS_COMPLETE, CareStage.BEFORE, mins(0), CareGate.BLOCK,
    'There is no record of the presenting complaint and examination'),
  item('MED_INSTRUCTIONS', 'Medicine instructions given before the patient leaves', DOC,
    Objective.PATIENT_SAFE, CareStage.BEFORE, mins(0), CareGate.BLOCK,
    'The patient has not been told what to take'),
  item('MEAL_INSTRUCTIONS', 'Eating and drinking instructions given', REC,
    Objective.PATIENT_HAPPY, CareStage.BEFORE, mins(0), CareGate.ADVISE,
    'The patient has not been told whether to eat'),
];

/** Blood work that has to be back, and read, before the day. */
const investigated = (leadDays: number): CareItem[] => [
  item('INVESTIGATIONS', 'Blood investigations reported and reviewed', DOC,
    Objective.PATIENT_SAFE, CareStage.BEFORE, days(leadDays), CareGate.BLOCK,
    'The investigations this surgery depends on are not back, or are back and unread'),
];

/** Anything surgical: a flap, a bur on bone, a suture. */
const surgical = (): CareItem[] => [
  // Sharpened from the universal advisory version: an unfasted sedation case
  // or an unfed diabetic is a cancelled list, not an inconvenience.
  item('MEAL_INSTRUCTIONS', 'Eating and drinking instructions given', REC,
    Objective.PATIENT_SAFE, CareStage.BEFORE, days(1), CareGate.BLOCK,
    'The patient has not been told whether to eat or fast before surgery'),
  item('MRONJ', 'Antiresorptive risk assessed and the patient warned', DOC,
    Objective.PATIENT_SAFE, CareStage.BEFORE, days(3), CareGate.BLOCK,
    'The patient is on an antiresorptive and the osteonecrosis risk has not been assessed',
    'antiresorptive'),
  item('STERILE_PACK', 'Surgical kit reserved and released sterile', STER,
    Objective.PATIENT_SAFE, CareStage.BEFORE, hours(2), CareGate.BLOCK,
    'No sterile surgical kit has been reserved for this appointment'),
  item('SURGICAL_ROOM', 'Operatory prepared for a surgical case', ASST,
    Objective.PATIENT_SAFE, CareStage.BEFORE, mins(30), CareGate.BLOCK,
    'The room has not been set up for surgery'),
  item('POST_OP', 'Post-operative instructions given, written as well as spoken',
    DOC, Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(30), CareGate.BLOCK,
    'The patient has not been given written post-operative instructions'),
  item('ANALGESIA', 'Prescription written and checked against allergies', DOC,
    Objective.PATIENT_SAFE, CareStage.AFTER, mins(30), CareGate.BLOCK,
    'The prescription has not been written or not been checked'),
  item('CALL_24H', 'Next-day call', REC, Objective.PATIENT_HAPPY,
    CareStage.AFTER, days(1), CareGate.ADVISE,
    'The next-day call has not been made'),
  item('REVIEW', 'Review appointment booked', REC, Objective.PATIENT_RECALLED,
    CareStage.AFTER, hours(2), CareGate.ADVISE,
    'No review appointment has been booked'),
];

/** Sutures placed means sutures removed, and nobody should have to remember. */
const sutures = (afterDays: number): CareItem[] => [
  item('SUTURES_OUT', `Suture removal booked, ${afterDays} days on`, REC,
    Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, hours(2), CareGate.BLOCK,
    'Sutures were placed and no removal appointment exists'),
];

/** Radiography, with the one condition that changes it. */
const imaging = (what: string, leadDays: number): CareItem[] => [
  item('IMAGING', `${what} taken and reported`, DOC, Objective.PATIENT_SAFE,
    CareStage.BEFORE, days(leadDays), CareGate.BLOCK,
    `The ${what.toLowerCase()} this treatment is planned from does not exist`),
  item('PREGNANCY_IMAGING', 'Pregnancy confirmed before exposure', ASST,
    Objective.PATIENT_SAFE, CareStage.BEFORE, mins(30), CareGate.BLOCK,
    'Pregnancy status is not established and this treatment exposes the patient',
    'pregnant'),
];

/** Anything the lab makes. Five moments, and four of them are somebody's job. */
const labCase = (what: string, labDays: number): CareItem[] => [
  item('SHADE', 'Shade taken in daylight, before the tooth dehydrates', DOC,
    Objective.TREATMENT_SUCCESSFUL, CareStage.BEFORE, mins(0), CareGate.ADVISE,
    'No shade has been recorded'),
  item('IMPRESSION', 'Impression or scan taken and checked', DOC,
    Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(30), CareGate.BLOCK,
    'No impression or scan has been taken'),
  item('LAB_OUT', `${what} dispatched to the laboratory`, LAB,
    Objective.CLINIC_EFFICIENT, CareStage.AFTER, hours(6), CareGate.BLOCK,
    'The case has not been dispatched to the laboratory'),
  item('LAB_BACK', `${what} returned and checked, ${labDays} working days`, LAB,
    Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, days(labDays), CareGate.ADVISE,
    'The laboratory work is not back, or is back and unchecked'),
  item('FIT_APPT', 'Fit appointment booked to the laboratory date', REC,
    Objective.CLINIC_EFFICIENT, CareStage.AFTER, hours(4), CareGate.BLOCK,
    'No fit appointment exists, or it is booked before the work can be back'),
];

/** Kit that has to be physically present, in a size nobody guesses on the day. */
const stockFor = (what: string, leadDays: number): CareItem[] => [
  item('STOCK', `${what} confirmed in stock and reserved`, INV,
    Objective.PATIENT_SAFE, CareStage.BEFORE, days(leadDays), CareGate.BLOCK,
    `${what} has not been confirmed in stock for this appointment`),
];

const recall = (months: number): CareItem[] => [
  item('RECALL', `Recall set, ${months} months`, REC, Objective.PATIENT_RECALLED,
    CareStage.AFTER, hours(4), CareGate.ADVISE,
    'No recall has been set'),
];

const smokingAdvice = (): CareItem[] => [
  item('SMOKING', 'Smoking cessation advice recorded', DOC,
    Objective.TREATMENT_SUCCESSFUL, CareStage.BEFORE, days(1), CareGate.ADVISE,
    'The patient smokes and no cessation advice is recorded against this plan',
    'smoker'),
];

/* -------------------------------------------------------------------------
 * The catalogue
 * ---------------------------------------------------------------------- */

export const TreatmentCategory = {
  DIAGNOSTIC: 'DIAGNOSTIC',
  PREVENTIVE: 'PREVENTIVE',
  RESTORATIVE: 'RESTORATIVE',
  ENDODONTIC: 'ENDODONTIC',
  PERIODONTAL: 'PERIODONTAL',
  SURGICAL: 'SURGICAL',
  IMPLANT: 'IMPLANT',
  PROSTHETIC: 'PROSTHETIC',
  ORTHODONTIC: 'ORTHODONTIC',
  PAEDIATRIC: 'PAEDIATRIC',
  COSMETIC: 'COSMETIC',
  EMERGENCY: 'EMERGENCY',
} as const;
export type TreatmentCategory =
  (typeof TreatmentCategory)[keyof typeof TreatmentCategory];

export interface Treatment {
  code: string;
  name: string;
  category: TreatmentCategory;
  /** Typical chair time. Drives the diary, not the gates. */
  minutes: number;
  /** Sittings this treatment normally takes, where more than one. */
  sittings: number;
  items: readonly CareItem[];
}

const treatment = (
  code: string, name: string, category: TreatmentCategory,
  minutes: number, sittings: number, ...groups: CareItem[][]
): Treatment => ({
  code, name, category, minutes, sittings,
  items: dedupe(groups.flat()),
});

/** Last one wins, so a treatment can sharpen a bundle's item by re-declaring it. */
function dedupe(items: readonly CareItem[]): CareItem[] {
  const byId = new Map<string, CareItem>();
  for (const i of items) byId.set(i.id, i);
  return [...byId.values()];
}

/**
 * Every treatment this clinic books, and the work each one creates.
 *
 * Ordered by category rather than alphabetically, because the list is read by
 * somebody looking for "the surgical ones" far more often than by somebody
 * looking for a code they already know.
 */
export const TREATMENTS: readonly Treatment[] = [
  /* ── Diagnostic ─────────────────────────────────────────────────────── */
  treatment('CONSULT', 'Consultation and examination',
    TreatmentCategory.DIAGNOSTIC, 20, 1,
    universal(),
    [item('CHARTING', 'Charting and diagnosis recorded', DOC,
      Objective.RECORDS_COMPLETE, CareStage.AFTER, hours(2), CareGate.BLOCK,
      'The examination has no charting or diagnosis against it')],
    [item('PLAN', 'Treatment plan presented and costed', DOC,
      Objective.PATIENT_HAPPY, CareStage.AFTER, days(1), CareGate.ADVISE,
      'No treatment plan has been presented')],
    recall(6)),

  treatment('OPG', 'Panoramic radiograph (OPG)',
    TreatmentCategory.DIAGNOSTIC, 15, 1,
    universal(),
    imaging('Panoramic radiograph', 0)),

  treatment('CBCT', 'Cone-beam CT',
    TreatmentCategory.DIAGNOSTIC, 20, 1,
    universal(),
    imaging('Cone-beam CT', 0),
    [item('JUSTIFY', 'Exposure justified in writing against the question asked',
      DOC, Objective.PATIENT_SAFE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'A CBCT has been booked and the justification for the dose is not recorded')],
    [item('REPORT', 'Radiology report written', DOC, Objective.RECORDS_COMPLETE,
      CareStage.AFTER, days(2), CareGate.BLOCK,
      'The scan has been taken and not reported')]),

  /* ── Preventive ─────────────────────────────────────────────────────── */
  treatment('SCALE', 'Scaling and polishing',
    TreatmentCategory.PREVENTIVE, 30, 1,
    universal(),
    [item('PROPHYLAXIS', 'Antibiotic prophylaxis given', DOC,
      Objective.PATIENT_SAFE, CareStage.BEFORE, hours(1), CareGate.BLOCK,
      'Prophylaxis is indicated and has not been given one hour before',
      'prophylaxisIndicated')],
    [item('AEROSOL', 'Aerosol control set up — high-volume suction within 23 cm',
      ASST, Objective.PATIENT_SAFE, CareStage.BEFORE, mins(15), CareGate.BLOCK,
      'This is an aerosol-generating procedure and aerosol control is not set up')],
    [item('OHI', 'Oral hygiene instruction given', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(30), CareGate.ADVISE,
      'No oral hygiene instruction is recorded')],
    recall(6)),

  treatment('FLUORIDE', 'Fluoride application',
    TreatmentCategory.PREVENTIVE, 15, 1,
    universal(),
    [item('DIET', 'Dietary advice recorded', DOC, Objective.TREATMENT_SUCCESSFUL,
      CareStage.AFTER, mins(30), CareGate.ADVISE,
      'No dietary advice is recorded against a caries-risk patient')],
    recall(4)),

  treatment('SEALANT', 'Fissure sealant',
    TreatmentCategory.PREVENTIVE, 20, 1,
    universal(),
    [item('ISOLATION', 'Isolation achieved and recorded', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.BEFORE, mins(10), CareGate.ADVISE,
      'A sealant placed without isolation will fail, and isolation is not recorded')],
    recall(6)),

  /* ── Restorative ────────────────────────────────────────────────────── */
  treatment('FILLING', 'Composite restoration',
    TreatmentCategory.RESTORATIVE, 45, 1,
    universal(), anaesthetic(),
    imaging('Bitewing or periapical radiograph', 0),
    [item('SHADE', 'Shade taken in daylight, before the tooth dehydrates', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.BEFORE, mins(0), CareGate.ADVISE,
      'No shade has been recorded')],
    [item('OCCLUSION', 'Occlusion checked and adjusted', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(0), CareGate.BLOCK,
      'The restoration has not been checked in occlusion')]),

  treatment('CROWN', 'Crown — preparation and fit',
    TreatmentCategory.RESTORATIVE, 60, 2,
    universal(), anaesthetic(),
    imaging('Periapical radiograph', 0),
    labCase('Crown', 7),
    [item('TEMP', 'Temporary crown fitted and the patient warned about it', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(0), CareGate.BLOCK,
      'The tooth has been prepared and no temporary is recorded')],
    [item('OCCLUSION', 'Occlusion checked at fit', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(0), CareGate.BLOCK,
      'The crown has not been checked in occlusion')]),

  treatment('BRIDGE', 'Bridge — preparation and fit',
    TreatmentCategory.RESTORATIVE, 90, 2,
    universal(), anaesthetic(),
    imaging('Periapical radiographs of every abutment', 0),
    labCase('Bridge', 10),
    [item('ABUTMENT_VITALITY', 'Vitality of every abutment tested and recorded',
      DOC, Objective.PATIENT_SAFE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'A bridge is planned and the abutment teeth have not been vitality tested')],
    [item('TEMP', 'Temporary bridge fitted', DOC, Objective.TREATMENT_SUCCESSFUL,
      CareStage.AFTER, mins(0), CareGate.BLOCK,
      'The abutments have been prepared and no temporary is recorded')]),

  treatment('POST_CORE', 'Post and core',
    TreatmentCategory.RESTORATIVE, 60, 1,
    universal(), anaesthetic(),
    imaging('Periapical radiograph', 0),
    [item('RCT_DONE', 'Root treatment confirmed complete and settled', DOC,
      Objective.PATIENT_SAFE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'A post cannot go into a root that is not confirmed treated and symptom-free')],
    stockFor('Post system and matching drill', 2)),

  /* ── Endodontic ─────────────────────────────────────────────────────── */
  treatment('RCT_ANT', 'Root canal — anterior',
    TreatmentCategory.ENDODONTIC, 60, 1,
    universal(), anaesthetic(),
    imaging('Pre-operative periapical radiograph', 0),
    [item('DAM', 'Rubber dam isolation', DOC, Objective.PATIENT_SAFE,
      CareStage.BEFORE, mins(10), CareGate.BLOCK,
      'Root treatment without rubber dam is not this clinic’s standard')],
    [item('WORKING_LENGTH', 'Working length radiograph taken', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(0), CareGate.BLOCK,
      'No working length radiograph exists for this canal')],
    [item('POST_RCT_XRAY', 'Post-obturation radiograph taken', DOC,
      Objective.RECORDS_COMPLETE, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'The canal has been filled and no post-obturation film exists')],
    [item('CORONAL_SEAL', 'Definitive coronal restoration planned and booked', REC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, days(1), CareGate.BLOCK,
      'A root-treated tooth has no definitive restoration booked, which is how they fracture')]),

  treatment('RCT_POST', 'Root canal — posterior, multi-rooted',
    TreatmentCategory.ENDODONTIC, 90, 2,
    universal(), anaesthetic(),
    imaging('Pre-operative periapical radiograph', 0),
    [item('DAM', 'Rubber dam isolation', DOC, Objective.PATIENT_SAFE,
      CareStage.BEFORE, mins(10), CareGate.BLOCK,
      'Root treatment without rubber dam is not this clinic’s standard')],
    [item('WORKING_LENGTH', 'Working length radiograph taken, every canal', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(0), CareGate.BLOCK,
      'No working length radiograph exists for every canal')],
    [item('POST_RCT_XRAY', 'Post-obturation radiograph taken', DOC,
      Objective.RECORDS_COMPLETE, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'The canals have been filled and no post-obturation film exists')],
    [item('CORONAL_SEAL', 'Cuspal-coverage restoration planned and booked', REC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, days(1), CareGate.BLOCK,
      'A root-treated posterior tooth has no cuspal coverage booked')],
    stockFor('Rotary file set for the case', 2)),

  treatment('RCT_RETREAT', 'Root canal retreatment',
    TreatmentCategory.ENDODONTIC, 120, 2,
    universal(), anaesthetic(),
    imaging('Pre-operative periapical radiograph', 0),
    [item('WHY_FAILED', 'Reason the first treatment failed recorded', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'A retreatment is booked and nobody has written down why the first one failed')],
    [item('CONSENT', 'Consent taken, including the lower success rate', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, mins(15), CareGate.BLOCK,
      'Consent for retreatment has not been taken')],
    [item('POST_RCT_XRAY', 'Post-obturation radiograph taken', DOC,
      Objective.RECORDS_COMPLETE, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'The canals have been refilled and no film exists')]),

  treatment('APICO', 'Apicoectomy',
    TreatmentCategory.ENDODONTIC, 90, 1,
    universal(), anaesthetic(), bleeding(), surgical(), sutures(7),
    imaging('CBCT or periapical radiograph', 3),
    stockFor('Retrograde filling material and micro-surgical kit', 3)),

  /* ── Periodontal ────────────────────────────────────────────────────── */
  treatment('SRP', 'Deep scaling and root planing, per quadrant',
    TreatmentCategory.PERIODONTAL, 45, 4,
    universal(), anaesthetic(), bleeding(),
    [item('POCKET_CHART', 'Six-point pocket chart recorded', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'Periodontal treatment is planned from a pocket chart that does not exist')],
    [item('REASSESS', 'Reassessment booked, 6–8 weeks', REC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, days(1), CareGate.BLOCK,
      'Root planing without a reassessment is a treatment nobody ever measures')],
    smokingAdvice(),
    recall(3)),

  treatment('PERIO_FLAP', 'Periodontal flap surgery',
    TreatmentCategory.PERIODONTAL, 90, 1,
    universal(), anaesthetic(), bleeding(), surgical(), sutures(10),
    [item('SRP_FIRST', 'Non-surgical phase completed and reassessed', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.BEFORE, days(7), CareGate.BLOCK,
      'Flap surgery is booked before the non-surgical phase has been reassessed')],
    smokingAdvice(),
    recall(3)),

  treatment('CROWN_LENGTH', 'Crown lengthening',
    TreatmentCategory.PERIODONTAL, 60, 1,
    universal(), anaesthetic(), bleeding(), surgical(), sutures(7),
    [item('HEAL_WAIT', 'Restorative appointment booked no sooner than 6 weeks on',
      REC, Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, hours(4), CareGate.BLOCK,
      'The margin will move as it heals; a restorative appointment inside six weeks will be redone')]),

  /* ── Surgical ───────────────────────────────────────────────────────── */
  treatment('EXTRACT', 'Simple extraction',
    TreatmentCategory.SURGICAL, 30, 1,
    universal(), anaesthetic(), bleeding(),
    imaging('Periapical radiograph', 0),
    [item('MRONJ', 'Antiresorptive risk assessed and the patient warned', DOC,
      Objective.PATIENT_SAFE, CareStage.BEFORE, days(3), CareGate.BLOCK,
      'The patient is on an antiresorptive and the osteonecrosis risk has not been assessed',
      'antiresorptive')],
    [item('SITE_CHECK', 'Tooth and side confirmed against the notes at the chair',
      DOC, Objective.PATIENT_SAFE, CareStage.BEFORE, mins(5), CareGate.BLOCK,
      'The tooth to be removed has not been confirmed against the record')],
    [item('POST_OP', 'Post-extraction instructions given, written as well as spoken',
      DOC, Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'The patient has not been given written post-extraction instructions')],
    [item('HAEMOSTASIS', 'Haemostasis confirmed before the patient leaves', DOC,
      Objective.PATIENT_SAFE, CareStage.AFTER, mins(15), CareGate.BLOCK,
      'The patient has not been confirmed to have stopped bleeding')],
    [item('CALL_24H', 'Next-day call', REC, Objective.PATIENT_HAPPY,
      CareStage.AFTER, days(1), CareGate.ADVISE,
      'The next-day call has not been made')],
    [item('REPLACEMENT', 'Replacement options discussed and recorded', DOC,
      Objective.PATIENT_RECALLED, CareStage.AFTER, days(1), CareGate.ADVISE,
      'A tooth has been removed and no replacement conversation is recorded')]),

  treatment('SURG_EXTRACT', 'Surgical extraction',
    TreatmentCategory.SURGICAL, 60, 1,
    universal(), anaesthetic(), bleeding(), surgical(), sutures(7),
    imaging('Periapical radiograph', 0),
    [item('SITE_CHECK', 'Tooth and side confirmed against the notes at the chair',
      DOC, Objective.PATIENT_SAFE, CareStage.BEFORE, mins(5), CareGate.BLOCK,
      'The tooth to be removed has not been confirmed against the record')],
    [item('HAEMOSTASIS', 'Haemostasis confirmed before the patient leaves', DOC,
      Objective.PATIENT_SAFE, CareStage.AFTER, mins(15), CareGate.BLOCK,
      'The patient has not been confirmed to have stopped bleeding')],
    [item('REPLACEMENT', 'Replacement options discussed and recorded', DOC,
      Objective.PATIENT_RECALLED, CareStage.AFTER, days(1), CareGate.ADVISE,
      'A tooth has been removed and no replacement conversation is recorded')]),

  treatment('THIRD_MOLAR', 'Impacted third molar removal',
    TreatmentCategory.SURGICAL, 75, 1,
    universal(), anaesthetic(), bleeding(), surgical(), sutures(7),
    imaging('OPG, and CBCT where the roots approach the canal', 7),
    [item('NERVE_CONSENT', 'Nerve injury risk consented specifically', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'Inferior alveolar and lingual nerve risk has not been specifically consented')],
    [item('ESCORT', 'Escort home arranged where sedation is planned', REC,
      Objective.PATIENT_SAFE, CareStage.BEFORE, days(1), CareGate.ADVISE,
      'No escort is recorded for a sedation case')],
    [item('TRISMUS', 'Trismus and swelling warned about, in writing', DOC,
      Objective.PATIENT_HAPPY, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'The patient has not been warned in writing about swelling and trismus')]),

  treatment('BIOPSY', 'Soft tissue biopsy',
    TreatmentCategory.SURGICAL, 45, 1,
    universal(), anaesthetic(), bleeding(), surgical(), sutures(7),
    [item('SPECIMEN', 'Specimen fixed, labelled and the form completed', DOC,
      Objective.PATIENT_SAFE, CareStage.AFTER, hours(2), CareGate.BLOCK,
      'A biopsy specimen has not been fixed, labelled and sent')],
    [item('HISTO_CHASE', 'Histopathology result chased and filed', DOC,
      Objective.PATIENT_SAFE, CareStage.AFTER, days(10), CareGate.BLOCK,
      'A biopsy result has not come back, and an unchased biopsy is the most dangerous open item in a dental practice')],
    [item('RESULT_APPT', 'Appointment booked to give the result in person', REC,
      Objective.PATIENT_HAPPY, CareStage.AFTER, days(7), CareGate.BLOCK,
      'No appointment exists at which to give the biopsy result')]),

  treatment('FRENECTOMY', 'Frenectomy',
    TreatmentCategory.SURGICAL, 30, 1,
    universal(), anaesthetic(), bleeding(), surgical(), sutures(7),
    [item('EXERCISES', 'Stretching exercises taught and given in writing', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'Post-operative stretching has not been taught, and without it the frenum reattaches')]),

  /* ── Implant ────────────────────────────────────────────────────────── */
  treatment('IMPLANT', 'Implant placement',
    TreatmentCategory.IMPLANT, 90, 1,
    universal(), anaesthetic(), bleeding(), surgical(), sutures(10),
    investigated(7),
    imaging('CBCT of the site', 14),
    smokingAdvice(),
    [item('PLAN_SIGNED', 'Implant plan, size and position agreed from the scan',
      DOC, Objective.PATIENT_SAFE, CareStage.BEFORE, days(7), CareGate.BLOCK,
      'No implant plan has been agreed from the scan')],
    [item('IMPLANT_STOCK', 'Implant, cover screw and one size either side reserved',
      INV, Objective.PATIENT_SAFE, CareStage.BEFORE, days(3), CareGate.BLOCK,
      'The implant and its neighbouring sizes are not confirmed in stock — a case that opens without the next size up closes without an implant')],
    [item('DRILL_KIT', 'Surgical drill kit checked, complete and sterile', STER,
      Objective.PATIENT_SAFE, CareStage.BEFORE, hours(4), CareGate.BLOCK,
      'The implant drill kit has not been checked complete and released sterile')],
    [item('GUIDE', 'Surgical guide back from the laboratory and tried in', LAB,
      Objective.PATIENT_SAFE, CareStage.BEFORE, days(3), CareGate.ADVISE,
      'A guided case has no guide back from the laboratory')],
    [item('TORQUE', 'Insertion torque and stability recorded', DOC,
      Objective.RECORDS_COMPLETE, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'Insertion torque has not been recorded, and the loading decision depends on it')],
    [item('OSSEO_WAIT', 'Osseointegration review booked, 3–4 months', REC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, hours(4), CareGate.BLOCK,
      'No integration review has been booked')],
    [item('PASSPORT', 'Implant passport issued to the patient', REC,
      Objective.RECORDS_COMPLETE, CareStage.AFTER, days(1), CareGate.BLOCK,
      'The patient has not been given a record of what was placed in them')]),

  treatment('BONE_GRAFT', 'Bone graft or sinus lift',
    TreatmentCategory.IMPLANT, 90, 1,
    universal(), anaesthetic(), bleeding(), surgical(), sutures(10),
    investigated(7),
    imaging('CBCT of the site', 14),
    smokingAdvice(),
    [item('GRAFT_STOCK', 'Graft material, membrane and fixation reserved', INV,
      Objective.PATIENT_SAFE, CareStage.BEFORE, days(5), CareGate.BLOCK,
      'Graft material and membrane are not confirmed in stock')],
    [item('SINUS_CONSENT', 'Sinus perforation risk consented specifically', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'Sinus perforation and graft failure have not been specifically consented')],
    [item('NO_BLOW', 'No-nose-blowing instructions given in writing', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'The patient has not been given written sinus precautions')],
    [item('HEAL_WAIT', 'Implant appointment booked no sooner than the graft allows',
      REC, Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, hours(4), CareGate.ADVISE,
      'No implant appointment has been sequenced against the graft healing time')]),

  treatment('IMPLANT_EXPOSE', 'Implant exposure and healing abutment',
    TreatmentCategory.IMPLANT, 30, 1,
    universal(), anaesthetic(), bleeding(),
    [item('INTEGRATION', 'Integration confirmed radiographically and clinically',
      DOC, Objective.PATIENT_SAFE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'The implant has not been confirmed integrated')],
    [item('ABUTMENT_STOCK', 'Healing abutment of the right height reserved', INV,
      Objective.CLINIC_EFFICIENT, CareStage.BEFORE, days(3), CareGate.BLOCK,
      'No healing abutment of the right height is confirmed in stock')]),

  treatment('IMPLANT_CROWN', 'Implant crown',
    TreatmentCategory.IMPLANT, 60, 2,
    universal(),
    labCase('Implant crown', 10),
    [item('IMPRESSION_PARTS', 'Impression coping and analogue for this system reserved',
      INV, Objective.CLINIC_EFFICIENT, CareStage.BEFORE, days(3), CareGate.BLOCK,
      'The impression coping and analogue for this implant system are not confirmed in stock')],
    [item('TORQUE_FINAL', 'Abutment torqued to the manufacturer’s figure and recorded',
      DOC, Objective.RECORDS_COMPLETE, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'The abutment torque has not been recorded')],
    [item('MAINT', 'Implant maintenance appointment booked, 6 months', REC,
      Objective.PATIENT_RECALLED, CareStage.AFTER, hours(4), CareGate.BLOCK,
      'No implant maintenance recall has been set')]),

  /* ── Prosthetic ─────────────────────────────────────────────────────── */
  treatment('DENTURE_FULL', 'Complete denture',
    TreatmentCategory.PROSTHETIC, 45, 5,
    universal(),
    labCase('Complete denture', 7),
    [item('STAGES', 'Five sittings booked as a series, not one at a time', REC,
      Objective.CLINIC_EFFICIENT, CareStage.BEFORE, days(1), CareGate.ADVISE,
      'A denture is five appointments; booking them one at a time is how a case takes four months')],
    [item('REVIEW_48H', 'Sore-spot review booked, 48 hours after fit', REC,
      Objective.PATIENT_HAPPY, CareStage.AFTER, hours(4), CareGate.BLOCK,
      'No 48-hour review is booked after a denture fit')]),

  treatment('DENTURE_PART', 'Removable partial denture',
    TreatmentCategory.PROSTHETIC, 45, 4,
    universal(),
    labCase('Partial denture', 10),
    [item('SURVEY', 'Design surveyed and rest seats prepared', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'A partial denture has been sent to the laboratory without a surveyed design')],
    [item('REVIEW_48H', 'Sore-spot review booked, 48 hours after fit', REC,
      Objective.PATIENT_HAPPY, CareStage.AFTER, hours(4), CareGate.BLOCK,
      'No 48-hour review is booked after a denture fit')]),

  treatment('VENEERS', 'Veneers',
    TreatmentCategory.COSMETIC, 90, 2,
    universal(), anaesthetic(),
    labCase('Veneers', 10),
    [item('PHOTOS', 'Clinical photographs taken before any preparation', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'No pre-operative photographs exist, and a cosmetic case without them cannot be defended or discussed')],
    [item('MOCKUP', 'Mock-up or wax-up shown and approved in writing', DOC,
      Objective.PATIENT_HAPPY, CareStage.BEFORE, days(3), CareGate.BLOCK,
      'The patient has not seen and approved what they are going to get')],
    [item('TEMP', 'Temporaries fitted', DOC, Objective.TREATMENT_SUCCESSFUL,
      CareStage.AFTER, mins(0), CareGate.BLOCK,
      'Teeth have been prepared and no temporaries are recorded')]),

  treatment('WHITENING', 'Tooth whitening',
    TreatmentCategory.COSMETIC, 45, 2,
    universal(),
    [item('PHOTOS', 'Shade photographed before starting', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'No starting shade has been photographed, so no result can be shown')],
    [item('CARIES_FREE', 'Caries and defective restorations excluded first', DOC,
      Objective.PATIENT_SAFE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'Whitening over untreated caries or a leaking margin is refused')],
    [item('TRAYS', 'Custom trays back from the laboratory', LAB,
      Objective.CLINIC_EFFICIENT, CareStage.BEFORE, days(5), CareGate.BLOCK,
      'The whitening trays are not back from the laboratory')],
    [item('SENSITIVITY', 'Sensitivity managed and reviewed', DOC,
      Objective.PATIENT_HAPPY, CareStage.AFTER, days(7), CareGate.ADVISE,
      'Nobody has checked how the patient is getting on with sensitivity')]),

  /* ── Orthodontic ────────────────────────────────────────────────────── */
  treatment('ORTHO_START', 'Fixed appliance bonding',
    TreatmentCategory.ORTHODONTIC, 90, 1,
    universal(),
    imaging('OPG, lateral cephalogram and clinical photographs', 14),
    [item('RECORDS', 'Study models or scans and full records taken', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, days(7), CareGate.BLOCK,
      'Orthodontic records are incomplete, and a case cannot be assessed without a starting point')],
    [item('HYGIENE_GATE', 'Oral hygiene assessed as adequate for fixed appliances',
      DOC, Objective.PATIENT_SAFE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'Bonding onto poor hygiene produces decalcification, and hygiene has not been assessed')],
    [item('BRACKET_STOCK', 'Bracket prescription and archwire sequence in stock',
      INV, Objective.CLINIC_EFFICIENT, CareStage.BEFORE, days(5), CareGate.BLOCK,
      'The bracket prescription for this case is not confirmed in stock')],
    [item('ADJUST_SERIES', 'Adjustment appointments booked as a series', REC,
      Objective.CLINIC_EFFICIENT, CareStage.AFTER, days(1), CareGate.BLOCK,
      'No adjustment series has been booked, and orthodontic cases drift when appointments are made one at a time')],
    [item('EMERGENCY_INFO', 'What to do about a loose bracket, in writing', REC,
      Objective.PATIENT_HAPPY, CareStage.AFTER, mins(30), CareGate.ADVISE,
      'The patient has not been told what to do when something comes loose')]),

  treatment('ORTHO_ADJUST', 'Orthodontic adjustment',
    TreatmentCategory.ORTHODONTIC, 20, 1,
    universal(),
    [item('PROGRESS', 'Progress against the plan recorded', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'An adjustment has been done and no progress note exists')],
    [item('NEXT', 'Next adjustment booked before the patient leaves', REC,
      Objective.CLINIC_EFFICIENT, CareStage.AFTER, mins(15), CareGate.BLOCK,
      'The patient has left without the next adjustment booked')]),

  treatment('ORTHO_DEBOND', 'Debonding and retention',
    TreatmentCategory.ORTHODONTIC, 60, 1,
    universal(),
    [item('FINAL_RECORDS', 'Final records and photographs taken', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, days(1), CareGate.BLOCK,
      'No final records exist for a case about to be debonded')],
    [item('RETAINER_STOCK', 'Retainer ordered and back before the debond', LAB,
      Objective.TREATMENT_SUCCESSFUL, CareStage.BEFORE, days(5), CareGate.BLOCK,
      'Debonding without a retainer in the drawer is how relapse starts, the same week')],
    [item('RETAINER_INSTR', 'Retainer wear instructions given in writing', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'Retainer instructions have not been given in writing')],
    [item('RETENTION_REVIEW', 'Retention reviews booked, 3 and 12 months', REC,
      Objective.PATIENT_RECALLED, CareStage.AFTER, hours(4), CareGate.BLOCK,
      'No retention reviews are booked')]),

  /* ── Paediatric ─────────────────────────────────────────────────────── */
  treatment('PULPOTOMY', 'Pulpotomy — primary tooth',
    TreatmentCategory.PAEDIATRIC, 45, 1,
    universal(), anaesthetic(),
    [item('GUARDIAN', 'Guardian present and consenting', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, mins(15), CareGate.BLOCK,
      'No guardian is recorded as present and consenting')],
    [item('BEHAVIOUR', 'Behaviour management approach agreed with the guardian',
      DOC, Objective.PATIENT_HAPPY, CareStage.BEFORE, days(1), CareGate.ADVISE,
      'No behaviour management approach has been agreed')],
    [item('CROWN_PLAN', 'Stainless steel crown planned at the same visit', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.BEFORE, days(1), CareGate.ADVISE,
      'A pulpotomy without cuspal coverage tends to come back')],
    recall(4)),

  treatment('SS_CROWN', 'Stainless steel crown — primary tooth',
    TreatmentCategory.PAEDIATRIC, 45, 1,
    universal(), anaesthetic(),
    [item('GUARDIAN', 'Guardian present and consenting', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, mins(15), CareGate.BLOCK,
      'No guardian is recorded as present and consenting')],
    stockFor('Crown sizes either side of the expected one', 2),
    recall(4)),

  treatment('SPACE_MAINT', 'Space maintainer',
    TreatmentCategory.PAEDIATRIC, 45, 2,
    universal(),
    labCase('Space maintainer', 7),
    [item('GUARDIAN', 'Guardian present and consenting', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, mins(15), CareGate.BLOCK,
      'No guardian is recorded as present and consenting')],
    [item('ERUPTION_WATCH', 'Eruption review booked, 6 months', REC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, hours(4), CareGate.BLOCK,
      'A space maintainer left unreviewed becomes an obstruction')]),

  /* ── Emergency ──────────────────────────────────────────────────────── */
  treatment('EMERG_PAIN', 'Emergency — acute pain',
    TreatmentCategory.EMERGENCY, 30, 1,
    emergencyPrep(),
    [item('TRIAGE', 'Triaged on arrival', REC, Objective.PATIENT_SAFE,
      CareStage.BEFORE, mins(5), CareGate.BLOCK,
      'An emergency patient has not been triaged')],
    [item('HISTORY', 'Medical history verified', ASST, Objective.PATIENT_SAFE,
      CareStage.BEFORE, mins(10), CareGate.BLOCK,
      'Nobody has confirmed this patient’s medical history')],
    [item('CONSENT', 'Consent taken for what is being done today', DOC,
      Objective.RECORDS_COMPLETE, CareStage.BEFORE, mins(5), CareGate.BLOCK,
      'Consent has not been taken')],
    [item('DEFINITIVE', 'Definitive treatment appointment booked', REC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, hours(2), CareGate.BLOCK,
      'The pain has been relieved and nothing has been booked to fix the cause')],
    [item('NOTES', 'Clinical note written', DOC, Objective.RECORDS_COMPLETE,
      CareStage.AFTER, hours(4), CareGate.BLOCK,
      'The clinical note for this treatment has not been written')],
    [item('CALL_24H', 'Next-day call', REC, Objective.PATIENT_HAPPY,
      CareStage.AFTER, days(1), CareGate.ADVISE,
      'The next-day call has not been made')]),

  treatment('EMERG_ABSCESS', 'Emergency — abscess drainage',
    TreatmentCategory.EMERGENCY, 45, 1,
    universal(), anaesthetic(), bleeding(), emergencyPrep(),
    [item('TRIAGE', 'Triaged on arrival', REC, Objective.PATIENT_SAFE,
      CareStage.BEFORE, mins(5), CareGate.BLOCK,
      'An emergency patient has not been triaged')],
    [item('SPREAD', 'Spreading infection excluded — airway, eye, swallowing, fever',
      DOC, Objective.PATIENT_SAFE, CareStage.BEFORE, mins(10), CareGate.BLOCK,
      'Spreading infection has not been excluded, and this is the assessment that decides whether the patient belongs in a hospital')],
    [item('DRAIN', 'Drainage achieved and recorded', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(0), CareGate.BLOCK,
      'No drainage is recorded')],
    [item('ANTIBIOTIC', 'Antibiotic decision recorded, with the reason either way',
      DOC, Objective.PATIENT_SAFE, CareStage.AFTER, mins(30), CareGate.BLOCK,
      'No antibiotic decision is recorded — and "none, because drainage was achieved" is a decision worth writing down')],
    [item('REVIEW_48H', 'Review booked, 48 hours', REC,
      Objective.PATIENT_SAFE, CareStage.AFTER, hours(2), CareGate.BLOCK,
      'No 48-hour review is booked after draining an abscess')]),

  treatment('EMERG_TRAUMA', 'Emergency — dental trauma or avulsion',
    TreatmentCategory.EMERGENCY, 60, 1,
    universal(), anaesthetic(), emergencyPrep(),
    imaging('Periapical radiographs of the injured teeth', 0),
    [item('TRIAGE', 'Triaged on arrival', REC, Objective.PATIENT_SAFE,
      CareStage.BEFORE, mins(5), CareGate.BLOCK,
      'An emergency patient has not been triaged')],
    [item('HEAD_INJURY', 'Head injury and other injuries excluded', DOC,
      Objective.PATIENT_SAFE, CareStage.BEFORE, mins(5), CareGate.BLOCK,
      'A trauma patient has not been assessed for injuries beyond the mouth')],
    [item('TETANUS', 'Tetanus status established', DOC, Objective.PATIENT_SAFE,
      CareStage.BEFORE, mins(15), CareGate.BLOCK,
      'Tetanus status has not been established for a contaminated wound')],
    [item('SPLINT', 'Splinting done and the removal date recorded', DOC,
      Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, mins(0), CareGate.BLOCK,
      'A splint has been placed with no removal date recorded')],
    [item('TRAUMA_FOLLOW', 'Trauma follow-up series booked — 2, 4, 8 weeks, 6 and 12 months',
      REC, Objective.TREATMENT_SUCCESSFUL, CareStage.AFTER, hours(4), CareGate.BLOCK,
      'No trauma follow-up series is booked, and these teeth are lost by not being watched')],
    [item('SAFEGUARD', 'Safeguarding considered where the injury and the story differ',
      DOC, Objective.PATIENT_SAFE, CareStage.AFTER, hours(4), CareGate.ADVISE,
      'Safeguarding has not been considered')]),
];

/** By code, because the screen and the engine both look treatments up. */
export const TREATMENT_BY_CODE: ReadonlyMap<string, Treatment> =
  new Map(TREATMENTS.map((t) => [t.code, t]));

/**
 * Nothing in the catalogue has been signed off.
 *
 * The constitution: *"Never silently resolve an open Owner Decision."* The
 * timings, the gates and the conditions above were derived from ordinary
 * practice so the engine had something real to run, and every one is the
 * clinical director's to confirm or overrule. This constant exists so that a
 * screen can say so, a test can assert it is still true, and nobody can
 * mistake a scaffold for a ratified protocol by reading the code.
 *
 * It becomes `false` when the clinical director has been through the
 * catalogue, and not before.
 */
export const UNRATIFIED_CATALOGUE = true;

/* -------------------------------------------------------------------------
 * A booking, and where it has got to
 * ---------------------------------------------------------------------- */

export interface Booking {
  id: string;
  treatmentCode: string;
  /** How a person says who it is for. Patient names are allowed; roles are for staff. */
  patientLabel: string;
  /** The minute the appointment starts. */
  at: number;
  /** Which sitting of a multi-sitting treatment this is. */
  sitting: number;
}

export interface CareTask extends CareItem {
  state: CareState;
  /** The minute this is due — the appointment offset by the item's own clock. */
  dueAt: number;
  doneAt: number | null;
  /** Past its due minute and not met. */
  late: boolean;
  /** Why it does not apply, where it does not. */
  standsAsideBecause: string | null;
}

export interface Care {
  booking: Booking;
  treatment: Treatment;
  before: readonly CareTask[];
  after: readonly CareTask[];
  /** Everything outstanding or unknown, worst first. */
  open: readonly CareTask[];
  /**
   * Whether the treatment may start. Calculated, and there is no event that
   * sets it — the same rule as `ready` and `clear`.
   */
  mayStart: boolean;
  /** The one sentence for whoever is standing next to the chair. */
  blockedBy: string | null;
  /** Facts nobody has asked about that this treatment actually needs. */
  unknownFacts: readonly PatientFactKey[];
  /** Delivered, so the after-items are live. */
  delivered: boolean;
  deliveredAt: number | null;
  /** Blocking after-items still outstanding — the day cannot close on these. */
  owedAfter: readonly CareTask[];
}

/* -------------------------------------------------------------------------
 * The calculation
 * ---------------------------------------------------------------------- */

const met = (events: readonly ReadinessEvent[], bookingId: string, itemId: string) =>
  events.find((e) => e.type === ClinicEvent.CARE_ITEM_MET
    && e.subjectId === `${bookingId}#${itemId}`);

/**
 * Does this item apply to this patient, and do we actually know?
 *
 * The three-way answer is the whole point. `NOT_APPLICABLE` is only returned
 * where a fact is positively known to be false — the constitution's *"requires
 * a positive rule"* — and `null` yields `UNKNOWN`, never a skip.
 */
function applicability(item: CareItem, facts: PatientFacts): CareState | null {
  if (item.needs === undefined) return null;      // always applies
  const fact = facts[item.needs];
  if (fact === null) return CareState.UNKNOWN;
  const wanted = item.needsAbsent !== true;
  return fact === wanted ? null : CareState.NOT_APPLICABLE;
}

const FACT_WORDS: Readonly<Record<PatientFactKey, string>> = {
  anticoagulated: 'whether the patient is on a blood thinner',
  prophylaxisIndicated: 'whether the patient needs antibiotic prophylaxis',
  diabetic: 'whether the patient is diabetic',
  antiresorptive: 'whether the patient is on a bisphosphonate',
  pregnant: 'whether the patient is pregnant',
  penicillinAllergy: 'whether the patient is allergic to penicillin',
  smoker: 'whether the patient smokes',
  minor: 'whether the patient is a minor',
};

/**
 * The work a booking creates, as of `now`.
 *
 * Pure. Hand it a booking, what is known about the patient, the log and a
 * minute, and it will tell you about that minute — which is what lets a test
 * stand at three days before and again at ten minutes before without a clock.
 */
export function careFor(
  booking: Booking,
  facts: PatientFacts,
  events: readonly ReadinessEvent[],
  now: number,
): Care | null {
  const treatment = TREATMENT_BY_CODE.get(booking.treatmentCode);
  if (treatment === undefined) return null;

  const delivery = events.find((e) => e.type === ClinicEvent.TREATMENT_DELIVERED
    && e.subjectId === booking.id);
  const delivered = delivery !== undefined;

  const build = (i: CareItem): CareTask => {
    const done = met(events, booking.id, i.id);
    const aside = applicability(i, facts);

    // Done is done, whatever the condition says. Somebody who took a bleeding
    // history on a patient we later learn is not anticoagulated has still
    // taken it, and reporting that as NOT_APPLICABLE would erase their work.
    const state: CareState = done !== undefined
      ? CareState.MET
      : aside ?? CareState.OUTSTANDING;

    const dueAt = i.stage === CareStage.BEFORE
      ? booking.at - i.offsetMinutes
      : (delivery?.at ?? booking.at) + i.offsetMinutes;

    return {
      ...i,
      state,
      dueAt,
      doneAt: done ? done.at : null,
      late: state === CareState.OUTSTANDING && now > dueAt,
      standsAsideBecause: state === CareState.NOT_APPLICABLE
        ? `Does not apply — ${FACT_WORDS[i.needs!]} is answered and this is not that patient`
        : null,
    };
  };

  const before = treatment.items.filter((i) => i.stage === CareStage.BEFORE).map(build);
  const after = treatment.items.filter((i) => i.stage === CareStage.AFTER).map(build);

  const live = (t: CareTask) =>
    t.state === CareState.OUTSTANDING || t.state === CareState.UNKNOWN;

  // A BLOCK item that is UNKNOWN blocks exactly as an outstanding one does.
  // That is the rule that makes an unasked question cost something.
  const blocking = before.filter((t) => t.gate === CareGate.BLOCK && live(t));

  const owedAfter = delivered
    ? after.filter((t) => t.gate === CareGate.BLOCK && live(t))
    : [];

  const open = [...before, ...(delivered ? after : [])]
    .filter(live)
    .sort((a, b) => {
      if (a.gate !== b.gate) return a.gate === CareGate.BLOCK ? -1 : 1;
      return a.dueAt - b.dueAt;
    });

  const unknownFacts = [...new Set(
    [...before, ...after]
      .filter((t) => t.state === CareState.UNKNOWN)
      .map((t) => t.needs!),
  )];

  return {
    booking,
    treatment,
    before,
    after,
    open,
    mayStart: blocking.length === 0,
    blockedBy: blocking.length === 0 ? null : whyBlocked(blocking[0]!),
    unknownFacts,
    delivered,
    deliveredAt: delivery?.at ?? null,
    owedAfter,
  };
}

/**
 * An unknown says what is unknown, rather than what is undone.
 *
 * "The anticoagulant plan has not been agreed" is wrong when nobody has asked
 * whether the patient is anticoagulated — it sends somebody to ring a
 * prescriber about a patient who may not need one. The honest sentence names
 * the question.
 */
function whyBlocked(t: CareTask): string {
  if (t.state === CareState.UNKNOWN) {
    return `Nobody has asked ${FACT_WORDS[t.needs!]}, and this treatment needs the answer`;
  }
  return t.because;
}

/** Every booking's work, for a day or a person. */
export function careForAll(
  bookings: readonly Booking[],
  facts: (bookingId: string) => PatientFacts,
  events: readonly ReadinessEvent[],
  now: number,
): Care[] {
  return bookings
    .map((b) => careFor(b, facts(b.id), events, now))
    .filter((c): c is Care => c !== null);
}

/** What one role owes across every booking, worst first. */
export function careOwedBy(all: readonly Care[], role: RoleCode): CareTask[] {
  return all
    .flatMap((c) => c.open)
    .filter((t) => t.owner === role)
    .sort((a, b) => {
      if (a.late !== b.late) return a.late ? -1 : 1;
      if (a.gate !== b.gate) return a.gate === CareGate.BLOCK ? -1 : 1;
      return a.dueAt - b.dueAt;
    });
}
