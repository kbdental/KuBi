/**
 * The equipment engine.
 *
 * The owner: *"Every important asset should have its own digital record…
 * If Next Service Date = Today, the app automatically creates the service
 * task."*
 *
 * Two claims under test. The first is his: the record generates the work, and
 * nobody creates a service task. The second is the one that decides whether
 * this is a register or a safety system — **an asset nobody has ever serviced
 * must not report "no service due"**, which is what the obvious arithmetic
 * produces.
 */
import { describe, it, expect } from 'vitest';
import {
  ClinicEvent, RoleCode, ASSETS, ASSET_BY_TAG, recordFor, equipment,
  assetWorkFor, AssetState, Criticality, UNRATIFIED_REGISTER,
  type ReadinessEvent, type Asset,
} from '@kubi/contracts';

const DAY = 24 * 60;
const days = (n: number) => n * DAY;

/** Day 400 at 09:00, so "180 days ago" is a real minute rather than negative. */
const NOW = days(400) + 9 * 60;

const serviced = (tag: string, cycle: string, at: number): ReadinessEvent =>
  ({ type: ClinicEvent.ASSET_SERVICED, subjectId: `${tag}#${cycle}`, at });

const checked = (tag: string, at: number): ReadinessEvent =>
  ({ type: ClinicEvent.ASSET_CHECKED, subjectId: tag, at });

const failed = (tag: string, at: number): ReadinessEvent =>
  ({ type: ClinicEvent.ASSET_FAILED, subjectId: tag, at });

const restored = (tag: string, at: number): ReadinessEvent =>
  ({ type: ClinicEvent.ASSET_RESTORED, subjectId: tag, at });

const AUTOCLAVE = ASSET_BY_TAG.get('AUTOCLAVE-01')!;
const COMPRESSOR = ASSET_BY_TAG.get('COMPRESSOR-01')!;

/** Every cycle on an asset done today, so only the thing under test is live. */
function allFresh(a: Asset, at = NOW): ReadinessEvent[] {
  return a.cycles.map((c) => serviced(a.tag, c.id, at));
}

/**
 * The same, minus one cycle — for tests that then set that cycle's own date.
 *
 * `lastAt` takes the most recent event, so leaving a fresh one in and adding
 * an older one behind it does nothing at all.
 */
function allFreshBut(a: Asset, cycleId: string, at = NOW): ReadinessEvent[] {
  return a.cycles.filter((c) => c.id !== cycleId).map((c) => serviced(a.tag, c.id, at));
}

/* ═══════════════════════════════════════════════════════════════════════ */

