/**
 * What is failing, who is involved, and who is allowed to see it.
 *
 * Two requests from the owner, which turned out to be one problem:
 *
 *   *"I want this as an operational app where on the dashboard I see the
 *   attendance, the clinic readiness health with the failing parameters and
 *   who is involved in the failing parameters."*
 *
 *   *"All the task should not be seen by all, only related, so that confusion
 *   does not happen — so all the staff will have a different look of the app."*
 *
 * The tests below are in that order: first that the failures are gathered from
 * every engine and carry their people, then that each role is shown its own
 * share and told honestly how much it is not being shown.
 */
import { describe, it, expect } from 'vitest';
import {
  RoleCode, AttendanceState,
  FailureArea, FailureSeverity, CLINIC_WIDE_ROLES,
  actsFor, lensFor, involvedIn, involvedWords, gatherFailures, holdersFrom,
  seesWholeClinic, placesFor, mayOpen, Place,
  type FailingParameter, type Involved, type AttendanceView,
} from '@kubi/contracts';

const NOW = 9 * 60 + 15;

const person = (
  employeeCode: string, label: string, state = AttendanceState.PRESENT,
  note = 'In at 08:50.',
): Involved => ({ employeeCode, label, state, note });

const fail = (over: Partial<FailingParameter> = {}): FailingParameter => ({
  id: 'X', area: FailureArea.READINESS, severity: FailureSeverity.HOLDS,
  what: 'Something', because: 'Reasons', ownerRole: RoleCode.DENTAL_ASSISTANT,
  involved: [], dueAt: null, goes: 'Clinic readiness', ...over,
});

/* ═══════════════════════════════════════════════════════════════════════ */

describe('who may act on what', () => {
  it('gives the whole clinic to the four roles that run it, and to nobody else', () => {
    for (const r of CLINIC_WIDE_ROLES) expect(seesWholeClinic(r)).toBe(true);
    for (const r of [RoleCode.DENTAL_ASSISTANT, RoleCode.HOUSEKEEPING,
      RoleCode.TREATING_DOCTOR, RoleCode.RECEPTION]) {
      expect(seesWholeClinic(r), `${r} should see their own work`).toBe(false);
    }
  });

  it('lets a senior assistant act for an assistant, and not the reverse', () => {
    // She may do the work and is accountable for it. It does not run back the
    // other way: the equipment round is the senior's alone.
    expect(actsFor(RoleCode.SENIOR_ASSISTANT, RoleCode.DENTAL_ASSISTANT)).toBe(true);
    expect(actsFor(RoleCode.DENTAL_ASSISTANT, RoleCode.SENIOR_ASSISTANT)).toBe(false);
  });

  it('gives an unowned failure to the people who run the clinic', () => {
    // A failure nobody owns is the worst kind. It must land somewhere, and
    // the somewhere is the manager rather than everybody or nobody.
    expect(actsFor(RoleCode.CLINIC_MANAGER, null)).toBe(true);
    expect(actsFor(RoleCode.HOUSEKEEPING, null)).toBe(false);
  });
});

