/**
 * The compliance engine — mandatory gates, and requirements that cannot
 * disappear.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The owner's brief
 * ─────────────────────────────────────────────────────────────────────────
 *
 * *"Some actions should be mandatory gates… If mandatory requirements are
 * missing: ⚠ PROCEDURE NOT READY. The software should not quietly allow the
 * missing requirement to disappear."*
 *
 * The first half of that is a checklist and every clinic system has one. The
 * second half is the whole product, and almost nothing has it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The four ways a requirement disappears, and what stops each
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **1. Somebody overrides it.** There is no override. Not a permission, not a
 * manager PIN, not a reason box. `complianceFor()` takes no argument that
 * could let anybody past, so there is nothing to grant, delegate or leak.
 * Constitution rule 2: a hard gate is enforced by the absence of a permission
 * rather than by a runtime check.
 *
 * **2. Nobody asked, so it looks satisfied.** A conditional gate on an
 * unanswered question resolves to `UNKNOWN`, and `UNKNOWN` fails the gate. An
 * unasked question costs exactly what an unmet requirement costs.
 *
 * **3. The refusal is silent.** Every attempt to start a procedure that is not
 * ready produces a `TREATMENT_START_REFUSED` event in the append-only log,
 * with the gates that were missing at that minute. A refusal nobody can count
 * is a refusal people learn to route around, and the count is the single most
 * useful number in this file: *how often does this clinic try to start work it
 * is not ready for, and on what.*
 *
 * **4. It happened anyway, and the record caught up afterwards.** This is the
 * one that matters. Work gets done on paper, in a hurry, and the consent is
 * signed at four o'clock for a procedure that started at eleven. So a
 * **breach** is evaluated strictly as of the minute of delivery, using only
 * the events that existed by then — and a gate satisfied *afterwards* does not
 * clear it. The breach is permanent, it is attached to that treatment for as
 * long as the log exists, and nothing in this file can remove one.
 *
 * That last rule is the difference between a system that records compliance
 * and one that produces it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Evidence, not ticks
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every gate names **what actually proves it** — a signed form, a dated
 * radiograph, a released batch number, a reserved lot. A gate whose evidence
 * is "somebody ticked it" is a gate that has already failed; naming the
 * artefact is what makes an audit possible a year later, when everyone who was
 * there has forgotten.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Its relationship to `compliance-gates.ts`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * That file is the owner's own seventeen universal gates written down as a
 * **specification**, with each requirement flagged `evaluable: false` where
 * KuBi held no field capable of deciding it. It was a roadmap and could refuse
 * nothing, because nothing populated its `satisfied` set.
 *
 * This file is the **enforcement**. It evaluates against the event log, so the
 * requirements that were unevaluable when that register was written — consent,
 * medical history, the pre-operative radiograph, stock reservation, the
 * sterile pack — are now decided from events rather than from a flag. The
 * older file stays as the statement of intent and the list of what is still
 * out of reach; this one is what actually stops a procedure.
 */
import { RoleCode } from './enums.js';
import { ClinicEvent } from './operating-model.js';
import {
  CareGate, CareStage, CareState, careFor, TREATMENT_BY_CODE,
  type Booking, type PatientFacts, type Treatment,
} from './patient-events.js';
import type { ReadinessEvent } from './readiness.js';

/* -------------------------------------------------------------------------
 * What kind of obligation a gate is
 * ---------------------------------------------------------------------- */

/**
 * Why the gate exists, which decides who may argue about it.
 *
 * A clinical gate is the clinical director's to change. A statutory one is
 * nobody's — an X-ray on a lapsed licence is illegal whatever the clinic
 * thinks. Keeping them apart stops the whole list being treated as a matter of
 * house style.
 */
