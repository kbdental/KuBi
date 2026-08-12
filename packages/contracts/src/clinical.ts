/**
 * CLN-001 to CLN-010 — clinical pre-treatment controls.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Most of this was already built, and saying so is the point
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The compliance engine has been evaluating medical history, imaging,
 * photographs, consent and procedure readiness since it was written. Building
 * a second set of controls that checked the same facts would have given the
 * clinic two answers to one question — which is the failure mode this project
 * has already been bitten by twice, once with the treatment room and once with
 * the appointment book.
 *
 * So `CLINICAL_CONTROLS` is a traceability table, in the same shape as
 * `OPENING_CONTROLS`: each row names the gate that already carries it, and the
 * three that named nothing were built rather than described.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * The three that were genuinely missing
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **CLN-002, allergies.** Checked inside the anaesthetic review and again
 * before a prescription — both specific to particular treatments. The matrix
 * makes it PS on *every patient visit*, and it is right to: the drug that
 * kills somebody is more often the one nobody thought to check against than
 * the one nobody prescribed.
 *
 * **CLN-006, the treatment plan.** A signed implant plan existed. A documented
 * plan for everything else did not, and a filling with no written plan is a
 * filling nobody can be shown to have agreed to.
 *
 * **CLN-007, the estimate.** Nothing financial existed anywhere in the
 * clinical path. Advisory, because the matrix marks it I.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CLN-009, and a number that refuses to be averaged
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The owner: *"For CLN-009 the target is simply 100%. No averaging away
 * consent failures."*
 *
 * A percentage is the wrong instrument for that, and no amount of care in the
 * UI fixes it — 49 of 50 is 98%, which reads like an A and means one person
 * was treated without consent. Worse, it aggregates: 98% this week and 98%
 * last week average to 98%, and the two people disappear entirely.
 *
 * So `ConsentIntegrity` **has no percentage field**. There is no number to
 * average, because the type does not contain one. `met` is a boolean, and
 * every failure is a named patient with a minute against it. That is a design
 * decision rather than a display choice: a screen cannot report a rate it was
 * never given.
 */
import { RoleCode } from './enums.js';
import { ControlPriority } from './housekeeping.js';
import type { Compliance } from './compliance.js';
import type { RadiographyView, ExposureResult } from './radiography.js';

/* -------------------------------------------------------------------------
 * Traceability: the matrix's ten controls, and what carries each
 * ---------------------------------------------------------------------- */

export interface ClinicalControl {
  id: string;
  activity: string;
  standard: string;
  trigger: string;
  doer: RoleCode | 'SYSTEM';
  checker: RoleCode | null;
  priority: ControlPriority;
  /**
   * The gate that carries it, `DERIVED` where it is a calculation, or null.
   *
   * There are no nulls, and that is worth stating: every one of the ten is
   * either an existing gate or one built for this matrix. `OPENING_CONTROLS`
   * still has six.
   */
  covers: string;
  /**
   * Whether it sits on the mandatory list or beside it.
   *
   * The mandatory list carries blocking gates only, so an advisory control has
   * no gate to read and would otherwise report "not required for this
   * treatment" — which is false. It *is* asked for; it does not hold the
   * chair. Two different sentences, and the screen must not say the wrong one.
   */
  advisory: boolean;
  why: string;
}

const SYS = 'SYSTEM' as const;
const DOC = RoleCode.TREATING_DOCTOR;
const ASST = RoleCode.DENTAL_ASSISTANT;
const REC = RoleCode.RECEPTION;

