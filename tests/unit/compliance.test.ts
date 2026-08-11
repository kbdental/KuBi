/**
 * The compliance engine.
 *
 * The owner: *"Some actions should be mandatory gates… If mandatory
 * requirements are missing: ⚠ PROCEDURE NOT READY. The software should not
 * quietly allow the missing requirement to disappear."*
 *
 * The first sentence is a checklist. The second is the product, and most of
 * this file is four separate attempts to make a mandatory requirement vanish:
 * override it, never ask about it, refuse silently, or do the treatment anyway
 * and sign the consent afterwards. None of them works, and the last one is the
 * one worth the most.
 */
import { describe, it, expect } from 'vitest';
import {
  ClinicEvent, RoleCode, complianceFor, complianceAcross, mustListFor, mayStart,
  GATE_EVIDENCE, GateBasis, GateOutcome, TREATMENTS, CareGate, CareStage,
  NOTHING_KNOWN,
  type Booking, type PatientFacts, type ReadinessEvent, type Compliance,
} from '@kubi/contracts';

const DAY = 24 * 60;
const APPT = 5 * DAY + 10 * 60;

const booking = (code: string, over: Partial<Booking> = {}): Booking => ({
  id: 'bk-1', treatmentCode: code, patientLabel: 'Anita Rao',
  at: APPT, sitting: 1, ...over,
});

const KNOWN: PatientFacts = {
  anticoagulated: false, prophylaxisIndicated: false, diabetic: false,
  antiresorptive: false, pregnant: false, penicillinAllergy: false,
  smoker: false, minor: false,
};

const met = (bookingId: string, gateId: string, at: number): ReadinessEvent =>
  ({ type: ClinicEvent.CARE_ITEM_MET, subjectId: `${bookingId}#${gateId}`, at });

const delivered = (bookingId: string, at: number): ReadinessEvent =>
  ({ type: ClinicEvent.TREATMENT_DELIVERED, subjectId: bookingId, at });

const FIT = { unusableAssets: [] as string[] };

/** Every BEFORE gate met, except the ones named. */
function metAllBut(code: string, skip: readonly string[], at = APPT - 60): ReadinessEvent[] {
  return mustListFor(code)
    .filter((m) => m.stage === CareStage.BEFORE && !skip.includes(m.id))
    .map((m) => met('bk-1', m.id, at));
}

const of = (code: string, events: ReadinessEvent[], now = APPT,
  facts: PatientFacts = KNOWN, inputs = FIT): Compliance =>
  complianceFor(booking(code), facts, events, now, inputs)!;

/* ═══════════════════════════════════════════════════════════════════════ */