export const GateBasis = {
  /** The patient agreed, in writing, to this. */
  CONSENT: 'CONSENT',
  /** Doing it without this risks harming the patient. */
  SAFETY: 'SAFETY',
  /** The treatment cannot be done properly without it. */
  CLINICAL: 'CLINICAL',
  /** Law or licence. Not the clinic's to waive. */
  STATUTORY: 'STATUTORY',
  /** The record has to exist, or the treatment cannot be defended. */
  RECORD: 'RECORD',
} as const;
export type GateBasis = (typeof GateBasis)[keyof typeof GateBasis];

export interface GateSpec {
  /** What actually proves it. Never "somebody ticked it". */
  evidence: string;
  basis: GateBasis;
  /**
   * The role whose word this is, where only one role's word will do.
   *
   * Null where anybody competent may attest. A consent attested by reception
   * is not a consent, so `CONSENT` names the doctor; a stock reservation may
   * be attested by whoever actually reserved it.
   */
  attestedBy: RoleCode | null;
}

const g = (evidence: string, basis: GateBasis, attestedBy: RoleCode | null = null):
GateSpec => ({ evidence, basis, attestedBy });

const DOC = RoleCode.TREATING_DOCTOR;
const STER = RoleCode.STERILIZATION_TECHNICIAN;
const SNR = RoleCode.SENIOR_ASSISTANT;

/**
 * What proves each gate, for every blocking requirement in the catalogue.
 *
 * All 84 of them. A test asserts the coverage is total, so a new blocking
 * requirement cannot be added to a treatment without somebody stating what
 * would prove it — which is the moment to notice that a requirement nobody can
 * evidence is a requirement nobody will meet.
 */