describe('each role gets a different app', () => {
  const all: FailingParameter[] = [
    fail({ id: 'a', ownerRole: RoleCode.HOUSEKEEPING, severity: FailureSeverity.WATCH }),
    fail({ id: 'b', ownerRole: RoleCode.DENTAL_ASSISTANT, severity: FailureSeverity.STOPS }),
    fail({ id: 'c', ownerRole: RoleCode.DENTAL_ASSISTANT, severity: FailureSeverity.HOLDS }),
    fail({ id: 'd', ownerRole: RoleCode.STERILIZATION_TECHNICIAN }),
    fail({ id: 'e', ownerRole: null }),
  ];

  it('shows the manager everything', () => {
    const l = lensFor(RoleCode.CLINIC_MANAGER, all);
    expect(l.failing).toHaveLength(5);
    expect(l.hidden).toBe(0);
    expect(l.wholeClinic).toBe(true);
  });

  it('shows the housekeeper one thing, not five', () => {
    // *"So that confusion does not happen."* A housekeeper who scrolls past
    // an implant component shortage learns to scroll past everything.
    const l = lensFor(RoleCode.HOUSEKEEPING, all);
    expect(l.failing.map((f) => f.id)).toEqual(['a']);
  });

  it('tells her how many were withheld, rather than quietly showing a short list', () => {
    // "1 of 5" is a person who knows the clinic has other problems and that
    // they are not hers. "1" is a person who thinks she is seeing everything.
    const l = lensFor(RoleCode.HOUSEKEEPING, all);
    expect(l.hidden).toBe(4);
  });

  it('gives the senior assistant the assistants’ work as well as her own', () => {
    const l = lensFor(RoleCode.SENIOR_ASSISTANT, all);
    expect(l.failing.map((f) => f.id).sort()).toEqual(['b', 'c']);
  });

  it('puts what stops work first, whoever is looking', () => {
    expect(lensFor(RoleCode.CLINIC_MANAGER, all).failing[0]!.severity)
      .toBe(FailureSeverity.STOPS);
    expect(lensFor(RoleCode.DENTAL_ASSISTANT, all).failing[0]!.id).toBe('b');
  });

  it('asks each role its own question', () => {
    expect(lensFor(RoleCode.CLINIC_MANAGER, all).question)
      .toBe('What is failing, and who is on it?');
    expect(lensFor(RoleCode.HOUSEKEEPING, all).question).toBe('What is mine, and by when?');
    // A role nobody wrote a question for still gets a sensible one rather
    // than an empty heading.
    expect(lensFor(RoleCode.SYSTEM_ADMINISTRATOR, all).question).toBeTruthy();
  });

  it('does not tell somebody with nothing outstanding that the clinic is fine', () => {
    // The distinction the design principle turns on. Her list being empty is
    // not the same statement as the clinic being well.
    const l = lensFor(RoleCode.LAB_COORDINATOR, all);
    expect(l.failing).toHaveLength(0);
    expect(l.headline).toBe('Nothing outstanding for you.');
    expect(l.hidden).toBe(5);
  });

  it('says the clinic is clear only when it actually is', () => {
    expect(lensFor(RoleCode.CLINIC_MANAGER, []).headline).toBe('Nothing is failing.');
  });
});

describe('who is involved', () => {
  const holders = new Map<RoleCode, readonly Involved[]>([
    [RoleCode.DENTAL_ASSISTANT, [person('e1', 'Priya'), person('e2', 'Meera',
      AttendanceState.LATE_UNEXPLAINED, 'In at 10:05, 65 minutes after their 09:00')]],
    [RoleCode.STERILIZATION_TECHNICIAN, []],
  ]);

  it('names the people holding the role, because a role cannot answer a phone', () => {
    // The rule names the role, always. The dashboard names whoever is holding
    // it today — a manager told "the sterilisation run has no owner" cannot
    // act; one told "Rahul is on leave and nobody is covering" picks up a phone.
    const who = involvedIn(RoleCode.DENTAL_ASSISTANT, holders);
    expect(who.map((p) => p.label)).toEqual(['Priya', 'Meera']);
    expect(involvedWords(who)).toContain('Meera — In at 10:05');
  });

  it('says nobody is holding it rather than rendering a blank', () => {
    expect(involvedIn(RoleCode.STERILIZATION_TECHNICIAN, holders)).toEqual([]);
    expect(involvedWords([])).toBe('Nobody is holding this role today.');
  });

  it('has nobody to name when nothing owns the failure', () => {
    expect(involvedIn(null, holders)).toEqual([]);
  });

  it('keeps people who are absent, so their absence can be the answer', () => {
    // A map built only from the people in the building can never say
    // "nobody, she is on leave" — which is the sentence a manager needs.
    const a = {
      people: [
        { employeeCode: 'e5', label: 'Rahul', roles: [RoleCode.STERILIZATION_TECHNICIAN],
          state: AttendanceState.ON_LEAVE, headline: 'On approved leave.' },
      ],
    } as unknown as AttendanceView;
    const map = holdersFrom(a);
    expect(map.get(RoleCode.STERILIZATION_TECHNICIAN)).toEqual([
      { employeeCode: 'e5', label: 'Rahul', state: 'ON_LEAVE', note: 'On approved leave.' },
    ]);
  });
});