describe('the must-required list', () => {
  it('is the owner’s RCT list, and more', () => {
    // "RCT — before treatment starts: consent, relevant radiograph, medical
    // history, treatment plan." All four, plus what the clinic's own protocol
    // adds: rubber dam, and the anaesthetic check.
    const ids = mustListFor('RCT_POST')
      .filter((m) => m.stage === CareStage.BEFORE).map((m) => m.id);
    expect(ids).toContain('CONSENT');
    expect(ids).toContain('IMAGING');
    expect(ids).toContain('HISTORY');
    expect(ids).toContain('DAM');
    expect(ids).toContain('LA_REVIEW');
  });

  it('is the owner’s implant list, item for item', () => {
    // "Consent · medical history · pre-op records · implant/components
    // available · surgical kit ready · sterilization confirmed · pre-op
    // instructions completed."
    const ids = mustListFor('IMPLANT')
      .filter((m) => m.stage === CareStage.BEFORE).map((m) => m.id);
    expect(ids).toContain('CONSENT');
    expect(ids).toContain('HISTORY');
    expect(ids).toContain('IMAGING');         // pre-op records
    expect(ids).toContain('PLAN_SIGNED');     // pre-op records
    expect(ids).toContain('IMPLANT_STOCK');   // implant/components available
    expect(ids).toContain('DRILL_KIT');       // surgical kit ready
    expect(ids).toContain('STERILE_PACK');    // sterilization confirmed
    expect(ids).toContain('EQUIPMENT_FIT');   // sterilization confirmed, the other half
  });

  it('states what would actually prove every single gate', () => {
    // A gate whose evidence is "somebody ticked it" is a gate that has already
    // failed. This is the test that stops a new blocking requirement being
    // added to a treatment without anybody saying what would satisfy it.
    for (const t of TREATMENTS) {
      for (const i of t.items) {
        if (i.gate !== CareGate.BLOCK) continue;
        const spec = GATE_EVIDENCE[i.id];
        expect(spec, `${t.code}/${i.id} has no evidence standard`).toBeDefined();
        expect(spec!.evidence.length, `${t.code}/${i.id} evidence is too thin`)
          .toBeGreaterThan(25);
      }
    }
  });

  it('separates what the clinic may change from what it may not', () => {
    // A clinical gate is the clinical director's. A statutory one is nobody's
    // — an exposure with no written justification is not a house-style
    // question, and neither is a labelled biopsy specimen.
    expect(GATE_EVIDENCE.JUSTIFY!.basis).toBe(GateBasis.STATUTORY);
    expect(GATE_EVIDENCE.SPECIMEN!.basis).toBe(GateBasis.STATUTORY);
    expect(GATE_EVIDENCE.CONSENT!.basis).toBe(GateBasis.CONSENT);
    expect(GATE_EVIDENCE.STERILE_PACK!.basis).toBe(GateBasis.SAFETY);
    expect(GATE_EVIDENCE.OCCLUSION!.basis).toBe(GateBasis.CLINICAL);
  });

  it('names whose word will do, where only one will', () => {
    // A consent attested by reception is not a consent.
    expect(GATE_EVIDENCE.CONSENT!.attestedBy).toBe(RoleCode.TREATING_DOCTOR);
    expect(GATE_EVIDENCE.STERILE_PACK!.attestedBy).toBe(RoleCode.STERILIZATION_TECHNICIAN);
    // And a stock reservation may be attested by whoever reserved it.
    expect(GATE_EVIDENCE.IMPLANT_STOCK!.attestedBy).toBeNull();
  });

  it('says nothing about a treatment it does not have', () => {
    expect(mustListFor('NOT-A-TREATMENT')).toEqual([]);
  });
});

describe('⚠ PROCEDURE NOT READY', () => {
  it('refuses when a mandatory gate is missing, and names it', () => {
    const c = of('IMPLANT', metAllBut('IMPLANT', ['CONSENT']));
    expect(c.ready).toBe(false);
    expect(c.verdict).toBe('NOT_READY');
    expect(c.headline).toContain('PROCEDURE NOT READY');
    expect(c.headline).toContain('Consent taken');
  });

  it('says READY when every mandatory gate is met', () => {
    const c = of('IMPLANT', metAllBut('IMPLANT', []));
    expect(c.ready).toBe(true);
    expect(c.verdict).toBe('READY');
    expect(c.missing).toHaveLength(0);
  });

  it('leads on the most serious thing missing, not the first', () => {
    // Consent outranks a stock reservation, whatever order the list is in.
    const c = of('IMPLANT', metAllBut('IMPLANT', ['CONSENT', 'IMPLANT_STOCK']));
    expect(c.missing[0]!.id).toBe('CONSENT');
    expect(c.missing.map((m) => m.id)).toContain('IMPLANT_STOCK');
  });

  it('lets advisory work be outstanding without refusing', () => {
    // Baseline observations and a shade are real work. Neither is a reason to
    // keep a patient out of the chair, and a gate list that included them
    // would be one people stop reading.
    const c = of('FILLING', metAllBut('FILLING', []));
    expect(c.ready).toBe(true);
  });
});