describe('the record generates the work', () => {
  it('creates the service task the day it falls due, and not before', () => {
    const s = COMPRESSOR.cycles.find((c) => c.id === 'SERVICE')!;
    const lastService = NOW - days(s.everyDays);

    const onTheDay = recordFor(COMPRESSOR,
      [...allFreshBut(COMPRESSOR, 'SERVICE'),
        serviced('COMPRESSOR-01', 'SERVICE', lastService)], NOW);
    const task = onTheDay.due.find((t) => t.cycleId === 'SERVICE')!;
    expect(task).toBeDefined();
    expect(task.overdue).toBe(true);
    expect(task.daysLate).toBe(0);
  });

  it('says when the next service is, from the last one and the interval', () => {
    const s = COMPRESSOR.cycles.find((c) => c.id === 'SERVICE')!;
    const last = NOW - days(30);
    const r = recordFor(COMPRESSOR, [serviced('COMPRESSOR-01', 'SERVICE', last)], NOW);
    expect(r.lastServicedAt).toBe(last);
    expect(r.nextServiceAt).toBe(last + days(s.everyDays));
  });

  it('brings the task forward, because a vendor cannot be booked on the day', () => {
    // The owner's rule is the floor, not the ceiling. A service task that
    // first appears on the morning it falls due is a task that is already
    // late — what fires *on* the day is the overdue state, which is louder.
    const s = COMPRESSOR.cycles.find((c) => c.id === 'SERVICE')!;
    const last = NOW - days(s.everyDays - s.warnAheadDays);
    const r = recordFor(COMPRESSOR,
      [...allFreshBut(COMPRESSOR, 'SERVICE'), serviced('COMPRESSOR-01', 'SERVICE', last)], NOW);
    const task = r.due.find((t) => t.cycleId === 'SERVICE')!;
    expect(task).toBeDefined();
    expect(task.overdue).toBe(false);
  });

  it('runs every clock on an asset separately', () => {
    // An autoclave has four: the service, the weekly spore test, the annual
    // validation and the gasket. They are not one date and cannot be.
    const events = [
      serviced('AUTOCLAVE-01', 'SERVICE', NOW - days(10)),
      serviced('AUTOCLAVE-01', 'SPORE', NOW - days(9)),
      serviced('AUTOCLAVE-01', 'VALIDATION', NOW - days(10)),
      serviced('AUTOCLAVE-01', 'GASKET', NOW - days(10)),
    ];
    const r = recordFor(AUTOCLAVE, events, NOW);
    expect(r.due.map((t) => t.cycleId)).toEqual(['SPORE']);
    expect(r.due[0]!.overdue).toBe(true);
    expect(r.due[0]!.daysLate).toBe(2);
  });

  it('collects the whole register’s work, blocking and overdue first', () => {
    const v = equipment(ASSETS, [], NOW);
    expect(v.tasks.length).toBeGreaterThan(0);
    const firstNonBlocking = v.tasks.findIndex((t) => !t.blocks);
    const lastBlocking = v.tasks.map((t) => t.blocks).lastIndexOf(true);
    expect(firstNonBlocking === -1 || firstNonBlocking > lastBlocking).toBe(true);
  });

  it('gives one role its own list', () => {
    const v = equipment(ASSETS, [], NOW);
    const ster = assetWorkFor(v, RoleCode.STERILIZATION_TECHNICIAN);
    expect(ster.length).toBeGreaterThan(0);
    expect(ster.every((t) => t.owner === RoleCode.STERILIZATION_TECHNICIAN)).toBe(true);
    expect(ster.some((t) => t.assetTag === 'AUTOCLAVE-01')).toBe(true);
  });
});

describe('an asset nobody has serviced is not an asset with nothing due', () => {
  /**
   * The tempting implementation is `next = last + period`, and when `last` is
   * unknown that quietly produces nothing — so a machine nobody has ever
   * serviced reports **no service due**, which is the exact opposite of the
   * truth. This is constitution rule 1 applied to a compressor.
   */
  it('reports UNSERVICED rather than operational', () => {
    const r = recordFor(COMPRESSOR, [], NOW);
    expect(r.state).toBe(AssetState.UNSERVICED);
    expect(r.nextServiceAt).toBeNull();
  });

  it('still generates the task, with no date rather than no task', () => {
    const r = recordFor(COMPRESSOR, [], NOW);
    const task = r.due.find((t) => t.cycleId === 'SERVICE')!;
    expect(task).toBeDefined();
    expect(task.dueAt).toBeNull();
    expect(task.overdue).toBe(true);
    expect(task.because).toContain('no record of it ever having been done');
  });

  it('says so in the headline, rather than "in service"', () => {
    expect(recordFor(COMPRESSOR, [], NOW).headline)
      .toContain('never been recorded');
  });

  it('ranks it above merely overdue, because it is a bigger hole', () => {
    const neverDone = recordFor(COMPRESSOR, [], NOW);
    const overdue = recordFor(COMPRESSOR,
      [...allFreshBut(COMPRESSOR, 'SERVICE'),
        serviced('COMPRESSOR-01', 'SERVICE', NOW - days(400))], NOW);
    expect(neverDone.state).toBe(AssetState.UNSERVICED);
    expect(overdue.state).toBe(AssetState.OVERDUE);
  });

  it('names it as an unknown, not as a default', () => {
    const r = recordFor(COMPRESSOR, [], NOW);
    expect(r.unknowns.some((u) => u.includes('never been recorded'))).toBe(true);
  });

  it('counts them across the register', () => {
    const v = equipment(ASSETS, [], NOW);
    expect(v.unserviced.length).toBe(ASSETS.length);
  });
});

