/**
 * The patient event engine.
 *
 * The owner: *"The patient's clinical journey automatically generates work…
 * Nobody needs to manually create these tasks."* So the claim under test is
 * that booking a treatment is enough — no template is copied, no task table is
 * written, and the work exists because the booking does.
 *
 * The second claim, and the one worth more: an unasked question is not a
 * negative answer. Most of the file below is attempts to get a treatment
 * started on a patient nobody has asked about.
 */
import { describe, it, expect } from 'vitest';
import {
  ClinicEvent, RoleCode, careFor, careForAll, careOwedBy,
  TREATMENTS, TREATMENT_BY_CODE, CareState, CareGate, CareStage,
  NOTHING_KNOWN, UNRATIFIED_CATALOGUE,
  type Booking, type PatientFacts, type ReadinessEvent,
} from '@kubi/contracts';

const T = (h: number, m = 0) => h * 60 + m;
const DAY = 24 * 60;

/** 10:00 on day three of the test clock, so "three days before" is a real minute. */
const APPT = 5 * DAY + T(10);

const booking = (code: string, over: Partial<Booking> = {}): Booking => ({
  id: 'bk-1', treatmentCode: code, patientLabel: 'Anita Rao',
  at: APPT, sitting: 1, ...over,
});

const facts = (over: Partial<PatientFacts> = {}): PatientFacts =>
  ({ ...NOTHING_KNOWN, ...over });

/** Everything known and clear — the patient with no complications. */
const HEALTHY: PatientFacts = {
  anticoagulated: false, prophylaxisIndicated: false, diabetic: false,
  antiresorptive: false, pregnant: false, penicillinAllergy: false,
  smoker: false, minor: false,
};

const done = (bookingId: string, itemId: string, at: number): ReadinessEvent =>
  ({ type: ClinicEvent.CARE_ITEM_MET, subjectId: `${bookingId}#${itemId}`, at });

const delivered = (bookingId: string, at: number): ReadinessEvent =>
  ({ type: ClinicEvent.TREATMENT_DELIVERED, subjectId: bookingId, at });

/** Meet every blocking BEFORE item, so only the thing under test is left. */
function readyToStart(code: string, f: PatientFacts, extra: ReadinessEvent[] = []) {
  const b = booking(code);
  const first = careFor(b, f, extra, APPT)!;
  const events = [...extra];
  for (const t of first.before) {
    if (t.gate === CareGate.BLOCK && t.state === CareState.OUTSTANDING) {
      events.push(done(b.id, t.id, t.dueAt));
    }
  }
  return { b, events };
}

/* ═══════════════════════════════════════════════════════════════════════ */

describe('a booking generates its own work', () => {
  it('creates the implant’s pre-operative work from nothing but the booking', () => {
    const c = careFor(booking('IMPLANT'), HEALTHY, [], APPT - DAY)!;
    const ids = c.before.map((t) => t.id);
    // The owner's own example, and the engine has never been told it.
    expect(ids).toContain('HISTORY');        // medical history verification
    expect(ids).toContain('CONSENT');        // consent requirement
    expect(ids).toContain('IMPLANT_STOCK');  // implant inventory check
    expect(ids).toContain('DRILL_KIT');      // surgical kit readiness
    expect(ids).toContain('IMAGING');        // pre-op scan requirement
    expect(ids).toContain('STERILE_PACK');
  });

  it('creates the implant’s post-operative work the moment it is delivered', () => {
    const c = careFor(booking('IMPLANT'), HEALTHY,
      [delivered('bk-1', APPT + 90)], APPT + 100)!;
    const ids = c.after.map((t) => t.id);
    expect(ids).toContain('POST_OP');     // post-op instructions
    expect(ids).toContain('ANALGESIA');   // prescription check
    expect(ids).toContain('CALL_24H');    // tomorrow's follow-up
    expect(ids).toContain('OSSEO_WAIT');  // next appointment
    expect(ids).toContain('NOTES');       // clinical documentation check
    expect(c.delivered).toBe(true);
  });

  it('does not put after-work on anybody before the treatment happened', () => {
    // The list a person sees is what is live, not everything that will ever
    // exist. A post-op instruction on a patient who has not been treated is
    // noise, and noise is what makes people stop reading the list.
    const c = careFor(booking('IMPLANT'), HEALTHY, [], APPT - DAY)!;
    expect(c.delivered).toBe(false);
    expect(c.open.every((t) => t.stage === CareStage.BEFORE)).toBe(true);
    expect(c.owedAfter).toHaveLength(0);
  });

  it('stores that somebody did a thing, never that a thing was required', () => {
    // The requirement is the clinic's opinion; the log is the truth. Changing
    // the protocol changes every booking in the diary at once, which is the
    // whole reason nothing is copied out of a template at booking time.
    const c = careFor(booking('IMPLANT'), HEALTHY,
      [done('bk-1', 'CONSENT', APPT - 30)], APPT)!;
    const consent = c.before.find((t) => t.id === 'CONSENT')!;
    expect(consent.state).toBe(CareState.MET);
    expect(consent.doneAt).toBe(APPT - 30);
  });

  it('says nothing at all about a treatment code it does not have', () => {
    expect(careFor(booking('NOT-A-TREATMENT'), HEALTHY, [], APPT)).toBeNull();
  });
});