describe('the four ways a requirement disappears', () => {
  /* ── 1. Somebody overrides it ──────────────────────────────────────── */
  it('offers nothing to override it with', () => {
    // The enforcement is the absence of a parameter. `complianceFor` takes a
    // booking, the facts, the log, a minute and the equipment state — and
    // nothing that could let anybody past. There is no permission to grant,
    // delegate or leak, which is constitution rule 2 stated as an arity.
    expect(complianceFor.length).toBeLessThanOrEqual(5);
    const c = of('IMPLANT', metAllBut('IMPLANT', ['CONSENT']));
    const attempt = mayStart(c);
    expect(attempt.allowed).toBe(false);
    // And the refusal offers exactly one thing to do with it: record it.
    if (attempt.allowed) return;
    expect(Object.keys(attempt)).toEqual(['allowed', 'because', 'missing', 'record']);
  });

  /* ── 2. Nobody asked, so it looks satisfied ───────────────────────── */
  it('fails a gate nobody has asked about, exactly as if it were unmet', () => {
    // Everything else met, and nobody has asked about blood thinners. The
    // bleeding plan is deliberately NOT reported met here — a gate somebody
    // actually did stays done whatever the facts turn out to be, which is
    // right, and would hide the thing under test.
    const c = complianceFor(booking('EXTRACT'), NOTHING_KNOWN,
      metAllBut('EXTRACT', ['ANTICOAG']), APPT, FIT)!;
    expect(c.ready).toBe(false);
    const anticoag = c.gates.find((x) => x.id === 'ANTICOAG')!;
    expect(anticoag.verdict).toBe(GateOutcome.UNKNOWN);
    expect(c.missing.map((m) => m.id)).toContain('ANTICOAG');
  });

  it('stands a gate aside only when the answer is a positive no', () => {
    const c = of('EXTRACT', metAllBut('EXTRACT', ['ANTICOAG']));
    expect(c.gates.find((x) => x.id === 'ANTICOAG')!.verdict)
      .toBe(GateOutcome.NOT_APPLICABLE);
    expect(c.ready).toBe(true);
  });

  it('will not pass a procedure because it could not reach the asset register', () => {
    // `unusableAssets` absent is not "nothing is unusable" — nobody asked.
    // A compliance engine that passes an implant because it could not read the
    // equipment register has passed it for the worst possible reason.
    const c = complianceFor(booking('IMPLANT'), KNOWN,
      metAllBut('IMPLANT', []), APPT, {})!;
    expect(c.ready).toBe(false);
    expect(c.gates.find((x) => x.id === 'EQUIPMENT_FIT')!.verdict)
      .toBe(GateOutcome.UNKNOWN);
  });

  it('refuses when the autoclave itself may not be used', () => {
    // The owner's "sterilization confirmed" is two facts: a released pack for
    // this patient, and an autoclave that is fit to have released it.
    const c = complianceFor(booking('IMPLANT'), KNOWN, metAllBut('IMPLANT', []),
      APPT, { unusableAssets: ['AUTOCLAVE-01'] })!;
    expect(c.ready).toBe(false);
    expect(c.missing.map((m) => m.id)).toContain('EQUIPMENT_FIT');
    expect(c.gates.find((x) => x.id === 'EQUIPMENT_FIT')!.because)
      .toContain('AUTOCLAVE-01');
  });

  /* ── 3. The refusal is silent ─────────────────────────────────────── */
  it('hands back an event that has to be written, not an optional one', () => {
    const c = of('IMPLANT', metAllBut('IMPLANT', ['CONSENT', 'DRILL_KIT']));
    const attempt = mayStart(c);
    expect(attempt.allowed).toBe(false);
    if (attempt.allowed) return;
    expect(attempt.record.type).toBe(ClinicEvent.TREATMENT_START_REFUSED);
    // The subject carries what was missing at that minute, so the count
    // survives the requirement later being met.
    expect(attempt.record.subjectId).toContain('CONSENT');
    expect(attempt.record.subjectId).toContain('DRILL_KIT');
  });

  it('reads refusals back off the log, and keeps them after the gate is met', () => {
    const refusal: ReadinessEvent = {
      type: ClinicEvent.TREATMENT_START_REFUSED,
      subjectId: 'bk-1#CONSENT,IMPLANT_STOCK',
      at: APPT - 20,
    };
    const c = of('IMPLANT', [...metAllBut('IMPLANT', []), refusal]);
    expect(c.ready).toBe(true);                    // everything is met now
    expect(c.refusals).toHaveLength(1);            // and it still happened
    expect(c.refusals[0]!.missing).toEqual(['CONSENT', 'IMPLANT_STOCK']);
  });

  it('offers nothing at all when the procedure is ready', () => {
    expect(mayStart(of('IMPLANT', metAllBut('IMPLANT', []))))
      .toEqual({ allowed: true });
  });

  /* ── 4. It happened anyway, and the record caught up ──────────────── */
  it('records a breach when a treatment was delivered without a mandatory gate', () => {
    const events = [
      ...metAllBut('IMPLANT', ['CONSENT']),
      delivered('bk-1', APPT + 90),
    ];
    const c = of('IMPLANT', events, APPT + 200);
    expect(c.breaches).toHaveLength(1);
    expect(c.breaches[0]!.gateId).toBe('CONSENT');
    expect(c.breaches[0]!.deliveredAt).toBe(APPT + 90);
    expect(c.headline).toContain('cannot be undone');
  });

  it('does NOT clear the breach when the consent is signed afterwards', () => {
    // This is the whole file. Work gets done on paper and the consent is
    // signed at four o'clock for a procedure that started at eleven. The
    // eleven o'clock start does not become compliant at four.
    const events = [
      ...metAllBut('IMPLANT', ['CONSENT']),
      delivered('bk-1', APPT + 90),
      met('bk-1', 'CONSENT', APPT + 300),     // signed five hours later
    ];
    const c = of('IMPLANT', events, APPT + 400);

    // The gate reads MET now — that is true and worth showing.
    expect(c.gates.find((x) => x.id === 'CONSENT')!.verdict).toBe(GateOutcome.MET);
    // And the breach is still there, with the late signature recorded on it.
    expect(c.breaches).toHaveLength(1);
    expect(c.breaches[0]!.gateId).toBe('CONSENT');
    expect(c.breaches[0]!.metLateAt).toBe(APPT + 300);
  });

  it('judges a breach strictly on what existed at the minute of delivery', () => {
    const onTime = [
      ...metAllBut('IMPLANT', ['CONSENT']),
      met('bk-1', 'CONSENT', APPT - 5),
      delivered('bk-1', APPT + 90),
    ];
    expect(of('IMPLANT', onTime, APPT + 200).breaches).toHaveLength(0);

    const oneMinuteLate = [
      ...metAllBut('IMPLANT', ['CONSENT']),
      met('bk-1', 'CONSENT', APPT + 91),
      delivered('bk-1', APPT + 90),
    ];
    expect(of('IMPLANT', oneMinuteLate, APPT + 200).breaches).toHaveLength(1);
  });

  it('has no function anywhere that removes a breach', () => {
    // Not a runtime check — an absence. There is nothing exported that takes a
    // breach and makes it go away, which is why nobody can be granted the
    // ability to do it.
    const c = of('IMPLANT', [
      ...metAllBut('IMPLANT', ['CONSENT']), delivered('bk-1', APPT + 90),
    ], APPT + 200);
    expect(Object.isFrozen(c.breaches) || Array.isArray(c.breaches)).toBe(true);
    expect(c.breaches).toHaveLength(1);
    // Re-deriving from the same log gives the same breach, every time.
    const again = of('IMPLANT', [
      ...metAllBut('IMPLANT', ['CONSENT']), delivered('bk-1', APPT + 90),
    ], APPT + 5000);
    expect(again.breaches).toHaveLength(1);
  });

  it('reports no breach at all for a treatment that has not happened', () => {
    const c = of('IMPLANT', metAllBut('IMPLANT', ['CONSENT']));
    expect(c.delivered).toBe(false);
    expect(c.breaches).toHaveLength(0);
    expect(c.ready).toBe(false);      // not ready, but not yet a breach
  });

  it('ranks a consent breach above a records one', () => {
    const events = [
      ...metAllBut('IMPLANT', ['CONSENT', 'PLAN_SIGNED']),
      delivered('bk-1', APPT + 90),
    ];
    const c = of('IMPLANT', events, APPT + 200);
    expect(c.breaches[0]!.basis).toBe(GateBasis.CONSENT);
  });
});

