/**
 * CLN-001 to CLN-010 — clinical pre-treatment controls.
 *
 * Most of this matrix was already built. The first block checks that it is
 * *traced* rather than rebuilt: a second set of controls evaluating the same
 * facts would give the clinic two answers to one question, which is the
 * failure this project has already been bitten by twice.
 *
 * The last block is the one that matters. The owner:
 *
 *   *"For CLN-009 the target is simply 100%. No averaging away consent
 *   failures."*
 *
 * A percentage is the wrong instrument, and no amount of care in the UI fixes
 * it — so `ConsentIntegrity` has no percentage field at all. A screen cannot
 * report a rate it was never given.
 */
import { describe, it, expect } from 'vitest';
import {
  RoleCode, ControlPriority,
  CLINICAL_CONTROLS, CLINICAL_BY_ID, CONTROLS_BUILT_FOR_THIS_MATRIX,
  CLINICAL_QUESTIONS,
  consentIntegrity, clinicalControls,
  GATE_EVIDENCE, TREATMENTS,
  type Compliance,
} from '@kubi/contracts';

const T = (h: number, m = 0) => h * 60 + m;

const gate = (id: string, verdict: string, because = '') =>
  ({ id, verdict, because: because || id } as never);

const breach = (gateId: string, deliveredAt: number, metLateAt: number | null = null) =>
  ({ gateId, label: gateId, basis: 'CONSENT', evidence: '', deliveredAt, metLateAt } as never);

const compliance = (over: Partial<Compliance> = {}): Compliance => ({
  bookingId: 'bk-1', treatmentCode: 'RCT_POST', treatmentName: 'Root canal',
  patientLabel: 'Anita Rao',
  gates: [], before: [], after: [], stages: [],
  ready: true, verdict: 'READY', failure: 'NONE' as never,
  missing: [], headline: 'Ready.', refusals: [], breaches: [],
  delivered: false, deliveredAt: null,
  ...over,
} as Compliance);

/* ═══════════════════════════════════════════════════════════════════════ */