export const GATE_EVIDENCE: Readonly<Record<string, GateSpec>> = {
  /* ── Consent ─────────────────────────────────────────────────────────── */
  CONSENT: g('A consent form for this procedure, signed and dated by the patient and the operator', GateBasis.CONSENT, DOC),
  GUARDIAN: g('A consent form countersigned by a named guardian, with the relationship recorded', GateBasis.CONSENT, DOC),
  NERVE_CONSENT: g('Consent naming inferior alveolar and lingual nerve injury specifically, not a general surgical consent', GateBasis.CONSENT, DOC),
  SINUS_CONSENT: g('Consent naming sinus perforation and graft failure specifically', GateBasis.CONSENT, DOC),
  MOCKUP: g('A dated photograph or signed approval of the mock-up the patient actually saw', GateBasis.CONSENT, DOC),

  /* ── Safety: the patient ─────────────────────────────────────────────── */
  HISTORY: g('A medical history reviewed and signed off for today, not a form filled in last year', GateBasis.SAFETY, null),
  LA_REVIEW: g('The anaesthetic agent, dose and allergy status recorded against this appointment', GateBasis.SAFETY, DOC),
  ANTICOAG: g('A written plan agreed with the prescribing physician, naming the drug and whether it is being held', GateBasis.SAFETY, DOC),
  PROPHYLAXIS: g('The drug, dose and the clock time it was given — at least an hour before', GateBasis.SAFETY, DOC),
  MRONJ: g('The drug, route and duration recorded, and the osteonecrosis warning given in writing', GateBasis.SAFETY, DOC),
  PREGNANCY_IMAGING: g('Pregnancy status asked and recorded before any exposure', GateBasis.SAFETY, null),
  SITE_CHECK: g('The tooth number and side read back against the notes at the chair, by two people', GateBasis.SAFETY, DOC),
  SPREAD: g('Airway, eye involvement, swallowing and temperature assessed and recorded', GateBasis.SAFETY, DOC),
  HEAD_INJURY: g('A recorded assessment of injuries beyond the mouth, including loss of consciousness', GateBasis.SAFETY, DOC),
  TETANUS: g('Tetanus immunisation status established and recorded', GateBasis.SAFETY, DOC),
  TRIAGE: g('A triage note with the time of arrival and the presenting complaint', GateBasis.SAFETY, null),
  CARIES_FREE: g('A recorded examination excluding caries and defective margins on the teeth to be whitened', GateBasis.SAFETY, DOC),
  HYGIENE_GATE: g('A plaque score or recorded hygiene assessment judged adequate for fixed appliances', GateBasis.SAFETY, DOC),
  AEROSOL: g('High-volume aerosol suction in place and positioned within 23 cm of the field', GateBasis.SAFETY, null),
  DAM: g('Rubber dam placed and recorded, or the reason it could not be', GateBasis.SAFETY, DOC),
  HAEMOSTASIS: g('Bleeding confirmed stopped, and the time the patient was released', GateBasis.SAFETY, DOC),
  ANALGESIA: g('The prescription, checked against the recorded allergies before it was issued', GateBasis.SAFETY, DOC),
  ANTIBIOTIC: g('The antibiotic decision recorded either way, with the reason — including "none, drainage achieved"', GateBasis.SAFETY, DOC),

  /* ── Safety: the instruments and the room ────────────────────────────── */
  STERILE_PACK: g('A batch number released by somebody other than its operator, with the pack in date', GateBasis.SAFETY, STER),
  DRILL_KIT: g('The drill kit checked complete against its inventory and released sterile by batch number', GateBasis.SAFETY, STER),
  SURGICAL_ROOM: g('The operatory prepared to the surgical protocol and recorded by the person who did it', GateBasis.SAFETY, null),

  /* ── Clinical: you cannot do it properly without this ────────────────── */
  IMAGING: g('A dated radiograph of the site, in the record, with a written report against it', GateBasis.CLINICAL, DOC),
  JUSTIFY: g('The clinical question the exposure answers, written before the exposure', GateBasis.STATUTORY, DOC),
  PLAN_SIGNED: g('An implant plan naming the fixture, diameter, length and position, agreed from the scan', GateBasis.CLINICAL, DOC),
  RCT_DONE: g('The completed root treatment record and a symptom-free review', GateBasis.CLINICAL, DOC),
  ABUTMENT_VITALITY: g('A vitality test result recorded for every abutment tooth', GateBasis.CLINICAL, DOC),
  POCKET_CHART: g('A six-point pocket chart dated within the treatment planning period', GateBasis.CLINICAL, DOC),
  SRP_FIRST: g('The non-surgical phase recorded complete, with a reassessment chart after it', GateBasis.CLINICAL, DOC),
  WHY_FAILED: g('A written assessment of why the previous root treatment failed', GateBasis.CLINICAL, DOC),
  INTEGRATION: g('A radiograph and a clinical stability check confirming integration', GateBasis.CLINICAL, DOC),
  SURVEY: g('A surveyed design drawing, with rest seats prepared to it', GateBasis.CLINICAL, DOC),
  RECORDS: g('Study models or scans, photographs and the cephalometric analysis', GateBasis.CLINICAL, DOC),
  PHOTOS: g('Dated pre-operative photographs, taken before any preparation', GateBasis.RECORD, DOC),
  FINAL_RECORDS: g('Final records and photographs, dated before the debond', GateBasis.RECORD, DOC),

  /* ── Clinical: the thing has to physically be there ──────────────────── */
  STOCK: g('A reservation against a lot number held in the clinic, not a supplier promise', GateBasis.CLINICAL, null),
  IMPLANT_STOCK: g('Lot numbers for the planned fixture and one size either side, physically in the clinic', GateBasis.CLINICAL, null),
  GRAFT_STOCK: g('Lot numbers and expiry dates for the graft material, membrane and fixation', GateBasis.CLINICAL, null),
  ABUTMENT_STOCK: g('The healing abutment height reserved against a lot number', GateBasis.CLINICAL, null),
  IMPRESSION_PARTS: g('The impression coping and analogue for this exact implant system, in the clinic', GateBasis.CLINICAL, null),
  BRACKET_STOCK: g('The bracket prescription and archwire sequence for this case, in the clinic', GateBasis.CLINICAL, null),
  TRAYS: g('The custom trays back from the laboratory and tried in', GateBasis.CLINICAL, null),
  RETAINER_STOCK: g('The retainer physically back from the laboratory, before the debond appointment', GateBasis.CLINICAL, null),

  /* ── The record, after the fact ──────────────────────────────────────── */
  NOTES: g('A clinical note for this treatment, written and attributed', GateBasis.RECORD, DOC),
  CHARTING: g('Charting and a recorded diagnosis against the examination', GateBasis.RECORD, DOC),
  REPORT: g('A written radiology report against the scan', GateBasis.RECORD, DOC),
  POST_OP: g('Written post-operative instructions issued, and the copy retained', GateBasis.SAFETY, DOC),
  TRISMUS: g('Written warning about swelling and trismus, issued and retained', GateBasis.RECORD, DOC),
  NO_BLOW: g('Written sinus precautions issued, and the copy retained', GateBasis.SAFETY, DOC),
  EXERCISES: g('Stretching exercises taught and issued in writing', GateBasis.CLINICAL, DOC),
  RETAINER_INSTR: g('Retainer wear instructions issued in writing', GateBasis.CLINICAL, DOC),
  WORKING_LENGTH: g('A working length radiograph for every canal, in the record', GateBasis.CLINICAL, DOC),
  POST_RCT_XRAY: g('A post-obturation radiograph, in the record', GateBasis.RECORD, DOC),
  OCCLUSION: g('The occlusion checked and the adjustment recorded', GateBasis.CLINICAL, DOC),
  TORQUE: g('Insertion torque in Ncm and a stability reading, recorded', GateBasis.RECORD, DOC),
  TORQUE_FINAL: g('The abutment torque figure recorded against the manufacturer’s specification', GateBasis.RECORD, DOC),
  PASSPORT: g('An implant passport issued to the patient, naming what was placed', GateBasis.RECORD, null),
  SPECIMEN: g('The specimen fixed, labelled with the patient and site, and the request form completed', GateBasis.STATUTORY, DOC),
  HISTO_CHASE: g('The histopathology report, in the record, read and signed', GateBasis.SAFETY, DOC),
  DRAIN: g('Drainage achieved and recorded, with the route', GateBasis.CLINICAL, DOC),
  SPLINT: g('The splint recorded with its intended removal date', GateBasis.CLINICAL, DOC),
  PROGRESS: g('A progress note against the treatment plan', GateBasis.RECORD, DOC),
  TEMP: g('The temporary recorded as fitted, and the patient warned about it', GateBasis.CLINICAL, DOC),
  IMPRESSION: g('The impression or scan taken, checked and recorded', GateBasis.CLINICAL, DOC),

  /* ── Continuity: the appointment that must exist ─────────────────────── */
  CORONAL_SEAL: g('A booked appointment for the definitive restoration', GateBasis.CLINICAL, null),
  SUTURES_OUT: g('A booked appointment for suture removal', GateBasis.CLINICAL, null),
  REVIEW_48H: g('A booked review inside 48 hours', GateBasis.SAFETY, null),
  RESULT_APPT: g('A booked appointment at which to give the biopsy result in person', GateBasis.SAFETY, null),
  DEFINITIVE: g('A booked appointment to treat the cause, not just the pain', GateBasis.CLINICAL, null),
  REASSESS: g('A booked reassessment 6–8 weeks on', GateBasis.CLINICAL, null),
  HEAL_WAIT: g('A booked restorative appointment no sooner than the healing period allows', GateBasis.CLINICAL, null),
  OSSEO_WAIT: g('A booked integration review 3–4 months on', GateBasis.CLINICAL, null),
  MAINT: g('A booked implant maintenance appointment', GateBasis.CLINICAL, null),
  ADJUST_SERIES: g('A booked series of adjustment appointments', GateBasis.CLINICAL, null),
  NEXT: g('The next adjustment booked before the patient left the building', GateBasis.CLINICAL, null),
  RETENTION_REVIEW: g('Booked retention reviews at 3 and 12 months', GateBasis.CLINICAL, null),
  ERUPTION_WATCH: g('A booked eruption review 6 months on', GateBasis.CLINICAL, null),
  TRAUMA_FOLLOW: g('The full trauma follow-up series booked — 2, 4, 8 weeks, 6 and 12 months', GateBasis.SAFETY, null),
  LAB_OUT: g('A laboratory docket with a dispatch date', GateBasis.CLINICAL, null),
  FIT_APPT: g('A fit appointment dated after the laboratory can realistically return the work', GateBasis.CLINICAL, null),

  /* ── Cross-engine gates, which belong to no single treatment ─────────── */
  EQUIPMENT_FIT: g('Every asset this procedure depends on in service, with nothing overdue that stops its use', GateBasis.SAFETY, null),
  OPERATOR_AUTHORISED: g('The operator holds the clinical authority for this procedure, and holds it today', GateBasis.STATUTORY, SNR),
};