export const CLINICAL_CONTROLS: readonly ClinicalControl[] = [
  {
    id: 'CLN-001', activity: 'Verify medical history',
    standard: 'Current before treatment', trigger: 'Patient seated',
    doer: DOC, checker: null, priority: ControlPriority.PS,
    covers: 'HISTORY',
    advisory: false,
    why: 'Already a blocking gate on every treatment, and worded to catch the '
      + 'real failure: a form filled in last year is not a history reviewed '
      + 'today',
  },
  {
    id: 'CLN-002', activity: 'Review allergies',
    standard: 'Documented', trigger: 'Patient visit',
    doer: DOC, checker: null, priority: ControlPriority.PS,
    covers: 'ALLERGY',
    advisory: false,
    why: 'Built for this matrix. Allergies were checked inside the anaesthetic '
      + 'review and again before a prescription — both specific to particular '
      + 'treatments — and this makes it every visit',
  },
  {
    id: 'CLN-003', activity: 'Required investigation',
    standard: 'Available', trigger: 'Procedure protocol',
    doer: DOC, checker: null, priority: ControlPriority.PS,
    covers: 'IMAGING',
    advisory: false,
    why: 'A dated radiograph of the site with a written report against it, '
      + 'added by the treatments that need one rather than asked of all',
  },
  {
    id: 'CLN-004', activity: 'Pre-treatment scan',
    standard: 'Taken where protocol requires', trigger: 'Procedure',
    doer: ASST, checker: DOC, priority: ControlPriority.C,
    covers: 'JUSTIFY',
    advisory: false,
    why: 'The clinical question the exposure answers, written before the '
      + 'exposure — which is the statutory form of "where protocol requires"',
  },
  {
    id: 'CLN-005', activity: 'Pre-treatment photographs',
    standard: 'Taken where required', trigger: 'Procedure',
    doer: ASST, checker: DOC, priority: ControlPriority.I,
    covers: 'PHOTOS',
    advisory: false,
    why: 'Dated pre-operative photographs taken before any preparation, on the '
      + 'treatments whose outcome is judged against them',
  },
  {
    id: 'CLN-006', activity: 'Treatment plan',
    standard: 'Documented', trigger: 'Treatment planned',
    doer: DOC, checker: null, priority: ControlPriority.C,
    covers: 'TREATMENT_PLAN',
    advisory: false,
    why: 'Built for this matrix. A signed implant plan existed; a documented '
      + 'plan for everything else did not',
  },
  {
    id: 'CLN-007', activity: 'Estimate explained',
    standard: 'Recorded where applicable', trigger: 'Plan acceptance',
    doer: REC, checker: null, priority: ControlPriority.I,
    covers: 'ESTIMATE',
    // The only one. The matrix marks it I, so it is asked of every treatment
    // and holds none of them.
    advisory: true,
    why: 'Built for this matrix. Nothing financial existed anywhere in the '
      + 'clinical path, and a patient given no figure is a complaint waiting '
      + 'to happen rather than a clinical failure',
  },
  {
    id: 'CLN-008', activity: 'Consent identified',
    standard: 'Correct consent for procedure', trigger: 'Procedure selected',
    doer: SYS, checker: ASST, priority: ControlPriority.PS,
    covers: 'DERIVED',
    advisory: false,
    // Plain prose: this text is rendered verbatim on a screen, and a backtick
    // that meant "code" in a source file is litter on a wall.
    why: 'The matrix gives the doer as System, and it is — the mandatory list '
      + 'is picked from the treatment, so a nerve-injury consent appears on a '
      + 'lower third molar without anybody choosing it. There is no form '
      + 'picker to get wrong',
  },
  {
    id: 'CLN-009', activity: 'Consent signed',
    standard: 'Before treatment', trigger: 'Procedure start',
    doer: DOC, checker: ASST, priority: ControlPriority.PS,
    covers: 'CONSENT',
    advisory: false,
    why: 'Evaluated strictly as of the minute of delivery. A signature '
      + 'obtained afterwards does not clear the breach, which is why the '
      + 'measure below counts people rather than a rate',
  },
  {
    id: 'CLN-010', activity: 'Procedure readiness',
    standard: 'All mandatory requirements passed', trigger: 'Before treatment',
    doer: SYS, checker: DOC, priority: ControlPriority.PS,
    covers: 'DERIVED',
    advisory: false,
    why: 'Doer System, evidence Auto. Readiness is computed over the mandatory '
      + 'gates every time it is read: no event sets it and no field holds it, '
      + 'the same rule as clinic readiness',
  },
];

export const CLINICAL_BY_ID: ReadonlyMap<string, ClinicalControl> =
  new Map(CLINICAL_CONTROLS.map((c) => [c.id, c]));

/** The gates this matrix caused to be built, rather than found. */
export const CONTROLS_BUILT_FOR_THIS_MATRIX: readonly string[] =
  ['CLN-002', 'CLN-006', 'CLN-007'];

/* -------------------------------------------------------------------------
 * CLN-009 — the measure that cannot be averaged
 * ---------------------------------------------------------------------- */