describe('breakdown and downtime', () => {
  it('is down from the failure until somebody says it is back', () => {
    const r = recordFor(COMPRESSOR,
      [...allFresh(COMPRESSOR), failed('COMPRESSOR-01', NOW - 180)], NOW);
    expect(r.state).toBe(AssetState.DOWN);
    expect(r.downSince).toBe(NOW - 180);
    expect(r.headline).toBe('Out of service for 3 hours');
  });

  it('counts an open failure up to now, and a closed one to its repair', () => {
    const events = [
      ...allFresh(COMPRESSOR),
      failed('COMPRESSOR-01', NOW - days(10)),
      restored('COMPRESSOR-01', NOW - days(10) + 240),   // four hours
      failed('COMPRESSOR-01', NOW - 60),                 // still open
    ];
    const r = recordFor(COMPRESSOR, events, NOW);
    expect(r.breakdowns).toBe(2);
    expect(r.downtimeMinutes).toBe(240 + 60);
    expect(r.state).toBe(AssetState.DOWN);
  });

  it('comes back into service when it is restored', () => {
    const events = [
      ...allFresh(COMPRESSOR),
      failed('COMPRESSOR-01', NOW - 300),
      restored('COMPRESSOR-01', NOW - 60),
    ];
    const r = recordFor(COMPRESSOR, events, NOW);
    expect(r.state).toBe(AssetState.OPERATIONAL);
    expect(r.downSince).toBeNull();
    expect(r.downtimeMinutes).toBe(240);
  });

  it('totals downtime across the register', () => {
    const events = [
      ...ASSETS.flatMap((a) => allFresh(a)),
      failed('COMPRESSOR-01', NOW - 120), restored('COMPRESSOR-01', NOW - 60),
      failed('AUTOCLAVE-01', NOW - 90), restored('AUTOCLAVE-01', NOW - 30),
    ];
    expect(equipment(ASSETS, events, NOW).downtimeMinutes).toBe(60 + 60);
  });
});

describe('the daily check', () => {
  it('is owed once a day, and not twice', () => {
    const today = recordFor(AUTOCLAVE,
      [...allFresh(AUTOCLAVE), checked('AUTOCLAVE-01', NOW - 60)], NOW);
    expect(today.checkDue).toBe(false);
  });

  it('comes round again the next morning', () => {
    const r = recordFor(AUTOCLAVE,
      [...allFresh(AUTOCLAVE), checked('AUTOCLAVE-01', NOW - days(1))], NOW);
    expect(r.checkDue).toBe(true);
  });

  it('is not asked of an asset that has no daily check', () => {
    const fire = ASSET_BY_TAG.get('FIRE-01')!;
    expect(fire.dailyCheck).toBeNull();
    expect(recordFor(fire, [], NOW).checkDue).toBe(false);
  });

  it('gives every daily check a pass test, not just an instruction', () => {
    // "Switch it on" is not a check. A daily check with no pass test is a tick
    // somebody learns to do from the corridor.
    for (const a of ASSETS) {
      if (a.dailyCheck === null) continue;
      expect(a.dailyCheck.length, `${a.tag} has a check with no pass test`)
        .toBeGreaterThan(25);
    }
  });
});