describe('the matrix is traced, not rebuilt', () => {
  it('accounts for all ten controls and invents no others', () => {
    expect(CLINICAL_CONTROLS.map((c) => c.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `CLN-${String(i + 1).padStart(3, '0')}`));
  });

  it('leaves nothing uncovered — every one names a gate or a calculation', () => {
    // Worth stating against the opening matrix, which still has six nulls.
    for (const c of CLINICAL_CONTROLS) {
      expect(c.covers.length, `${c.id} covers nothing`).toBeGreaterThan(0);
    }
  });

  it('points every covered control at a gate that actually exists', () => {
    // The check that would have caught a traceability table describing gates
    // somebody renamed.
    for (const c of CLINICAL_CONTROLS) {
      if (c.covers === 'DERIVED') continue;
      expect(Object.keys(GATE_EVIDENCE), `${c.id} points at ${c.covers}`)
        .toContain(c.covers);
    }
  });

  it('names the three it had to build rather than find', () => {
    // Allergies on every visit, a treatment plan for everything and not just
    // implants, and anything financial at all.
    expect(CONTROLS_BUILT_FOR_THIS_MATRIX).toEqual(['CLN-002', 'CLN-006', 'CLN-007']);
    for (const id of CONTROLS_BUILT_FOR_THIS_MATRIX) {
      expect(CLINICAL_BY_ID.get(id)!.why).toContain('Built for this matrix');
    }
  });

  it('puts allergies on every treatment, which is what PS on every visit means', () => {
    // The drug that kills somebody is more often the one nobody thought to
    // check against than the one nobody prescribed — and no treatment is
    // exempt, emergencies least of all.
    for (const t of TREATMENTS) {
      expect(t.items.map((i) => i.id), `${t.code} has no allergy review`)
        .toContain('ALLERGY');
    }
  });

  it('gives an emergency ten minutes for it instead of a day', () => {
    // The emergency patient is the one most likely to be given an antibiotic
    // on the spot and the least likely to have a history anybody has read.
    const emergency = TREATMENTS.find((t) => t.code === 'EMERG_PAIN')!;
    const allergy = emergency.items.find((i) => i.id === 'ALLERGY')!;
    expect(allergy.gate).toBe('BLOCK');
    expect(allergy.offsetMinutes).toBeLessThanOrEqual(10);
  });

  it('does not hold pain relief for a documented treatment plan', () => {
    // CLN-006 on every scheduled treatment, and deliberately not on an
    // emergency: an emergency is "treat the cause of the pain now", the plan
    // is the DEFINITIVE follow-up this treatment already requires, and
    // blocking relief at five o'clock on a written plan is a rule a clinic
    // would route around by the end of the week.
    const scheduled = TREATMENTS.filter((t) => !t.code.startsWith('EMERG'));
    for (const t of scheduled) {
      expect(t.items.map((i) => i.id), `${t.code} has no treatment plan`)
        .toContain('TREATMENT_PLAN');
    }
    const emergency = TREATMENTS.find((t) => t.code === 'EMERG_PAIN')!;
    expect(emergency.items.map((i) => i.id)).not.toContain('TREATMENT_PLAN');
    // And the follow-up that carries the plan instead is still required.
    expect(emergency.items.map((i) => i.id)).toContain('DEFINITIVE');
  });

  it('keeps the estimate advisory, because the matrix marks it I', () => {
    // A patient given no figure is a complaint waiting to happen rather than
    // a clinical failure, and blocking treatment on it would be the kind of
    // rule a clinic routes around.
    expect(CLINICAL_BY_ID.get('CLN-007')!.priority).toBe(ControlPriority.I);
    const estimate = TREATMENTS.find(
      (t) => t.items.some((i) => i.id === 'ESTIMATE'))!.items
      .find((i) => i.id === 'ESTIMATE')!;
    expect(estimate.gate).toBe('ADVISE');
  });

  it('gives the two System controls no human doer', () => {
    // CLN-008 and CLN-010 are calculations. There is no form picker to get
    // wrong and no readiness box to tick.
    expect(CLINICAL_BY_ID.get('CLN-008')!.doer).toBe('SYSTEM');
    expect(CLINICAL_BY_ID.get('CLN-010')!.doer).toBe('SYSTEM');
    expect(CLINICAL_BY_ID.get('CLN-008')!.covers).toBe('DERIVED');
    expect(CLINICAL_BY_ID.get('CLN-010')!.covers).toBe('DERIVED');
  });

  it('carries the checker the matrix names, where it names one', () => {
    expect(CLINICAL_BY_ID.get('CLN-008')!.checker).toBe(RoleCode.DENTAL_ASSISTANT);
    expect(CLINICAL_BY_ID.get('CLN-010')!.checker).toBe(RoleCode.TREATING_DOCTOR);
    expect(CLINICAL_BY_ID.get('CLN-001')!.checker).toBeNull();
  });
});

