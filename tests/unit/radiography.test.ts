/**
 * CLN-004 — a scan may not be justified by the person who took it.
 *
 * KuBi already required the justification and recorded who wrote it. What it
 * did not do was refuse one written by the person who pressed the button: the
 * Doer and the Checker were two columns in a document and one person in the
 * software.
 *
 * The second block is the one that will catch a real clinic out. The matrix
 * does not state it and radiation law does: a justification written *after*
 * the exposure is not a justification, it is a rationalisation, and it is
 * worse than nothing because it looks like compliance.
 */
import { describe, it, expect } from 'vitest';
import {
  RoleCode, ClinicEvent, ControlPriority,
  ExposureVerdict, radiography, refuseExposure, radiographyFindings,
  exposuresFrom, justificationsFrom,
  RADIOGRAPHY_SHEET_COLUMNS, RADIOGRAPHY_QUESTIONS,
  type Exposure, type Justification, type ReadinessEvent,
} from '@kubi/contracts';

const T = (h: number, m = 0) => h * 60 + m;

const ASSISTANT = 'e1';
const OTHER_ASSISTANT = 'e2';
const DOCTOR = 'e7';

const took = (over: Partial<Exposure> = {}): Exposure => ({
  bookingId: 'bk-1', what: 'Periapical, lower right',
  at: T(11, 20), byEmployeeCode: ASSISTANT, byRole: RoleCode.DENTAL_ASSISTANT,
  ...over,
});

const justified = (over: Partial<Justification> = {}): Justification => ({
  bookingId: 'bk-1',
  question: 'Assess periapical status of the lower right first molar before RCT',
  at: T(11, 0), byEmployeeCode: DOCTOR, byRole: RoleCode.TREATING_DOCTOR,
  ...over,
});

const one = (e: Partial<Exposure> = {}, j: Partial<Justification>[] = [{}]) =>
  radiography([took(e)], j.map(justified)).results[0]!;

/* ═══════════════════════════════════════════════════════════════════════ */

describe('rule 1 · the Doer and the Checker are two people', () => {
  it('accepts a doctor’s justification and an assistant’s exposure', () => {
    // The ordinary case, and what the matrix describes.
    const r = one();
    expect(r.verdict).toBe(ExposureVerdict.JUSTIFIED);
    expect(r.failed).toBe(false);
    expect(r.leadMinutes).toBe(20);
    expect(r.because).toContain('20 minutes before the exposure');
  });

  it('refuses a justification written by the person who took it', () => {
    // The gap this closes. The same rule sterilisation applies to a batch,
    // applied to a dose: an operator may not release their own.
    const r = one({}, [{ byEmployeeCode: ASSISTANT, byRole: RoleCode.DENTAL_ASSISTANT }]);
    expect(r.verdict).toBe(ExposureVerdict.SELF_JUSTIFIED);
    expect(r.failed).toBe(true);
    expect(r.because).toContain('one person cannot be both');
  });

  it('refuses a second assistant as well, because two people is not enough', () => {
    // Justification is a clinical judgement about whether this dose is
    // warranted for this patient. An assistant checking another assistant
    // satisfies the letter of "two people" and answers none of the question.
    const r = one({}, [{
      byEmployeeCode: OTHER_ASSISTANT, byRole: RoleCode.DENTAL_ASSISTANT,
    }]);
    expect(r.verdict).toBe(ExposureVerdict.NOT_A_DOCTOR);
    expect(r.because).toContain('clinical judgement');
  });

  it('accepts the clinical director as well as the treating doctor', () => {
    const r = one({}, [{ byEmployeeCode: 'e9', byRole: RoleCode.CLINICAL_DIRECTOR }]);
    expect(r.verdict).toBe(ExposureVerdict.JUSTIFIED);
  });

  it('lets a doctor take an exposure another doctor justified', () => {
    // The rule is two people, not two roles. A doctor pressing the button is
    // fine as long as somebody else decided the dose was warranted.
    const r = radiography(
      [took({ byEmployeeCode: 'e8', byRole: RoleCode.TREATING_DOCTOR })],
      [justified()],
    ).results[0]!;
    expect(r.verdict).toBe(ExposureVerdict.JUSTIFIED);
  });
});