/** One treatment delivered without the consent it needed. Never a statistic. */
export interface ConsentFailure {
  bookingId: string;
  patientLabel: string;
  treatmentName: string;
  /** Which consent — a general form is not a nerve-injury consent. */
  gateId: string;
  label: string;
  /** The minute the treatment was delivered without it. */
  deliveredAt: number;
  /**
   * When the signature was eventually obtained, if it ever was.
   *
   * Present so the record is complete, and it changes nothing. A consent
   * signed after the treatment is a consent that was not taken.
   */
  metLateAt: number | null;
  because: string;
}

/**
 * CLN-009, and the reason this interface has no percentage in it.
 *
 * *"The target is simply 100%. No averaging away consent failures."*
 *
 * A rate would let 49 of 50 read as 98%, and would let two bad weeks average
 * into one acceptable month. There is no field here that can do that. `met` is
 * a boolean and `failures` is a list of people — a screen cannot report a
 * percentage it was never given, which is a stronger guarantee than asking
 * every screen to be careful.
 */
export interface ConsentIntegrity {
  /** Treatments delivered today. The denominator, shown, never divided into. */
  delivered: number;
  /** Delivered with the right consent in place at the minute of delivery. */
  withConsent: number;
  /** Every one that was not. Permanent, and never summarised to a number. */
  failures: readonly ConsentFailure[];
  /** True only when `failures` is empty. There is no 98 per cent. */
  met: boolean;
  headline: string;
}

/** Which gates count as consent, so the measure cannot drift. */
const CONSENT_GATES: readonly string[] = [
  'CONSENT', 'GUARDIAN', 'NERVE_CONSENT', 'SINUS_CONSENT', 'MOCKUP',
];

/**
 * A consent gate that is satisfied — and NOT_APPLICABLE is satisfied.
 *
 * This is where the badge went wrong. Every treatment carries a guardian
 * consent conditional on the patient being a minor, so an adult's guardian
 * gate reads NOT_APPLICABLE — and treating "not MET" as a shortfall reported
 * *every adult in the clinic* as having unsigned consent.
 *
 * NOT_APPLICABLE is a pass here because it comes from a positive rule, exactly
 * as constitution rule 1 requires: the question *is this patient a minor* was
 * asked and answered. UNKNOWN, where nobody asked, is not a pass and never
 * becomes one.
 */
const consentSatisfied = (verdict: string): boolean =>
  verdict === 'MET' || verdict === 'NOT_APPLICABLE';

/**
 * Consent integrity across a day's treatments.
 *
 * Reads breaches the compliance engine already computed — evaluated strictly
 * as of `deliveredAt`, so a signature obtained at four o'clock does not clear a
 * treatment delivered at two.
 *
 * Pure, and derived: nothing records a consent failure, and nothing can clear
 * one. It stops being reported when the treatment stops being in the day.
 */
export function consentIntegrity(
  compliances: readonly Compliance[],
): ConsentIntegrity {
  const delivered = compliances.filter((c) => c.delivered);

  const failures: ConsentFailure[] = delivered.flatMap((c) =>
    c.breaches
      .filter((b) => CONSENT_GATES.includes(b.gateId))
      .map((b) => ({
        bookingId: c.bookingId,
        patientLabel: c.patientLabel,
        treatmentName: c.treatmentName,
        gateId: b.gateId,
        label: b.label,
        deliveredAt: b.deliveredAt,
        metLateAt: b.metLateAt,
        because: b.metLateAt === null
          ? `Delivered at ${clock(b.deliveredAt)} with no consent, and it has `
            + 'still not been signed.'
          : `Delivered at ${clock(b.deliveredAt)} with no consent. Signed at `
            + `${clock(b.metLateAt)} — which does not clear it.`,
      })));

  const failedBookings = new Set(failures.map((f) => f.bookingId));

  return {
    delivered: delivered.length,
    withConsent: delivered.filter((c) => !failedBookings.has(c.bookingId)).length,
    failures,
    met: failures.length === 0,
    headline: failures.length === 0
      ? delivered.length === 0
        ? 'Nothing delivered yet today.'
        : `${delivered.length} of ${delivered.length} treated with consent in place.`
      // Named, and counted in people. "One patient" is a sentence somebody
      // acts on; "98%" is a sentence somebody files.
      : `${failures.length} treatment${failures.length === 1 ? '' : 's'} `
        + `delivered without consent — ${[...new Set(failures.map((f) => f.patientLabel))].join(', ')}.`,
  };
}