describe('gathering every engine into one list', () => {
  const holders = new Map<RoleCode, readonly Involved[]>([
    [RoleCode.HOUSEKEEPING, [person('e4', 'Sunita')]],
    [RoleCode.CLINIC_MANAGER, [person('e9', 'Rahul M')]],
  ]);

  it('contributes nothing for an engine it has no data from', () => {
    // A screen loaded before the stock import must not show an all-clear it
    // has not earned. Absent input is absent, never a pass.
    expect(gatherFailures({ now: NOW }, holders)).toEqual([]);
  });

  it('turns an empty position into the loudest row on the list', () => {
    const a = {
      gaps: [{
        role: RoleCode.HOUSEKEEPING, critical: true, neededBy: 9 * 60 + 10,
        owns: 'floors, pantry and washroom — 45 minutes',
        because: '0 of 1 here — nobody is holding the floors.',
      }],
      unaccounted: [], lateUnexplained: [], uncovered: [],
    } as unknown as AttendanceView;

    const [row] = gatherFailures({ attendance: a, now: NOW }, holders);
    expect(row!.severity).toBe(FailureSeverity.STOPS);
    expect(row!.area).toBe(FailureArea.ATTENDANCE);
    expect(row!.what).toContain('floors');
    expect(row!.involved.map((p) => p.label)).toEqual(['Sunita']);
    expect(row!.goes).toBe('Clinic readiness → Staffing');
  });

  it('reports one row per stuck booking, named by its worst gate', () => {
    // A manager does not want eleven rows for one implant. They want to know
    // the implant is stuck, and on what.
    const c = {
      bookingId: 'b1', treatmentName: 'Implant placement', patientLabel: 'Patient A',
      ready: false, breaches: [], headline: 'IMPLANT COMPONENT UNAVAILABLE.',
      missing: [
        { owner: RoleCode.INVENTORY_COORDINATOR, dueAt: 9 * 60 },
        { owner: RoleCode.TREATING_DOCTOR, dueAt: 9 * 60 + 30 },
      ],
    };
    const rows = gatherFailures({ compliance: [c] as never, now: NOW }, holders);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.what).toBe('Patient A — Implant placement is not ready');
    expect(rows[0]!.because).toBe('IMPLANT COMPONENT UNAVAILABLE.');
    expect(rows[0]!.ownerRole).toBe(RoleCode.INVENTORY_COORDINATOR);
  });

  it('reports a breach as its own row, and does not also chase it as a gate', () => {
    // It already happened. It is on the list because the manager must know,
    // not because anybody can still prevent it.
    const c = {
      bookingId: 'b2', treatmentName: 'Extraction', patientLabel: 'Patient B',
      ready: false, deliveredAt: 8 * 60 + 30, headline: 'x', missing: [{ owner: null }],
      breaches: [{ gateId: 'CONSENT' }],
    };
    const rows = gatherFailures({ compliance: [c] as never, now: NOW }, holders);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.what).toContain('delivered with 1 requirement unmet');
    expect(rows[0]!.because).toContain('does not clear it');
    expect(rows[0]!.ownerRole).toBe(RoleCode.QUALITY_COMPLIANCE);
  });

  it('says nothing about a booking that is ready', () => {
    const c = { bookingId: 'b3', ready: true, breaches: [], missing: [] };
    expect(gatherFailures({ compliance: [c] as never, now: NOW }, holders)).toEqual([]);
  });

  it('keeps advisory work out of what is stopping the clinic opening', () => {
    // *"As per requirement"* is real work and does not hold the door. Two
    // different numbers, and they must never become one.
    const r = {
      outstanding: [{ id: 'STERILE', label: 'Sterile stock released',
        owner: RoleCode.STERILIZATION_TECHNICIAN, ifOutstanding: 'No released batch.' }],
      advisory: [{ id: 'STOCK', label: 'Consumables checked', done: false,
        owner: RoleCode.INVENTORY_COORDINATOR, ifOutstanding: 'Not checked.' }],
      targetAt: 10 * 60,
    } as never;
    const rows = gatherFailures({ readiness: r, now: NOW }, holders);
    expect(rows.map((x) => x.severity))
      .toEqual([FailureSeverity.STOPS, FailureSeverity.WATCH]);
  });

  it('sorts an unowned failure above one somebody is standing next to', () => {
    // Same severity, same area, and the difference is whether anybody will
    // pick it up. The one with nobody on it is still here at six o'clock.
    const eq = {
      down: [], unserviced: [], checksDue: [], amcAction: [], records: [],
      downtimeMinutes: 0,
      unusable: [
        { asset: { tag: 'CHAIR-01', name: 'Chair 1', criticality: 'STOPS_CLINIC',
          responsible: RoleCode.CLINIC_MANAGER },
          due: [{ blocks: true, overdue: true, owner: RoleCode.CLINIC_MANAGER,
            because: 'Service overdue.', dueAt: 8 * 60 }] },
        { asset: { tag: 'AUTOCLAVE-01', name: 'Autoclave', criticality: 'STOPS_CLINIC',
          responsible: RoleCode.LAB_COORDINATOR },
          due: [{ blocks: true, overdue: true, owner: RoleCode.LAB_COORDINATOR,
            because: 'Validation overdue.', dueAt: 9 * 60 }] },
      ],
      tasks: [],
    } as never;

    const rows = gatherFailures({ equipment: eq, now: NOW }, holders);
    // The chair is due earlier. The autoclave still comes first, because
    // nobody holds LAB_COORDINATOR and the chair has Rahul M on it.
    expect(rows[0]!.id).toBe('EQ:UNUSABLE:AUTOCLAVE-01');
    expect(rows[0]!.involved).toEqual([]);
  });

  it('reads the clinic in the order the questions arrive, not by oldest date', () => {
    // Learned the hard way: sorting straight to the due time put a service
    // overdue by twenty-nine days above the sterilisation technician who was
    // not in the building. An old overdue date is history, not urgency.
    const eq = {
      down: [], unserviced: [], checksDue: [], amcAction: [], records: [],
      downtimeMinutes: 0, tasks: [],
      unusable: [{
        asset: { tag: 'SERVER-01', name: 'Practice computer',
          criticality: 'STOPS_CLINIC', responsible: RoleCode.CLINIC_MANAGER },
        due: [{ blocks: true, overdue: true, owner: RoleCode.CLINIC_MANAGER,
          because: 'Backup unverified for 29 days.', dueAt: -42645 }],
      }],
    } as never;
    const a = {
      gaps: [{ role: RoleCode.STERILIZATION_TECHNICIAN, critical: true,
        neededBy: 8 * 60 + 45, owns: 'the morning sterilisation run',
        because: '0 of 1 here.' }],
      unaccounted: [], lateUnexplained: [], uncovered: [],
    } as unknown as AttendanceView;

    const rows = gatherFailures({ equipment: eq, attendance: a, now: NOW }, holders);
    expect(rows[0]!.area).toBe(FailureArea.ATTENDANCE);
    expect(rows[1]!.area).toBe(FailureArea.EQUIPMENT);
  });

  it('grades an asset by what its failure actually stops', () => {
    // The register already knows. A blanket STOPS would have put a curing
    // light above an empty autoclave — both "down", and only one of them is
    // why the clinic cannot open.
    const eq = {
      down: [
        { asset: { tag: 'LIGHT-01', name: 'Curing light', criticality: 'DEGRADES',
          responsible: RoleCode.DENTAL_ASSISTANT } },
        { asset: { tag: 'COMP-01', name: 'Air compressor', criticality: 'STOPS_CLINIC',
          responsible: RoleCode.CLINIC_MANAGER } },
      ],
      unusable: [], unserviced: [], checksDue: [], amcAction: [], records: [],
      downtimeMinutes: 0, tasks: [],
    } as never;
    const rows = gatherFailures({ equipment: eq, now: NOW }, holders);
    expect(rows[0]!.what).toBe('Air compressor is down');
    expect(rows[0]!.severity).toBe(FailureSeverity.STOPS);
    expect(rows[1]!.severity).toBe(FailureSeverity.WATCH);
    // And it goes to whoever the register makes responsible, not to a queue.
    expect(rows[1]!.ownerRole).toBe(RoleCode.DENTAL_ASSISTANT);
  });

  it('leaves the evening alone until the clinic has actually shut', () => {
    // Closing blocks outstanding at 09:15 are not failures. They are the
    // evening, and it has not happened yet.
    const cl = {
      closingNow: false, shutAt: 18 * 60 + 30,
      outstanding: [{ id: 'X', label: 'Instruments cycled', critical: true,
        owner: RoleCode.STERILIZATION_TECHNICIAN, ifOutstanding: 'Not done.' }],
    } as never;
    expect(gatherFailures({ closing: cl, now: NOW }, holders)).toEqual([]);
    expect(gatherFailures({ closing: { ...(cl as object), closingNow: true } as never,
      now: 18 * 60 + 45 }, holders)).toHaveLength(1);
  });

  it('separates never-counted stock from out-of-stock', () => {
    // "We have none" and "we do not know" are different sentences, and only
    // one of them is answered by placing an order.
    const inv = {
      out: [{ item: { sku: 'GLOVE-M', name: 'Gloves, medium' }, headline: 'None on the shelf.' }],
      uncounted: [{ item: { sku: 'BUR-01', name: 'Diamond burs' } }],
      reorder: [], stopping: [], positions: [], low: [], expiring: [], gateStock: {},
    } as never;
    const rows = gatherFailures({ inventory: inv, now: NOW }, holders);
    expect(rows.map((x) => x.what)).toEqual([
      'Gloves, medium is out of stock',
      'Diamond burs has never been counted',
    ]);
    expect(rows[1]!.because).toContain('does not know how many');
  });
});