describe('rule 2 · the justification comes first', () => {
  it('refuses one written after the dose', () => {
    // The rule the matrix does not state and the law does. A justification
    // typed at four o'clock does not make a two o'clock exposure justified.
    const r = one({ at: T(14, 0) }, [{ at: T(16, 0) }]);
    expect(r.verdict).toBe(ExposureVerdict.JUSTIFIED_AFTER);
    expect(r.failed).toBe(true);
    expect(r.because).toContain('120 minutes afterwards');
    expect(r.because).toContain('rationalisation');
  });

  it('will not let a late justification rescue an early exposure', () => {
    // The engine must not do the retro-fitting it exists to prevent, so a
    // justification written afterwards is not even a candidate for matching.
    const r = radiography(
      [took({ at: T(11, 0) })],
      [justified({ at: T(12, 0) })],
    ).results[0]!;
    expect(r.verdict).not.toBe(ExposureVerdict.JUSTIFIED);
  });

  it('separates nothing-written from written-afterwards', () => {
    // The same verdict to a regulator and two completely different
    // conversations inside a clinic: one is a gap, the other is a habit.
    expect(radiography([took()], []).results[0]!.verdict)
      .toBe(ExposureVerdict.UNJUSTIFIED);
    expect(one({ at: T(11, 0) }, [{ at: T(11, 30) }]).verdict)
      .toBe(ExposureVerdict.JUSTIFIED_AFTER);
  });

  it('takes the most recent justification written before the dose', () => {
    const r = one({ at: T(12, 0) }, [
      { at: T(9, 0), question: 'Screening' },
      { at: T(11, 45), question: 'Assess the fractured cusp before restoring' },
    ]);
    expect(r.justification!.at).toBe(T(11, 45));
    expect(r.leadMinutes).toBe(15);
  });

  it('refuses a justification that says nothing', () => {
    // "Routine" is not a question, and neither is an empty box.
    const r = one({}, [{ question: '   ' }]);
    expect(r.verdict).toBe(ExposureVerdict.NO_QUESTION);
    expect(r.failed).toBe(true);
  });
});

describe('refusing before the button, not reporting after it', () => {
  it('lets the exposure go ahead when everything stands up', () => {
    expect(refuseExposure('bk-1', ASSISTANT, T(11, 20), [justified()])).toBeNull();
  });

  it('refuses the person who wrote the justification', () => {
    // The refusal happens at the moment somebody could still fetch the doctor,
    // rather than in a report a week later.
    const r = refuseExposure('bk-1', DOCTOR, T(11, 20), [justified()])!;
    expect(r.reason).toBe(ExposureVerdict.SELF_JUSTIFIED);
    expect(r.because).toContain('you may not also take it');
    expect(r.ownerRole).toBe(RoleCode.TREATING_DOCTOR);
  });

  it('refuses when nothing has been written, and says why the order matters', () => {
    const r = refuseExposure('bk-1', ASSISTANT, T(11, 20), [])!;
    expect(r.reason).toBe(ExposureVerdict.UNJUSTIFIED);
    expect(r.because).toContain('writing it afterwards does not count');
  });

  it('refuses a justification written by somebody who is not a doctor', () => {
    const r = refuseExposure('bk-1', ASSISTANT, T(11, 20), [
      justified({ byEmployeeCode: OTHER_ASSISTANT, byRole: RoleCode.DENTAL_ASSISTANT }),
    ])!;
    expect(r.reason).toBe(ExposureVerdict.NOT_A_DOCTOR);
  });

  it('ignores a justification that has not been written yet', () => {
    // Asked at 11:20 about a justification timestamped 11:45 — which is the
    // clock being read correctly rather than a trick.
    const r = refuseExposure('bk-1', ASSISTANT, T(11, 20), [justified({ at: T(11, 45) })])!;
    expect(r.reason).toBe(ExposureVerdict.UNJUSTIFIED);
  });

  it('does not let one booking’s justification cover another', () => {
    const r = refuseExposure('bk-2', ASSISTANT, T(11, 20), [justified()])!;
    expect(r.reason).toBe(ExposureVerdict.UNJUSTIFIED);
  });
});