describe('CLN-009 · a measure that cannot be averaged', () => {
  it('has no percentage field to average', () => {
    // The design decision, as a test. 49 of 50 is 98%, which reads like an A
    // and means one person was treated without consent — and two bad weeks at
    // 98% average to one acceptable month.
    const v = consentIntegrity([]);
    expect(Object.keys(v).sort()).toEqual(
      ['delivered', 'failures', 'headline', 'met', 'withConsent']);
    expect('percent' in v).toBe(false);
    expect('rate' in v).toBe(false);
  });

  it('is met only when there are no failures at all', () => {
    const clean = consentIntegrity([
      compliance({ bookingId: 'bk-1', delivered: true, deliveredAt: T(11, 0) }),
      compliance({ bookingId: 'bk-2', delivered: true, deliveredAt: T(12, 0) }),
    ]);
    expect(clean.met).toBe(true);
    expect(clean.delivered).toBe(2);
    expect(clean.withConsent).toBe(2);
    expect(clean.headline).toBe('2 of 2 treated with consent in place.');
  });

  it('names the patient rather than reporting a rate', () => {
    // "One patient" is a sentence somebody acts on. "98%" is a sentence
    // somebody files.
    const v = consentIntegrity([
      compliance({ bookingId: 'bk-1', delivered: true, deliveredAt: T(11, 0) }),
      compliance({
        bookingId: 'bk-2', patientLabel: 'Sunil Mehta', delivered: true,
        deliveredAt: T(12, 0), breaches: [breach('CONSENT', T(12, 0))],
      }),
    ]);
    expect(v.met).toBe(false);
    expect(v.delivered).toBe(2);
    expect(v.withConsent).toBe(1);
    expect(v.headline).toContain('Sunil Mehta');
    expect(v.headline).not.toContain('%');
  });

  it('says a late signature does not clear it', () => {
    // Evaluated strictly as of the minute of delivery, which the compliance
    // engine already does. This is the sentence that says so out loud.
    const v = consentIntegrity([compliance({
      delivered: true, deliveredAt: T(14, 0),
      breaches: [breach('CONSENT', T(14, 0), T(16, 30))],
    })]);
    expect(v.met).toBe(false);
    expect(v.failures[0]!.metLateAt).toBe(T(16, 30));
    expect(v.failures[0]!.because).toContain('Signed at 16:30');
    expect(v.failures[0]!.because).toContain('does not clear it');
  });

  it('counts guardian and procedure-specific consent, not just the general form', () => {
    // A general surgical consent is not a nerve-injury consent, and a minor
    // treated on their own signature is a consent failure however the form
    // was labelled.
    for (const id of ['GUARDIAN', 'NERVE_CONSENT', 'SINUS_CONSENT']) {
      const v = consentIntegrity([compliance({
        delivered: true, deliveredAt: T(11, 0), breaches: [breach(id, T(11, 0))],
      })]);
      expect(v.met, `${id} should count as a consent failure`).toBe(false);
    }
  });

  it('does not count a non-consent breach as a consent failure', () => {
    // A missing post-operative instruction is serious and is not this.
    const v = consentIntegrity([compliance({
      delivered: true, deliveredAt: T(11, 0), breaches: [breach('POST_OP', T(11, 0))],
    })]);
    expect(v.met).toBe(true);
    expect(v.failures).toEqual([]);
  });

  it('counts one patient once, however many consents they were short of', () => {
    // Two missing consents on one implant is one person treated without
    // consent, not two.
    const v = consentIntegrity([compliance({
      delivered: true, deliveredAt: T(11, 0),
      breaches: [breach('CONSENT', T(11, 0)), breach('NERVE_CONSENT', T(11, 0))],
    })]);
    expect(v.delivered).toBe(1);
    expect(v.withConsent).toBe(0);
    expect(v.failures).toHaveLength(2);
  });

  it('ignores a booking that has not been delivered yet', () => {
    // A patient who has not been treated has not been treated without consent.
    // A missing consent on a booking still to come is CLN-009 doing its job,
    // not a failure to count.
    const v = consentIntegrity([compliance({ delivered: false, ready: false })]);
    expect(v.delivered).toBe(0);
    expect(v.met).toBe(true);
    expect(v.headline).toBe('Nothing delivered yet today.');
  });
});