describe('the AMC', () => {
  it('warns before it expires, not after', () => {
    const ac = ASSET_BY_TAG.get('AC-RECEPTION')!;
    const before = recordFor(ac, [], (ac.amc!.until ?? 0) - days(60));
    const warning = recordFor(ac, [], (ac.amc!.until ?? 0) - days(20));
    const after = recordFor(ac, [], (ac.amc!.until ?? 0) + days(1));
    expect(before.amcAction).toBe('OK');
    expect(warning.amcAction).toBe('EXPIRING');
    expect(after.amcAction).toBe('EXPIRED');
  });

  it('will not treat a missing expiry date as no contract', () => {
    // The suction pump has a vendor and no recorded expiry, which is a gap in
    // the register and not the absence of an AMC.
    const suction = ASSET_BY_TAG.get('SUCTION-01')!;
    expect(suction.amc).not.toBeNull();
    expect(suction.amc!.until).toBeNull();
    const r = recordFor(suction, [], NOW);
    expect(r.amcAction).toBe('NO_EXPIRY_RECORDED');
    expect(r.unknowns.some((u) => u.includes('expiry date is not'))).toBe(true);
  });

  it('says NONE where there genuinely is no contract', () => {
    expect(recordFor(ASSET_BY_TAG.get('ULTRASONIC-01')!, [], NOW).amcAction).toBe('NONE');
  });

  it('collects everything needing an AMC decision', () => {
    const v = equipment(ASSETS, [], NOW);
    expect(v.amcAction.map((r) => r.asset.tag)).toContain('SUCTION-01');
  });
});

describe('the register', () => {
  it('gives every asset a tag, an owner role and a place', () => {
    for (const a of ASSETS) {
      expect(a.tag.length, 'an asset has no tag').toBeGreaterThan(2);
      expect(Object.values(RoleCode), a.tag).toContain(a.responsible);
      expect(a.location.length, `${a.tag} has no location`).toBeGreaterThan(2);
    }
  });

  it('never gives two assets the same tag', () => {
    expect(ASSET_BY_TAG.size).toBe(ASSETS.length);
  });

  it('holds a responsible ROLE and never a person’s name', () => {
    // The owner's list says "responsible person"; it is stored as a role on
    // his own instruction, so the record survives the person leaving.
    const roles: string[] = Object.values(RoleCode);
    for (const a of ASSETS) expect(roles).toContain(a.responsible as string);
  });

  it('gives every cycle a reason somebody could act on', () => {
    for (const a of ASSETS) {
      for (const c of a.cycles) {
        expect(c.because.length, `${a.tag}/${c.id} has no reason`).toBeGreaterThan(25);
        expect(c.everyDays, `${a.tag}/${c.id} has no interval`).toBeGreaterThan(0);
      }
    }
  });

  it('warns ahead on everything that needs a vendor, a booking or a part', () => {
    // Zero warning is legitimate for a daily wipe-down and nothing else. A
    // yearly or half-yearly cycle with no warning is a task that appears too
    // late to act on.
    for (const a of ASSETS) {
      for (const c of a.cycles) {
        if (c.everyDays < 7) continue;
        expect(c.warnAheadDays, `${a.tag}/${c.id} gives no notice`).toBeGreaterThan(0);
      }
    }
  });

  it('covers the two morning gaps the opening procedure had no home for', () => {
    // OPEN-010, the water pump, and OPEN-012, emergency readiness. Neither
    // had a block in the morning and neither needed one — they are assets,
    // and an asset register is where a daily check and an expiry date live.
    const pump = ASSET_BY_TAG.get('PUMP-01')!;
    expect(pump.dailyCheck).toContain('Started at opening');
    expect(pump.responsible).toBe(RoleCode.HOUSEKEEPING);

    const kit = ASSET_BY_TAG.get('EMERGENCY-01')!;
    expect(kit.cycles.map((c) => c.id)).toContain('EXPIRY');
    expect(kit.criticality).toBe(Criticality.STOPS_CLINIC);
    expect(ASSET_BY_TAG.get('OXYGEN-01')).toBeDefined();
  });

  it('blocks on the statutory cycles, and not on the housekeeping ones', () => {
    // An X-ray on a lapsed AERB licence is operating illegally; a dirty AC
    // filter is not. The difference has to be in the data.
    const xray = ASSET_BY_TAG.get('XRAY-01')!;
    expect(xray.cycles.find((c) => c.id === 'AERB')!.blocks).toBe(true);
    const ac = ASSET_BY_TAG.get('AC-RECEPTION')!;
    expect(ac.cycles.find((c) => c.id === 'CLEAN')!.blocks).toBe(false);
  });

  it('knows which failures stop the clinic and which stop one room', () => {
    expect(AUTOCLAVE.criticality).toBe(Criticality.STOPS_CLINIC);
    expect(COMPRESSOR.criticality).toBe(Criticality.STOPS_CLINIC);
    expect(ASSET_BY_TAG.get('CHAIR-01')!.criticality).toBe(Criticality.STOPS_WORK);
    expect(ASSET_BY_TAG.get('AC-RECEPTION')!.criticality).toBe(Criticality.DEGRADES);
  });

  it('names the gaps in the record itself, rather than filling them in', () => {
    const r = recordFor(ASSET_BY_TAG.get('SCALER-01')!, allFresh(ASSET_BY_TAG.get('SCALER-01')!), NOW);
    expect(r.unknowns).toContain('No documents held against this asset');
    expect(r.unknowns).toContain('No commissioning date recorded');
  });

  it('tells three states apart that a checklist would show as one', () => {
    // No service interval at all, an interval nobody has ever met, and one
    // that has lapsed. A curing light has a monthly radiometer reading and no
    // service contract; reporting it as "never serviced" reads as neglect
    // rather than as a machine that does not need servicing.
    const cure = ASSET_BY_TAG.get('CURE-01')!;
    expect(cure.cycles.some((c) => c.id === 'SERVICE')).toBe(false);
    expect(recordFor(cure, allFresh(cure), NOW).hasServiceCycle).toBe(false);

    const never = recordFor(COMPRESSOR, [], NOW);
    expect(never.hasServiceCycle).toBe(true);
    expect(never.lastServicedAt).toBeNull();

    const lapsed = recordFor(COMPRESSOR,
      [...allFreshBut(COMPRESSOR, 'SERVICE'),
        serviced('COMPRESSOR-01', 'SERVICE', NOW - days(400))], NOW);
    expect(lapsed.hasServiceCycle).toBe(true);
    expect(lapsed.lastServicedAt).not.toBeNull();
  });

  it('says out loud that it is not the clinic’s real list', () => {
    // Same reason as the treatment catalogue: a made-up serial number must
    // not pass as the clinic's own. It becomes false when their list is in.
    expect(UNRATIFIED_REGISTER).toBe(true);
  });
});