describe('across the clinic', () => {
  const day = (): Compliance[] => [
    complianceFor(booking('IMPLANT', { id: 'b1', patientLabel: 'Anita Rao' }),
      KNOWN, metAllBut('IMPLANT', []).map((e) => ({ ...e, subjectId: e.subjectId.replace('bk-1', 'b1') })),
      APPT, FIT)!,
    complianceFor(booking('EXTRACT', { id: 'b2', patientLabel: 'Sunil Mehta' }),
      KNOWN, [], APPT, FIT)!,
    complianceFor(booking('SCALE', { id: 'b3', patientLabel: 'Farah Qureshi' }),
      KNOWN, [], APPT, FIT)!,
  ];

  it('counts what is not ready right now', () => {
    const v = complianceAcross(day());
    expect(v.notReady.map((c) => c.bookingId)).toEqual(['b2', 'b3']);
  });

  it('names the gates that fail most often, which is where time is lost', () => {
    const v = complianceAcross(day());
    expect(v.worstGates[0]!.count).toBeGreaterThan(1);
    expect(v.worstGates.every((g) => g.label.length > 0)).toBe(true);
  });

  it('reports the share of bookings with every gate met', () => {
    expect(complianceAcross(day()).rate).toBeCloseTo(1 / 3);
    expect(complianceAcross([]).rate).toBe(1);
  });

  it('counts every recorded refusal across the day', () => {
    const withRefusals = [
      complianceFor(booking('IMPLANT'), KNOWN, [
        ...metAllBut('IMPLANT', ['CONSENT']),
        { type: ClinicEvent.TREATMENT_START_REFUSED, subjectId: 'bk-1#CONSENT', at: APPT - 10 },
        { type: ClinicEvent.TREATMENT_START_REFUSED, subjectId: 'bk-1#CONSENT', at: APPT - 5 },
      ], APPT, FIT)!,
    ];
    expect(complianceAcross(withRefusals).refusalCount).toBe(2);
  });

  it('keeps breached treatments visible after the fact', () => {
    const breached = [of('IMPLANT', [
      ...metAllBut('IMPLANT', ['CONSENT']), delivered('bk-1', APPT + 90),
    ], APPT + 900)];
    expect(complianceAcross(breached).breached).toHaveLength(1);
  });
});

describe('what the older gate register could not do', () => {
  /**
   * `compliance-gates.ts` wrote the owner's seventeen universal gates down as
   * a specification, with `evaluable: false` against every requirement KuBi
   * held no field for. It was a roadmap and could refuse nothing. These are
   * the ones that are now decided from the event log rather than from a flag.
   */
  it('decides consent, history, radiograph, stock and sterility from events', () => {
    for (const id of ['CONSENT', 'HISTORY', 'IMAGING', 'IMPLANT_STOCK', 'STERILE_PACK']) {
      const missing = of('IMPLANT', metAllBut('IMPLANT', [id]));
      expect(missing.ready, `${id} does not refuse`).toBe(false);
      expect(missing.missing.map((m) => m.id)).toContain(id);

      const present = of('IMPLANT', metAllBut('IMPLANT', []));
      expect(present.gates.find((x) => x.id === id)!.verdict).toBe(GateOutcome.MET);
    }
  });
});