describe('an unasked question is not a negative answer', () => {
  /**
   * The constitution: *"UNKNOWN is never PASS. NOT_APPLICABLE requires a
   * positive rule; absence of information is UNKNOWN."* This is that rule
   * applied to a person rather than to a checklist, and it is the difference
   * between a clinic that knows a patient is not on warfarin and one that
   * never asked.
   */
  it('holds the extraction when nobody has asked about blood thinners', () => {
    // Everything else known, so the blood thinner is the only question left.
    const f = facts({ ...HEALTHY, anticoagulated: null });
    const { b, events } = readyToStart('EXTRACT', f);
    const c = careFor(b, f, events, APPT)!;
    expect(c.mayStart).toBe(false);
    expect(c.blockedBy)
      .toBe('Nobody has asked whether the patient is on a blood thinner, and this treatment needs the answer');
  });

  it('names the question, not the undone task', () => {
    // "The anticoagulant plan has not been agreed" would send somebody to ring
    // a prescriber about a patient who may not need one at all.
    const c = careFor(booking('EXTRACT'), facts(), [], APPT)!;
    const anticoag = c.before.find((t) => t.id === 'ANTICOAG')!;
    expect(anticoag.state).toBe(CareState.UNKNOWN);
    expect(c.unknownFacts).toContain('anticoagulated');
  });

  it('lets it through once the answer is a real no', () => {
    const { b, events } = readyToStart('EXTRACT', facts({
      anticoagulated: false, prophylaxisIndicated: false,
      diabetic: false, antiresorptive: false, pregnant: false, minor: false,
    }));
    const c = careFor(b, facts({
      anticoagulated: false, prophylaxisIndicated: false,
      diabetic: false, antiresorptive: false, pregnant: false, minor: false,
    }), events, APPT)!;
    expect(c.mayStart).toBe(true);
    const anticoag = c.before.find((t) => t.id === 'ANTICOAG')!;
    expect(anticoag.state).toBe(CareState.NOT_APPLICABLE);
    expect(anticoag.standsAsideBecause).toContain('is answered and this is not that patient');
  });

  it('adds the work when the answer is yes', () => {
    const f = facts({ ...HEALTHY, anticoagulated: true });
    const c0 = careFor(booking('EXTRACT'), f, [], APPT)!;
    expect(c0.before.find((t) => t.id === 'ANTICOAG')!.state).toBe(CareState.OUTSTANDING);

    // With everything else met, the bleeding plan is what holds the chair.
    const events = c0.before
      .filter((t) => t.gate === CareGate.BLOCK
        && t.state === CareState.OUTSTANDING && t.id !== 'ANTICOAG')
      .map((t) => done('bk-1', t.id, t.dueAt));
    const c = careFor(booking('EXTRACT'), f, events, APPT)!;
    expect(c.mayStart).toBe(false);
    expect(c.blockedBy)
      .toBe('The patient is anticoagulated and no bleeding plan has been agreed');
  });

  it('treats an UNKNOWN blocking item exactly as it treats an outstanding one', () => {
    // The failure mode this exists to prevent: an UNKNOWN that is reported as
    // a warning and stepped over, which is the same as passing it.
    const unknown = careFor(booking('EXTRACT'), facts(), [], APPT)!;
    const outstanding = careFor(booking('EXTRACT'),
      facts({ anticoagulated: true }), [], APPT)!;
    expect(unknown.mayStart).toBe(false);
    expect(outstanding.mayStart).toBe(false);
  });

  it('keeps work somebody actually did, even when it turns out not to apply', () => {
    // A bleeding plan taken on a patient later found not to be anticoagulated
    // has still been taken. Reporting it as NOT_APPLICABLE would erase it.
    const c = careFor(booking('EXTRACT'), facts({ anticoagulated: false }),
      [done('bk-1', 'ANTICOAG', APPT - DAY)], APPT)!;
    expect(c.before.find((t) => t.id === 'ANTICOAG')!.state).toBe(CareState.MET);
  });

  it('asks the guardian question of every treatment, not only the children’s ones', () => {
    // An adult treatment booked for a fifteen-year-old is exactly the case a
    // paediatric-only rule misses.
    const c = careFor(booking('FILLING'), facts({ minor: null }), [], APPT)!;
    expect(c.before.find((t) => t.id === 'GUARDIAN')!.state).toBe(CareState.UNKNOWN);
  });
});