describe('the whole register, on a working morning', () => {
  /** Everything serviced and checked, except the things under test. */
  const worked = (): ReadinessEvent[] => [
    ...ASSETS.flatMap((a) => allFresh(a, NOW - days(1))),
    ...ASSETS.map((a) => checked(a.tag, NOW - 30)),
  ];

  it('reports a quiet register as quiet', () => {
    const v = equipment(ASSETS, worked(), NOW);
    expect(v.down).toHaveLength(0);
    expect(v.unserviced).toHaveLength(0);
    expect(v.checksDue).toHaveLength(0);
  });

  it('surfaces the one thing that went wrong, and only that', () => {
    const v = equipment(ASSETS, [...worked(), failed('AUTOCLAVE-01', NOW - 120)], NOW);
    expect(v.down.map((r) => r.asset.tag)).toEqual(['AUTOCLAVE-01']);
    expect(v.down[0]!.asset.criticality).toBe(Criticality.STOPS_CLINIC);
  });

  it('marks an asset unusable when a blocking cycle goes overdue', () => {
    // A week without a spore test means nothing since the last one has been
    // proven sterile, which is not a paperwork problem.
    const events = worked().filter((e) => e.subjectId !== 'AUTOCLAVE-01#SPORE');
    events.push(serviced('AUTOCLAVE-01', 'SPORE', NOW - days(9)));
    const v = equipment(ASSETS, events, NOW);
    expect(v.unusable.map((r) => r.asset.tag)).toContain('AUTOCLAVE-01');
  });
});