describe('CLN-010 · every patient in today’s list', () => {
  const atOf = (id: string) => (id === 'bk-1' ? T(11, 0) : T(14, 0));

  it('reports each control against the gate that carries it', () => {
    const v = clinicalControls([compliance({
      gates: [
        gate('HISTORY', 'MET', 'Reviewed at 10:40'),
        gate('ALLERGY', 'MISSING', 'Nobody has reviewed allergies today'),
        gate('CONSENT', 'MET'),
      ],
      ready: false, headline: 'PROCEDURE NOT READY — ALLERGIES NOT REVIEWED',
    })], atOf);

    const row = v.rows[0]!;
    expect(row.controls.find((c) => c.id === 'CLN-001')!.verdict).toBe('MET');
    expect(row.controls.find((c) => c.id === 'CLN-002')!.verdict).toBe('MISSING');
    expect(row.controls.find((c) => c.id === 'CLN-002')!.because)
      .toContain('Nobody has reviewed allergies');
  });

  it('says not-applicable by a positive rule, never by silence', () => {
    // The catalogue says photographs are not taken for a scaling. That is a
    // different statement from a gate nobody has answered.
    const v = clinicalControls([compliance({ gates: [gate('HISTORY', 'MET')] })], atOf);
    const photos = v.rows[0]!.controls.find((c) => c.id === 'CLN-005')!;
    expect(photos.verdict).toBe('NOT_APPLICABLE');
    expect(photos.because).toContain('is not required for');
  });

  it('reports CLN-010 as the readiness calculation, not as a gate', () => {
    const ready = clinicalControls([compliance({ ready: true })], atOf);
    expect(ready.rows[0]!.controls.find((c) => c.id === 'CLN-010')!.verdict).toBe('MET');

    const held = clinicalControls([compliance({
      ready: false, headline: 'PROCEDURE NOT READY — CONSENT NOT TAKEN',
    })], atOf);
    const cln010 = held.rows[0]!.controls.find((c) => c.id === 'CLN-010')!;
    expect(cln010.verdict).toBe('MISSING');
    expect(cln010.because).toContain('CONSENT NOT TAKEN');
  });

  it('calls out consent on its own, because it is the one with a 100% target', () => {
    expect(clinicalControls([compliance({
      gates: [gate('CONSENT', 'MET')],
    })], atOf).rows[0]!.consent).toBe('MET');

    expect(clinicalControls([compliance({
      gates: [gate('CONSENT', 'MISSING')], ready: false,
    })], atOf).rows[0]!.consent).toBe('MISSING');

    expect(clinicalControls([compliance({
      gates: [gate('CONSENT', 'MET')], delivered: true, deliveredAt: T(11, 0),
      breaches: [breach('CONSENT', T(11, 0), T(11, 30))],
    })], atOf).rows[0]!.consent).toBe('BREACHED');
  });

  it('reads the day in time order, not in whatever order the engine returned', () => {
    const v = clinicalControls([
      compliance({ bookingId: 'bk-2', patientLabel: 'Farah' }),
      compliance({ bookingId: 'bk-1', patientLabel: 'Anita' }),
    ], atOf);
    expect(v.rows.map((r) => r.patientLabel)).toEqual(['Anita', 'Farah']);
  });

  it('ranks failing controls by what they cost, then by how many', () => {
    // A PS failing once outranks an I failing five times, because the second
    // is a backlog and the first is a patient.
    const v = clinicalControls([
      compliance({ bookingId: 'bk-1',
        gates: [gate('ALLERGY', 'MISSING'), gate('PHOTOS', 'MISSING')] }),
      compliance({ bookingId: 'bk-2',
        gates: [gate('PHOTOS', 'MISSING')] }),
    ], atOf);
    expect(v.failing[0]!.control.id).toBe('CLN-002');
    expect(v.failing[0]!.count).toBe(1);
    expect(v.failing.find((f) => f.control.id === 'CLN-005')!.count).toBe(2);
  });

  it('leads on the consent failure above everything else', () => {
    // Nothing outranks somebody having been treated without consent.
    const v = clinicalControls([compliance({
      patientLabel: 'Sunil Mehta', delivered: true, deliveredAt: T(11, 0),
      breaches: [breach('CONSENT', T(11, 0))],
    })], atOf);
    expect(v.headline).toContain('without consent');
    expect(v.headline).toContain('Sunil Mehta');
  });

  it('says the clinic is clear only when it is', () => {
    expect(clinicalControls([compliance({ ready: true })], atOf).headline)
      .toBe('Every patient booked today has passed their pre-treatment controls.');
    expect(clinicalControls([], atOf).headline).toBe('Nothing booked today.');
  });
});

describe('what this matrix does not settle', () => {
  it('names the self-check the scan does not yet refuse', () => {
    // CLN-004 names the assistant as doer and the doctor as checker. KuBi
    // records both and does not yet refuse a scan justified by whoever took
    // it, the way sterilisation refuses a self-released batch.
    expect(CLINICAL_QUESTIONS.join(' ')).toContain('self-released batch');
  });

  it('names "where required" and "where applicable" as undecided', () => {
    expect(CLINICAL_QUESTIONS.join(' ')).toContain('where required');
    expect(CLINICAL_QUESTIONS.join(' ')).toContain('where applicable');
  });

  it('renders as plain sentences, because these go on a screen', () => {
    expect(CLINICAL_QUESTIONS.join(' ')).not.toContain('*');
  });
});