describe('an item has a clock, which is what a checklist cannot do', () => {
  it('puts prophylaxis an hour before, not on the way in', () => {
    const c = careFor(booking('EXTRACT'),
      facts({ prophylaxisIndicated: true }), [], APPT - T(2))!;
    const p = c.before.find((t) => t.id === 'PROPHYLAXIS')!;
    expect(p.dueAt).toBe(APPT - 60);
    expect(p.late).toBe(false);
  });

  it('calls it late once its own minute has passed, not the appointment’s', () => {
    const c = careFor(booking('EXTRACT'),
      facts({ prophylaxisIndicated: true }), [], APPT - 30)!;
    expect(c.before.find((t) => t.id === 'PROPHYLAXIS')!.late).toBe(true);
  });

  it('gives the implant scan a fortnight, because that is what it needs', () => {
    const c = careFor(booking('IMPLANT'), HEALTHY, [], APPT - 30 * DAY)!;
    expect(c.before.find((t) => t.id === 'IMAGING')!.dueAt).toBe(APPT - 14 * DAY);
  });

  it('counts after-work from delivery, not from the appointment time', () => {
    // A treatment that overran by an hour does not owe its next-day call an
    // hour early.
    const late = APPT + T(3);
    const c = careFor(booking('IMPLANT'), HEALTHY, [delivered('bk-1', late)], late)!;
    expect(c.after.find((t) => t.id === 'CALL_24H')!.dueAt).toBe(late + DAY);
  });

  it('falls back to the appointment when nothing has been delivered', () => {
    const c = careFor(booking('IMPLANT'), HEALTHY, [], APPT)!;
    expect(c.after.find((t) => t.id === 'CALL_24H')!.dueAt).toBe(APPT + DAY);
  });
});