describe('a different look, not a smaller one', () => {
  it('gives the housekeeper three places, and none of them is the implant register', () => {
    // *"So that confusion does not happen."* A rail offering her the patient
    // event engine would be telling her she had missed something.
    expect(placesFor([RoleCode.HOUSEKEEPING]))
      .toEqual(['DASHBOARD', 'READINESS', 'CLOSING']);
  });

  it('gives the doctor patients and nothing about the building', () => {
    expect(placesFor([RoleCode.TREATING_DOCTOR]))
      .toEqual(['DASHBOARD', 'PATIENT_EVENTS']);
  });

  it('keeps the dashboard for everybody', () => {
    // Everybody is entitled to know where the clinic is. What changes is
    // what is on it, which is the lens's job rather than the rail's.
    for (const r of Object.values(RoleCode)) {
      expect(placesFor([r as RoleCode]), `${r}`).toContain('DASHBOARD');
    }
  });

  it('does not put the More drawer on an assistant’s rail', () => {
    // Thirty screens built for other people's work is the confusion itself.
    expect(placesFor([RoleCode.DENTAL_ASSISTANT])).not.toContain('MORE');
    expect(placesFor([RoleCode.CLINIC_MANAGER])).toContain('MORE');
  });

  it('gives the equipment round to the senior assistant and not to the assistants', () => {
    // Nobody else may report it, so nobody else is offered the place.
    expect(placesFor([RoleCode.SENIOR_ASSISTANT])).toContain('EQUIPMENT');
    expect(placesFor([RoleCode.DENTAL_ASSISTANT])).not.toContain('EQUIPMENT');
  });

  it('unions the rails of somebody who holds two jobs', () => {
    const both = placesFor([RoleCode.SENIOR_ASSISTANT, RoleCode.INVENTORY_COORDINATOR]);
    expect(both).toContain('EQUIPMENT');
    expect(both).toContain('PATIENT_EVENTS');
  });

  it('gives an unknown role the dashboard alone rather than everything', () => {
    // Guessing wide is the one case where a missing rule becomes a leak.
    expect(placesFor([RoleCode.SYSTEM_ADMINISTRATOR])).toEqual(['DASHBOARD']);
  });

  it('keeps the rail in one order, whoever is looking', () => {
    // Muscle memory is worth more than tailoring. Readiness is always left
    // of closing, for the manager and for the housekeeper alike.
    const mgr = placesFor([RoleCode.CLINIC_MANAGER]);
    const hk = placesFor([RoleCode.HOUSEKEEPING]);
    expect(hk).toEqual(mgr.filter((p) => hk.includes(p)));
  });

  it('answers whether a place may be opened, not only what to draw', () => {
    // Rule 3: the rail is a courtesy. The check is what enforces it.
    expect(mayOpen([RoleCode.HOUSEKEEPING], Place.EQUIPMENT)).toBe(false);
    expect(mayOpen([RoleCode.HOUSEKEEPING], Place.READINESS)).toBe(true);
  });
});