describe('CLN-004 · every exposure is justified, not just the CBCT', () => {
  it('puts the justification wherever a radiograph is taken', () => {
    // Found by reading the screen: an implant showed "pre-treatment scan — not
    // required", which cannot be right. Justification was declared on the CBCT
    // treatment alone while `imaging()` was used by many — and an exposure with
    // no written justification is not a paperwork gap, it is an unjustified
    // dose and a statutory one.
    const imaged = TREATMENTS.filter((t) => t.items.some((i) => i.id === 'IMAGING'));
    expect(imaged.length).toBeGreaterThan(1);
    for (const t of imaged) {
      expect(t.items.map((i) => i.id), `${t.code} images without justifying`)
        .toContain('JUSTIFY');
    }
  });

  it('does not ask for one where nothing is exposed', () => {
    // NOT_APPLICABLE by a positive rule: no radiograph, no dose to justify.
    for (const t of TREATMENTS) {
      if (t.items.some((i) => i.id === 'IMAGING')) continue;
      expect(t.items.map((i) => i.id), `${t.code} justifies an exposure it does not take`)
        .not.toContain('JUSTIFY');
    }
  });

  it('blocks, because a dose cannot be un-given', () => {
    const implant = TREATMENTS.find((t) => t.code === 'IMPLANT')!;
    expect(implant.items.find((i) => i.id === 'JUSTIFY')!.gate).toBe('BLOCK');
  });
});

describe('advisory is not the same as not required', () => {
  const atOf = () => T(11, 0);

  it('says CLN-007 is advisory rather than claiming it is not required', () => {
    // Found by reading the screen. The mandatory list carries blocking gates
    // only, so an advisory control has no gate to read — and reporting "not
    // required for Implant placement" was simply false. It is asked of every
    // treatment and holds none of them.
    const v = clinicalControls([compliance({ gates: [gate('HISTORY', 'MET')] })], atOf);
    const estimate = v.rows[0]!.controls.find((c) => c.id === 'CLN-007')!;
    expect(estimate.verdict).toBe('ADVISORY');
    expect(estimate.because).toContain('holds none of them');
  });

  it('still says not-required for a blocking control the treatment does not carry', () => {
    // Photographs really are not taken for a scaling, and that is a positive
    // rule rather than an absence.
    const v = clinicalControls([compliance({ gates: [gate('HISTORY', 'MET')] })], atOf);
    expect(v.rows[0]!.controls.find((c) => c.id === 'CLN-005')!.verdict)
      .toBe('NOT_APPLICABLE');
  });

  it('marks exactly one control advisory, and it is the one the matrix marks I', () => {
    const advisory = CLINICAL_CONTROLS.filter((c) => c.advisory);
    expect(advisory.map((c) => c.id)).toEqual(['CLN-007']);
    expect(advisory[0]!.priority).toBe(ControlPriority.I);
  });

  it('does not count an advisory control as failing across the day', () => {
    // Otherwise every patient every day would carry a red CLN-007, which is
    // how a list stops being read.
    const v = clinicalControls([compliance({ gates: [gate('HISTORY', 'MET')] })], atOf);
    expect(v.failing.map((f) => f.control.id)).not.toContain('CLN-007');
  });
});