describe('blocking and advising are different things', () => {
  it('will not start without consent, and will start without a recall', () => {
    const c = careFor(booking('SCALE'), HEALTHY, [], APPT)!;
    expect(c.before.find((t) => t.id === 'CONSENT')!.gate).toBe(CareGate.BLOCK);
    expect(c.after.find((t) => t.id === 'RECALL')!.gate).toBe(CareGate.ADVISE);
  });

  it('lets an advisory item be outstanding and still start', () => {
    // A filling with no shade recorded and no baseline observations. Both are
    // real work and neither is a reason to keep a patient out of the chair.
    const { b, events } = readyToStart('FILLING', HEALTHY);
    const c = careFor(b, HEALTHY, events, APPT)!;
    expect(c.mayStart).toBe(true);
    expect(c.open.map((t) => t.id)).toContain('VITALS');
    expect(c.open.every((t) => t.gate === CareGate.ADVISE)).toBe(true);
  });

  it('puts blocking work ahead of advisory work in the list', () => {
    const c = careFor(booking('IMPLANT'), HEALTHY, [], APPT)!;
    const firstAdvise = c.open.findIndex((t) => t.gate === CareGate.ADVISE);
    const lastBlock = c.open.map((t) => t.gate).lastIndexOf(CareGate.BLOCK);
    expect(firstAdvise === -1 || firstAdvise > lastBlock).toBe(true);
  });

  it('owes blocking after-work once delivered, which the day cannot close on', () => {
    const c = careFor(booking('EXTRACT'), HEALTHY,
      [delivered('bk-1', APPT + 30)], APPT + 40)!;
    const owed = c.owedAfter.map((t) => t.id);
    expect(owed).toContain('POST_OP');
    expect(owed).toContain('HAEMOSTASIS');
    expect(owed).not.toContain('CALL_24H');   // real work, not a gate
  });
});

describe('the catalogue', () => {
  it('covers every category the clinic treats in', () => {
    const cats = new Set(TREATMENTS.map((t) => t.category));
    expect([...cats].sort()).toEqual([
      'COSMETIC', 'DIAGNOSTIC', 'EMERGENCY', 'ENDODONTIC', 'IMPLANT',
      'ORTHODONTIC', 'PAEDIATRIC', 'PERIODONTAL', 'PREVENTIVE',
      'PROSTHETIC', 'RESTORATIVE', 'SURGICAL',
    ]);
  });

  it('gives every treatment a unique code', () => {
    expect(TREATMENT_BY_CODE.size).toBe(TREATMENTS.length);
  });

  it('gives every item an owner, a clock and a reason', () => {
    for (const t of TREATMENTS) {
      expect(t.items.length, `${t.code} has no items`).toBeGreaterThan(0);
      for (const i of t.items) {
        expect(Object.values(RoleCode), `${t.code}/${i.id}`).toContain(i.owner);
        expect(i.offsetMinutes, `${t.code}/${i.id} has no clock`)
          .toBeGreaterThanOrEqual(0);
        expect(i.because.length, `${t.code}/${i.id} has no reason`)
          .toBeGreaterThan(20);
      }
    }
  });

  it('never gives one treatment two items with the same id', () => {
    // Bundles overlap on purpose — a treatment sharpens a bundle's item by
    // re-declaring it — and the last one has to win rather than both surviving.
    for (const t of TREATMENTS) {
      const ids = t.items.map((i) => i.id);
      expect(new Set(ids).size, `${t.code} has a duplicate item id`).toBe(ids.length);
    }
  });

  it('writes every clinical note and charges every treatment', () => {
    // The two that must not be forgettable, on everything with a patient in
    // the chair. Emergencies included — especially emergencies.
    for (const t of TREATMENTS) {
      const ids = t.items.map((i) => i.id);
      expect(ids, `${t.code} does not require a clinical note`).toContain('NOTES');
    }
  });

  it('asks for consent before every single treatment', () => {
    for (const t of TREATMENTS) {
      const consent = t.items.find((i) => i.id === 'CONSENT');
      expect(consent, `${t.code} does not require consent`).toBeDefined();
      expect(consent!.gate).toBe(CareGate.BLOCK);
    }
  });

  it('makes every surgical treatment produce written post-operative instructions', () => {
    const surgical = ['EXTRACT', 'SURG_EXTRACT', 'THIRD_MOLAR', 'IMPLANT',
      'BONE_GRAFT', 'APICO', 'PERIO_FLAP', 'BIOPSY', 'FRENECTOMY'];
    for (const code of surgical) {
      const t = TREATMENT_BY_CODE.get(code)!;
      const p = t.items.find((i) => i.id === 'POST_OP')!;
      expect(p, `${code} gives no post-operative instructions`).toBeDefined();
      expect(p.gate).toBe(CareGate.BLOCK);
    }
  });

  it('books the removal of anything it places — sutures, splints, retainers', () => {
    expect(TREATMENT_BY_CODE.get('THIRD_MOLAR')!.items.map((i) => i.id))
      .toContain('SUTURES_OUT');
    expect(TREATMENT_BY_CODE.get('EMERG_TRAUMA')!.items.map((i) => i.id))
      .toContain('SPLINT');
    expect(TREATMENT_BY_CODE.get('ORTHO_DEBOND')!.items.map((i) => i.id))
      .toContain('RETAINER_STOCK');
  });

  it('chases a biopsy result, which is the most dangerous open item there is', () => {
    const t = TREATMENT_BY_CODE.get('BIOPSY')!;
    const chase = t.items.find((i) => i.id === 'HISTO_CHASE')!;
    expect(chase.gate).toBe(CareGate.BLOCK);
    expect(chase.stage).toBe(CareStage.AFTER);
    // And an appointment at which to say it, because a result nobody delivers
    // is a result nobody acted on.
    expect(t.items.map((i) => i.id)).toContain('RESULT_APPT');
  });

  it('will not let a root-treated tooth leave without a definitive restoration booked', () => {
    for (const code of ['RCT_ANT', 'RCT_POST']) {
      const seal = TREATMENT_BY_CODE.get(code)!.items.find((i) => i.id === 'CORONAL_SEAL')!;
      expect(seal.gate).toBe(CareGate.BLOCK);
    }
  });

  it('reserves a size either side of the implant it expects to use', () => {
    const stock = TREATMENT_BY_CODE.get('IMPLANT')!.items
      .find((i) => i.id === 'IMPLANT_STOCK')!;
    expect(stock.because).toContain('next size up');
    expect(stock.gate).toBe(CareGate.BLOCK);
  });

  it('says out loud that none of it has been signed off', () => {
    // Constitution rule 4: never silently resolve an open Owner Decision. The
    // catalogue is a scaffold derived from ordinary practice, and this is the
    // flag that stops it being mistaken for a ratified protocol. It becomes
    // false when the clinical director has been through it, and not before.
    expect(UNRATIFIED_CATALOGUE).toBe(true);
  });
});