/* -------------------------------------------------------------------------
 * CLN-010 — the readiness of every patient in the chair today
 * ---------------------------------------------------------------------- */

export interface PreTreatmentRow {
  bookingId: string;
  patientLabel: string;
  treatmentName: string;
  at: number;
  /** The five-stage spine, as the compliance engine computes it. */
  ready: boolean;
  delivered: boolean;
  /** CLN-001 to CLN-009, each with the state of its gate for this patient. */
  controls: readonly ControlState[];
  /** Consent, called out on its own because it is the one with a 100% target. */
  consent: 'MET' | 'MISSING' | 'BREACHED' | 'NOT_APPLICABLE';
  headline: string;
}

export interface ControlState {
  id: string;
  activity: string;
  priority: ControlPriority;
  /** MET, MISSING, UNKNOWN, NOT_APPLICABLE — from the gate, or DERIVED. */
  verdict: string;
  because: string;
}

export interface ClinicalView {
  rows: readonly PreTreatmentRow[];
  /** CLN-004. Doses given whose justification does not stand up. */
  exposureFailures: readonly ExposureResult[];
  /** CLN-010. Booked, not delivered, and not ready. */
  notReady: readonly PreTreatmentRow[];
  consent: ConsentIntegrity;
  /** Controls failing across the day, worst first. */
  failing: readonly { control: ClinicalControl; count: number }[];
  headline: string;
}

/**
 * The clinical pre-treatment picture for today's list.
 *
 * A view over what compliance already decided rather than a second evaluation:
 * a screen showing CLN-001 met while the mandatory list says otherwise would
 * be exactly the second answer this file exists to avoid.
 */