/* -------------------------------------------------------------------------
 * The must-required list
 * ---------------------------------------------------------------------- */

export interface MustGate {
  id: string;
  label: string;
  /** BEFORE gates hold the procedure; AFTER gates hold the day. */
  stage: CareStage;
  owner: RoleCode;
  spec: GateSpec;
  /** The patient fact it depends on, where it has one. */
  needs: string | null;
}

/**
 * Cross-engine gates, added to every treatment that needs them.
 *
 * They are not in the treatment catalogue because they are not properties of a
 * treatment. *"Sterilization confirmed"* in the owner's implant list is not a
 * fact about implants — it is a fact about the autoclave, and it belongs to
 * the equipment register. Compliance is where the two meet.
 */
const EQUIPMENT_GATE: MustGate = {
  id: 'EQUIPMENT_FIT',
  label: 'Equipment fit for this procedure',
  stage: CareStage.BEFORE,
  owner: RoleCode.CLINIC_MANAGER,
  spec: GATE_EVIDENCE.EQUIPMENT_FIT!,
  needs: null,
};

/** Treatments that cannot proceed unless the instrument loop is sound. */
const NEEDS_STERILE = (t: Treatment) =>
  t.items.some((i) => i.id === 'STERILE_PACK' || i.id === 'DRILL_KIT');