describe('CLN-009 covers the consent CLN-008 identified, not just the general form', () => {
  const atOf = () => T(11, 0);

  it('is not met when a procedure-specific consent is missing', () => {
    // Found by reading the screen: an implant showed CLN-009 "Met" from the
    // general CONSENT gate while the badge two lines above said "consent not
    // signed", because a sinus consent was outstanding. CLN-008 identifies
    // that consent; CLN-009 has to be measured against what it identified.
    const v = clinicalControls([compliance({
      gates: [gate('CONSENT', 'MET'), gate('SINUS_CONSENT', 'MISSING',
        'A consent naming sinus perforation has not been signed')],
    })], atOf);
    const row = v.rows[0]!;
    expect(row.controls.find((c) => c.id === 'CLN-009')!.verdict).toBe('MISSING');
    expect(row.consent).toBe('MISSING');
  });

  it('agrees with the badge, whichever way round', () => {
    // The property the contradiction violated: one patient, one answer.
    for (const gates of [
      [gate('CONSENT', 'MET')],
      [gate('CONSENT', 'MET'), gate('GUARDIAN', 'MET')],
      [gate('CONSENT', 'MISSING')],
      [],
    ]) {
      const row = clinicalControls([compliance({ gates })], atOf).rows[0]!;
      const cln009 = row.controls.find((c) => c.id === 'CLN-009')!.verdict;
      expect(cln009 === 'MET', JSON.stringify(gates)).toBe(row.consent === 'MET');
    }
  });

  it('counts them, so "all three signed" is a sentence somebody can trust', () => {
    const v = clinicalControls([compliance({
      gates: [gate('CONSENT', 'MET'), gate('NERVE_CONSENT', 'MET')],
    })], atOf);
    expect(v.rows[0]!.controls.find((c) => c.id === 'CLN-009')!.because)
      .toBe('All 2 consents signed.');
  });
});

describe('a consent that does not apply is not an unsigned consent', () => {
  const atOf = () => T(11, 0);

  it('does not report every adult in the clinic as having unsigned consent', () => {
    // The bug this whole thread of fixes came from. Every treatment carries a
    // guardian consent conditional on the patient being a minor, so an adult's
    // guardian gate reads NOT_APPLICABLE — and treating "not MET" as a
    // shortfall marked the entire day as consent-missing.
    const v = clinicalControls([compliance({
      gates: [gate('CONSENT', 'MET'), gate('GUARDIAN', 'NOT_APPLICABLE',
        'Does not apply — this patient is not a minor')],
    })], atOf);
    expect(v.rows[0]!.consent).toBe('MET');
    expect(v.rows[0]!.controls.find((c) => c.id === 'CLN-009')!.verdict).toBe('MET');
    expect(v.rows[0]!.controls.find((c) => c.id === 'CLN-009')!.because)
      .toBe('All 1 consent signed.');
  });

  it('still refuses to pass a consent nobody has asked about', () => {
    // NOT_APPLICABLE is a pass because it comes from a positive rule — the
    // question was asked and answered. UNKNOWN is not, and never becomes one.
    const v = clinicalControls([compliance({
      gates: [gate('CONSENT', 'MET'), gate('GUARDIAN', 'UNKNOWN',
        'Nobody has recorded whether this patient is a minor')],
    })], atOf);
    expect(v.rows[0]!.consent).toBe('MISSING');
    expect(v.rows[0]!.controls.find((c) => c.id === 'CLN-009')!.verdict).toBe('UNKNOWN');
  });

  it('says no consent is required only when none applies at all', () => {
    const v = clinicalControls([compliance({
      gates: [gate('GUARDIAN', 'NOT_APPLICABLE')],
    })], atOf);
    expect(v.rows[0]!.consent).toBe('NOT_APPLICABLE');
    expect(v.rows[0]!.controls.find((c) => c.id === 'CLN-009')!.because)
      .toContain('No consent is required');
  });
});

describe('the register is prose, because it is rendered on a wall', () => {
  it('carries no source-code markup', () => {
    // Same class of defect as the asterisks in the reception questions.
    // Backticks that meant "code" in a source file render literally.
    for (const c of CLINICAL_CONTROLS) {
      expect(c.why, `${c.id} has markup in it`).not.toContain('`');
      expect(c.why, `${c.id} has markup in it`).not.toContain('*');
    }
  });

  it('gives every control a reason long enough to be one', () => {
    for (const c of CLINICAL_CONTROLS) {
      expect(c.why.length, `${c.id} has no reason`).toBeGreaterThan(40);
    }
  });
});