export function clinicalControls(
  compliances: readonly Compliance[],
  atOf: (bookingId: string) => number,
  /**
   * CLN-004's second half, from `radiography`.
   *
   * The JUSTIFY gate answers *was a justification written*. This answers *did
   * two people write and take it, in that order* — and where they did not, the
   * gate reading MET is a record that looks like compliance. Optional, and
   * absent means the engine reports only what the gate knows rather than
   * inventing a pass.
   */
  scans?: RadiographyView,
): ClinicalView {
  const rows: PreTreatmentRow[] = compliances.map((c) => {
    const byGate = new Map(c.gates.map((g) => [g.id, g]));

    const controls: ControlState[] = CLINICAL_CONTROLS.map((control) => {
      if (control.covers === 'DERIVED') {
        // CLN-008 and CLN-010 are calculations, and the honest thing is to
        // report the calculation rather than to look for a gate that is not
        // there. CLN-008 is met once the list has been assembled at all.
        const met = control.id === 'CLN-010' ? c.ready : c.gates.length > 0;
        return {
          id: control.id, activity: control.activity, priority: control.priority,
          verdict: met ? 'MET' : 'MISSING',
          because: control.id === 'CLN-010'
            ? (c.ready ? 'Every mandatory requirement passed.' : c.headline)
            : `${c.gates.length} requirements identified from the treatment.`,
        };
      }
      // CLN-009 aggregates. Its standard is *"consent signed"* against the
      // consent CLN-008 identified — and CLN-008 identifies a nerve-injury
      // consent on a lower third molar, not the general form. Reading only the
      // `CONSENT` gate reported "met" on an implant whose sinus consent was
      // missing, which contradicted the badge two lines above it.
      if (control.id === 'CLN-009') {
        const all = c.gates.filter((x) => CONSENT_GATES.includes(x.id));
        const short = all.filter((x) => !consentSatisfied(x.verdict));
        const needed = all.filter((x) => x.verdict !== 'NOT_APPLICABLE');
        return {
          id: control.id, activity: control.activity,
          priority: control.priority,
          verdict: needed.length === 0 ? 'NOT_APPLICABLE'
            : short.length === 0 ? 'MET' : short[0]!.verdict,
          because: needed.length === 0
            ? `No consent is required for ${c.treatmentName}.`
            : short.length === 0
              ? `All ${needed.length} consent${needed.length === 1 ? '' : 's'} signed.`
              : short.map((x) => x.because).join(' '),
        };
      }

      const g = byGate.get(control.covers);

      // CLN-004 is two facts, and the gate only holds one of them. A
      // justification written by the person who took the exposure passes
      // JUSTIFY and fails the control, and reporting MET there would be the
      // system agreeing with a record it should be refusing.
      if (control.id === 'CLN-004' && scans !== undefined) {
        const mine = scans.results.filter(
          (r) => r.exposure.bookingId === c.bookingId);
        const failed = mine.filter((r) => r.failed);
        if (failed.length > 0) {
          return {
            id: control.id, activity: control.activity,
            priority: control.priority,
            verdict: 'MISSING',
            because: failed.map((r) => r.because).join(' '),
          };
        }
        if (mine.length > 0) {
          return {
            id: control.id, activity: control.activity,
            priority: control.priority,
            verdict: 'MET',
            because: mine.map((r) => r.because).join(' '),
          };
        }
        // No exposure taken yet. Fall through to the gate, which is asking
        // the earlier question — has anybody written the justification.
      }

      if (g !== undefined) {
        return {
          id: control.id, activity: control.activity,
          priority: control.priority,
          verdict: g.verdict, because: g.because,
        };
      }
      // An advisory control has no gate to read, because the mandatory list
      // carries blocking items only. Saying "not required" here would be
      // false — it is asked of every treatment and holds none of them.
      if (control.advisory) {
        return {
          id: control.id, activity: control.activity,
          priority: control.priority,
          verdict: 'ADVISORY',
          because: 'Asked of every treatment and holds none of them. Tracked '
            + 'on the care list rather than the mandatory one.',
        };
      }
      // Otherwise NOT_APPLICABLE by a positive rule — the catalogue says
      // photographs are not taken for a scaling — which is different again
      // from a gate nobody has answered.
      return {
        id: control.id, activity: control.activity,
        priority: control.priority,
        verdict: 'NOT_APPLICABLE',
        because: `${control.activity} is not required for ${c.treatmentName}.`,
      };
    });

    const consentBreached = c.breaches.some((b) => CONSENT_GATES.includes(b.gateId));
    const consentGates = c.gates.filter((g) => CONSENT_GATES.includes(g.id));

    return {
      bookingId: c.bookingId,
      patientLabel: c.patientLabel,
      treatmentName: c.treatmentName,
      at: atOf(c.bookingId),
      ready: c.ready,
      delivered: c.delivered,
      controls,
      consent: (consentBreached ? 'BREACHED'
        : consentGates.filter((g) => g.verdict !== 'NOT_APPLICABLE').length === 0
          ? 'NOT_APPLICABLE'
          : consentGates.every((g) => consentSatisfied(g.verdict))
            ? 'MET' : 'MISSING') as PreTreatmentRow['consent'],
      headline: c.headline,
    };
  }).sort((a, b) => a.at - b.at);

  const failing = CLINICAL_CONTROLS
    .map((control) => ({
      control,
      count: rows.filter((r) => {
        const s = r.controls.find((x) => x.id === control.id);
        return s !== undefined && (s.verdict === 'MISSING' || s.verdict === 'UNKNOWN');
      }).length,
    }))
    .filter((f) => f.count > 0)
    .sort((a, b) => RANK[a.control.priority] - RANK[b.control.priority]
      || b.count - a.count);

  const consent = consentIntegrity(compliances);
  const notReady = rows.filter((r) => !r.ready && !r.delivered);

  return {
    rows,
    exposureFailures: scans?.failures ?? [],
    notReady,
    consent,
    failing,
    headline: !consent.met ? consent.headline
      : notReady.length > 0
        ? `${notReady.length} of ${rows.length} not ready for the chair.`
        : rows.length === 0
          ? 'Nothing booked today.'
          : 'Every patient booked today has passed their pre-treatment controls.',
  };
}

const RANK: Record<ControlPriority, number> = { PS: 0, C: 1, I: 2, R: 3 };

const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * What this matrix does not settle.
 *
 * Constitution rule 4.
 */
export const CLINICAL_QUESTIONS: readonly string[] = [
  'CLN-005 says photographs are taken “where required”, and the catalogue '
  + 'decides where. Is that list the clinic’s, or does the doctor decide per '
  + 'case? KuBi uses the catalogue and reports nothing where it is silent.',
  'CLN-007 says the estimate is recorded “where applicable”. KuBi asks for it '
  + 'on every treatment as advisory, because “where applicable” with no rule '
  + 'behind it means never.',
];