/**
 * The definitive list of what must be true before a treatment may start, and
 * what must be true before the day may close on it.
 *
 * Derived from the treatment catalogue rather than written twice: every
 * blocking requirement is a gate, and there is one source of truth for what
 * blocks. What compliance adds is the **evidence** and the **basis** — what
 * proves it, and whose rule it is.
 */
export function mustListFor(code: string): readonly MustGate[] {
  const t = TREATMENT_BY_CODE.get(code);
  if (t === undefined) return [];

  const gates: MustGate[] = t.items
    .filter((i) => i.gate === CareGate.BLOCK)
    .map((i) => ({
      id: i.id,
      label: i.label,
      stage: i.stage,
      owner: i.owner,
      spec: GATE_EVIDENCE[i.id] ?? g(
        'No evidence standard has been stated for this requirement',
        GateBasis.CLINICAL),
      needs: i.needs ?? null,
    }));

  return NEEDS_STERILE(t) ? [...gates, EQUIPMENT_GATE] : gates;
}

/* -------------------------------------------------------------------------
 * The verdict
 * ---------------------------------------------------------------------- */

export const GateOutcome = {
  MET: 'MET',
  MISSING: 'MISSING',
  /** Nobody has answered the question this gate depends on. Fails. */
  UNKNOWN: 'UNKNOWN',
  /** Positively established as not applying to this patient. */
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type GateOutcome = (typeof GateOutcome)[keyof typeof GateOutcome];

export interface GateResult extends MustGate {
  verdict: GateOutcome;
  metAt: number | null;
  /** Said to whoever is standing at the chair. */
  because: string;
}

/** One recorded attempt to start a procedure that was not ready. */
export interface RecordedRefusal {
  at: number;
  /** The gate ids that were missing when it was tried. */
  missing: readonly string[];
}

/**
 * A requirement that was not met at the moment the treatment was delivered.
 *
 * Permanent. Meeting the gate afterwards does not clear it — that is the
 * whole point, and the reason `metLateAt` exists rather than the breach simply
 * vanishing when the consent finally arrives.
 */
export interface Breach {
  gateId: string;
  label: string;
  basis: GateBasis;
  evidence: string;
  /** The minute the treatment was delivered without it. */
  deliveredAt: number;
  /** When it was eventually satisfied, if ever. Does not clear the breach. */
  metLateAt: number | null;
}

export interface Compliance {
  bookingId: string;
  treatmentCode: string;
  treatmentName: string;
  patientLabel: string;
  /** Every gate, in the order they are worked. */
  gates: readonly GateResult[];
  /** Gates that hold the procedure. */
  before: readonly GateResult[];
  /** Gates that hold the day, once the treatment has been delivered. */
  after: readonly GateResult[];
  /** ⚠ PROCEDURE NOT READY, or not. Calculated; no event sets it. */
  ready: boolean;
  verdict: 'READY' | 'NOT_READY';
  /** What is missing, worst basis first. */
  missing: readonly GateResult[];
  /** The one sentence to put in front of whoever is trying to start. */
  headline: string;
  /** Every recorded attempt to start it anyway. */
  refusals: readonly RecordedRefusal[];
  /**
   * Requirements unmet at the minute of delivery. Never empties.
   *
   * A non-empty list here is the most serious state the system can report: the
   * treatment happened without something mandatory, and no later paperwork
   * changes that.
   */
  breaches: readonly Breach[];
  delivered: boolean;
  deliveredAt: number | null;
}

/** Ordered worst first, so a headline picks the right one to say. */
const BASIS_ORDER: readonly GateBasis[] = [
  GateBasis.STATUTORY, GateBasis.CONSENT, GateBasis.SAFETY,
  GateBasis.CLINICAL, GateBasis.RECORD,
];
const severity = (b: GateBasis) => BASIS_ORDER.indexOf(b);

export interface ComplianceInputs {
  /**
   * Asset tags that may not be used — an overdue blocking cycle, or down.
   *
   * Supplied by the equipment engine. Absent means nobody asked the equipment
   * register, which is `UNKNOWN` and fails the gate rather than passing it.
   */
  unusableAssets?: readonly string[];
}

/**
 * Whether a treatment may start, and what it is missing.
 *
 * Pure. Takes no argument that could let anybody past — there is no `force`,
 * no `override`, no `authorisedBy`. Adding one would be the only way to break
 * this file, and its absence is the enforcement.
 */
export function complianceFor(
  booking: Booking,
  facts: PatientFacts,
  events: readonly ReadinessEvent[],
  now: number,
  inputs: ComplianceInputs = {},
): Compliance | null {
  const t = TREATMENT_BY_CODE.get(booking.treatmentCode);
  if (t === undefined) return null;

  const delivery = events.find((e) => e.type === ClinicEvent.TREATMENT_DELIVERED
    && e.subjectId === booking.id);
  const deliveredAt = delivery?.at ?? null;

  const gates = evaluate(booking, facts, events, now, inputs);
  const before = gates.filter((x) => x.stage === CareStage.BEFORE);
  const after = gates.filter((x) => x.stage === CareStage.AFTER);

  const fails = (x: GateResult) =>
    x.verdict === GateOutcome.MISSING || x.verdict === GateOutcome.UNKNOWN;

  const missing = [...before.filter(fails), ...(deliveredAt !== null ? after.filter(fails) : [])]
    .sort((a, b) => severity(a.spec.basis) - severity(b.spec.basis));

  const ready = before.every((x) => !fails(x));

  /* ── Refusals, from the log ──────────────────────────────────────────── */
  const refusals: RecordedRefusal[] = events
    .filter((e) => e.type === ClinicEvent.TREATMENT_START_REFUSED
      && e.subjectId.startsWith(`${booking.id}#`))
    .map((e) => ({ at: e.at, missing: e.subjectId.slice(booking.id.length + 1).split(',') }))
    .sort((a, b) => a.at - b.at);

  /* ── Breaches, evaluated strictly as of delivery ──────────────────────
     Only the events that existed by then. A consent signed at four o'clock
     for a procedure that started at eleven does not make the eleven o'clock
     start compliant, and this is the arithmetic that says so. */
  const breaches: Breach[] = [];
  if (deliveredAt !== null) {
    const asOfDelivery = events.filter((e) => e.at <= deliveredAt);
    const then = evaluate(booking, facts, asOfDelivery, deliveredAt, inputs);
    for (const x of then) {
      if (x.stage !== CareStage.BEFORE) continue;
      if (!fails(x)) continue;
      const later = gates.find((y) => y.id === x.id);
      breaches.push({
        gateId: x.id,
        label: x.label,
        basis: x.spec.basis,
        evidence: x.spec.evidence,
        deliveredAt,
        metLateAt: later?.verdict === GateOutcome.MET ? later.metAt : null,
      });
    }
    breaches.sort((a, b) => severity(a.basis) - severity(b.basis));
  }

  return {
    bookingId: booking.id,
    treatmentCode: t.code,
    treatmentName: t.name,
    patientLabel: booking.patientLabel,
    gates,
    before,
    after,
    ready,
    verdict: ready ? 'READY' : 'NOT_READY',
    missing,
    headline: headline(ready, missing, breaches),
    refusals,
    breaches,
    delivered: deliveredAt !== null,
    deliveredAt,
  };
}

function evaluate(
  booking: Booking, facts: PatientFacts, events: readonly ReadinessEvent[],
  at: number, inputs: ComplianceInputs,
): GateResult[] {
  const care = careFor(booking, facts, events, at);
  const byId = new Map((care?.before ?? []).concat(care?.after ?? []).map((x) => [x.id, x]));

  return mustListFor(booking.treatmentCode).map((m) => {
    if (m.id === 'EQUIPMENT_FIT') return equipmentGate(m, inputs);

    const task = byId.get(m.id);
    // A gate the care engine does not know about cannot be assumed met. It is
    // UNKNOWN, which fails — the safe direction for a disagreement between two
    // engines about what a treatment requires.
    if (task === undefined) {
      return {
        ...m, verdict: GateOutcome.UNKNOWN, metAt: null,
        because: `${m.label} is required and the clinic holds no record of it either way`,
      };
    }

    const verdict = task.state === CareState.MET ? GateOutcome.MET
      : task.state === CareState.NOT_APPLICABLE ? GateOutcome.NOT_APPLICABLE
        : task.state === CareState.UNKNOWN ? GateOutcome.UNKNOWN
          : GateOutcome.MISSING;

    return {
      ...m,
      verdict,
      metAt: task.doneAt,
      because: verdict === GateOutcome.UNKNOWN
        ? `${m.label} depends on a question nobody has answered`
        : verdict === GateOutcome.MISSING
          ? `${m.label} — no ${lower(m.spec.evidence)}`
          : task.standsAsideBecause ?? m.label,
    };
  });
}

/**
 * The gate that reaches into the equipment register.
 *
 * `unusableAssets` absent is deliberately not "nothing is unusable" — nobody
 * asked, so the gate is UNKNOWN and fails. A compliance engine that passes a
 * procedure because it could not reach the asset register has passed it for
 * the worst possible reason.
 */
function equipmentGate(m: MustGate, inputs: ComplianceInputs): GateResult {
  if (inputs.unusableAssets === undefined) {
    return {
      ...m, verdict: GateOutcome.UNKNOWN, metAt: null,
      because: 'Nobody has asked the equipment register whether the instruments and plant are fit',
    };
  }
  if (inputs.unusableAssets.length > 0) {
    return {
      ...m, verdict: GateOutcome.MISSING, metAt: null,
      because: `Cannot be used: ${inputs.unusableAssets.join(', ')}`,
    };
  }
  return { ...m, verdict: GateOutcome.MET, metAt: null, because: m.label };
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function headline(
  ready: boolean, missing: readonly GateResult[], breaches: readonly Breach[],
): string {
  if (breaches.length > 0) {
    const worst = breaches[0]!;
    return `Delivered without ${lower(worst.label)}. ${breaches.length === 1
      ? 'That cannot be undone.' : `${breaches.length} requirements were unmet at delivery.`}`;
  }
  if (ready) return 'Ready to proceed.';
  const worst = missing[0]!;
  return `PROCEDURE NOT READY — ${worst.because}`;
}

/* -------------------------------------------------------------------------
 * Trying to start
 * ---------------------------------------------------------------------- */

export type StartAttempt =
  | { allowed: true }
  | {
    allowed: false;
    /** For a person. */
    because: string;
    /** Every gate that failed, so the refusal is countable and not a shrug. */
    missing: readonly string[];
    /**
     * The event that MUST be written to the log.
     *
     * Returned rather than optional. A refusal nobody can count is a refusal
     * people learn to route around, and the count of these — per treatment,
     * per gate, per week — is the most useful number this engine produces.
     */
    record: { type: ClinicEvent; subjectId: string };
  };

/**
 * May this procedure start?
 *
 * Note what is not a parameter: there is no override, no reason string that
 * unlocks it, no role that is exempt. The refusal is a value, and the only
 * thing a caller may do with it is record it.
 */
export function mayStart(c: Compliance): StartAttempt {
  if (c.ready) return { allowed: true };
  const missing = c.missing.map((x) => x.id);
  return {
    allowed: false,
    because: c.headline,
    missing,
    record: {
      type: ClinicEvent.TREATMENT_START_REFUSED,
      subjectId: `${c.bookingId}#${missing.join(',')}`,
    },
  };
}

/* -------------------------------------------------------------------------
 * Across the clinic
 * ---------------------------------------------------------------------- */

export interface ComplianceView {
  all: readonly Compliance[];
  /** ⚠ PROCEDURE NOT READY, right now. */
  notReady: readonly Compliance[];
  /** Delivered with something mandatory unmet. Never shrinks. */
  breached: readonly Compliance[];
  /** How many times somebody tried to start work that was not ready. */
  refusalCount: number;
  /** Which gates fail most often — where the clinic actually loses time. */
  worstGates: ReadonlyArray<{ id: string; label: string; count: number; basis: GateBasis }>;
  /** Share of bookings with every mandatory gate met. */
  rate: number;
}

export function complianceAcross(all: readonly Compliance[]): ComplianceView {
  const counts = new Map<string, { label: string; count: number; basis: GateBasis }>();
  for (const c of all) {
    for (const x of c.missing) {
      const row = counts.get(x.id)
        ?? { label: x.label, count: 0, basis: x.spec.basis };
      row.count += 1;
      counts.set(x.id, row);
    }
  }

  const ready = all.filter((c) => c.ready).length;
  return {
    all,
    notReady: all.filter((c) => !c.ready && !c.delivered),
    breached: all.filter((c) => c.breaches.length > 0),
    refusalCount: all.reduce((n, c) => n + c.refusals.length, 0),
    worstGates: [...counts.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count || severity(a.basis) - severity(b.basis)),
    rate: all.length === 0 ? 1 : ready / all.length,
  };
}