describe('across a day', () => {
  const bookings: Booking[] = [
    booking('IMPLANT', { id: 'bk-1', at: APPT, patientLabel: 'Anita Rao' }),
    booking('EXTRACT', { id: 'bk-2', at: APPT + 120, patientLabel: 'Sunil Mehta' }),
    booking('SCALE', { id: 'bk-3', at: APPT + 240, patientLabel: 'Farah Qureshi' }),
  ];

  it('answers for every booking, and skips none', () => {
    const all = careForAll(bookings, () => HEALTHY, [], APPT);
    expect(all).toHaveLength(3);
    expect(all.map((c) => c.treatment.code))
      .toEqual(['IMPLANT', 'EXTRACT', 'SCALE']);
  });

  it('collects what one role owes, late work first', () => {
    const all = careForAll(bookings, () => HEALTHY, [], APPT + 60);
    const owed = careOwedBy(all, RoleCode.INVENTORY_COORDINATOR);
    expect(owed.length).toBeGreaterThan(0);
    expect(owed.every((t) => t.owner === RoleCode.INVENTORY_COORDINATOR)).toBe(true);
    // Late before on-time, and blocking before advisory within that.
    const firstOnTime = owed.findIndex((t) => !t.late);
    const lastLate = owed.map((t) => t.late).lastIndexOf(true);
    expect(firstOnTime === -1 || firstOnTime > lastLate).toBe(true);
  });

  it('gives a role nothing when nothing is theirs', () => {
    const all = careForAll(bookings, () => HEALTHY, [], APPT);
    expect(careOwedBy(all, RoleCode.HOUSEKEEPING)).toHaveLength(0);
  });

  it('lets one patient’s unknown block one patient, and not the clinic', () => {
    const all = careForAll(bookings,
      (id) => (id === 'bk-2' ? NOTHING_KNOWN : HEALTHY), [], APPT);
    const byId = new Map(all.map((c) => [c.booking.id, c]));
    expect(byId.get('bk-2')!.mayStart).toBe(false);
    expect(byId.get('bk-3')!.unknownFacts).toHaveLength(0);
  });
});