describe('the register, across a day', () => {
  it('reports met only when every dose given stands up', () => {
    const clean = radiography([took()], [justified()]);
    expect(clean.met).toBe(true);
    expect(clean.headline).toContain('justified by a doctor before it was taken');

    const dirty = radiography(
      [took(), took({ bookingId: 'bk-2', at: T(14, 0) })],
      [justified()],
    );
    expect(dirty.met).toBe(false);
    expect(dirty.failures).toHaveLength(1);
  });

  it('says nothing has been exposed when nothing has', () => {
    // Never a reassuring "100% justified" over an empty day.
    const v = radiography([], []);
    expect(v.met).toBe(true);
    expect(v.headline).toBe('No exposure has been taken today.');
  });

  it('lists a justification with no exposure as the normal state, not a failure', () => {
    // The doctor has decided a radiograph is warranted and nobody has taken it
    // yet. That is the middle of a correct process.
    const v = radiography([], [justified()]);
    expect(v.justifiedNotTaken).toHaveLength(1);
    expect(v.failures).toEqual([]);
  });

  it('carries every failure as a finding the dashboard can show', () => {
    const v = radiography([took()], []);
    const f = radiographyFindings(v)[0]!;
    expect(f.control).toBe('CLN-004');
    expect(f.priority).toBe(ControlPriority.C);
    expect(f.ownerRole).toBe(RoleCode.QUALITY_COMPLIANCE);
  });

  it('never clears a failure, because the dose has been given', () => {
    // Permanent, like a consent breach. Nothing written afterwards changes
    // what the patient has already had.
    const late = radiography([took({ at: T(11, 0) })], [justified({ at: T(15, 0) })]);
    expect(late.failures).toHaveLength(1);
    expect(late.met).toBe(false);
  });
});

describe('reading it out of the log', () => {
  const ev = (type: ClinicEvent, subjectId: string, at: number): ReadinessEvent =>
    ({ type, subjectId, at });

  it('reads both events with the person and the role on them', () => {
    const events = [
      ev(ClinicEvent.EXPOSURE_JUSTIFIED, `bk-1#${DOCTOR}#TREATING_DOCTOR`, T(11, 0)),
      ev(ClinicEvent.EXPOSURE_TAKEN, `bk-1#${ASSISTANT}#DENTAL_ASSISTANT`, T(11, 20)),
    ];
    const js = justificationsFrom(events, new Map([[T(11, 0), 'Assess the apex']]));
    const es = exposuresFrom(events, new Map([[T(11, 20), 'Periapical']]));

    expect(js[0]!.byEmployeeCode).toBe(DOCTOR);
    expect(js[0]!.question).toBe('Assess the apex');
    expect(es[0]!.byEmployeeCode).toBe(ASSISTANT);
    expect(radiography(es, js).met).toBe(true);
  });

  it('is derived — no event records that an exposure was justified properly', () => {
    // Same rule as clinic readiness and room availability. The log records
    // what two people did; the verdict is computed from it every time.
    expect(Object.keys(ClinicEvent).filter((n) => /EXPOSURE_OK|SCAN_APPROVED/.test(n)))
      .toEqual([]);
    expect(ClinicEvent.EXPOSURE_JUSTIFIED).toBeTruthy();
    expect(ClinicEvent.EXPOSURE_TAKEN).toBeTruthy();
  });

  it('names the columns the register must carry', () => {
    for (const c of ['justified_by', 'clinical_question', 'exposed_by', 'exposed_at']) {
      expect(RADIOGRAPHY_SHEET_COLUMNS).toContain(c);
    }
  });
});

describe('what this control still does not settle', () => {
  it('names the three, in plain sentences', () => {
    expect(RADIOGRAPHY_QUESTIONS).toHaveLength(3);
    expect(RADIOGRAPHY_QUESTIONS.join(' ')).not.toContain('`');
    expect(RADIOGRAPHY_QUESTIONS.join(' ')).not.toContain('*');
  });

  it('names the single-handed session, where the rule bites hardest', () => {
    // CLN-004 assumes two people are available. The evening emergency with one
    // clinician in the building is the case the clinic will hit first.
    expect(RADIOGRAPHY_QUESTIONS.join(' ')).toContain('single-handed');
  });

  it('names that one justification currently covers a series', () => {
    expect(RADIOGRAPHY_QUESTIONS.join(' ')).toContain('cover a series');
  });
});
