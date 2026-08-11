/**
 * HK-001 to HK-014 — cleanliness, and the overlap it exposed.
 *
 * The owner: *"I would like to have a clean picture of the clinic readiness
 * module with no confusion and overlap… there should be clean demarcation of
 * who is doing what so that the dashboard shows a proper percentage of clinic
 * readiness."*
 *
 * That instruction arrived with this matrix, and the two are connected: this
 * matrix is where the overlap came from. HK-001 gives the treatment room to
 * housekeeping; the opening procedure's §2.1 gives it to the assistant. The
 * first block of tests is about not counting that room twice.
 */
import { describe, it, expect } from 'vitest';
import {
  RoleCode, ClinicEvent,
  HYGIENE_CONTROLS, HYGIENE_BY_ID, HK_OVERLAPS, OPEN_OVERLAPS,
  HYGIENE_QUESTIONS, HYGIENE_SHEET_COLUMNS,
  ControlPriority, HygieneArea, HygieneTrigger, HygieneState,
  gatesOpening, housekeeping, readiness,
  type HygieneReport, type HygieneCheck, type Operatory, type ReadinessEvent,
} from '@kubi/contracts';

const NOW = 9 * 60 + 15;
const OPENED = 8 * 60 + 30;
const ROOMS: Operatory[] = [1, 2].map((i) => ({
  id: `op-${i}`, label: `Operatory ${i}`, position: i,
}));

const report = (
  controlId: string, over: Partial<HygieneReport> = {},
): HygieneReport => ({
  controlId, at: 8 * 60 + 50, byEmployeeCode: 'e4', subjectId: null,
  defectFound: null, note: null, ...over,
});

const checked = (
  controlId: string, over: Partial<HygieneCheck> = {},
): HygieneCheck => ({
  controlId, at: 9 * 60, byEmployeeCode: 'e1', byRole: RoleCode.DENTAL_ASSISTANT,
  passed: true, note: null, ...over,
});

const view = (
  reports: HygieneReport[] = [], checks: HygieneCheck[] = [],
  turnoverDue: string[] = [],
) => housekeeping(HYGIENE_CONTROLS, reports, checks, OPENED, turnoverDue, NOW);

/** Everything reported, and every named checker satisfied. */
const allDone = () => view(
  HYGIENE_CONTROLS.map((c) => report(c.id)),
  HYGIENE_CONTROLS.filter((c) => c.checker !== null).map((c) => checked(c.id)),
  HYGIENE_CONTROLS.filter((c) => c.trigger === HygieneTrigger.TURNOVER).map((c) => c.id),
);

/* ═══════════════════════════════════════════════════════════════════════ */

describe('no confusion and no overlap', () => {
  it('never lets one control claim two readiness blocks', () => {
    // The anti-double-counting rule, as a test rather than as care. A control
    // naming two blocks is the overlap coming back.
    for (const c of HYGIENE_CONTROLS) {
      expect(typeof (c.opensAs ?? ''), `${c.id}`).toBe('string');
    }
    const claimed = HYGIENE_CONTROLS.map((c) => c.opensAs).filter(Boolean);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('never lets two controls claim the same block', () => {
    // The other direction, and the one that would quietly halve a percentage.
    const claimed = HYGIENE_CONTROLS.map((c) => c.opensAs).filter(Boolean) as string[];
    expect(claimed.sort()).toEqual(['HK_ROOMS', 'WASHROOM_STOCK']);
  });

  it('points every claimed block at one that actually exists', () => {
    const ids = new Set(readiness([], ROOMS, 10 * 60, NOW).blocks.map((b) => b.id));
    for (const c of HYGIENE_CONTROLS) {
      if (c.opensAs === null) continue;
      expect(ids, `${c.id} claims "${c.opensAs}", which is not a block`)
        .toContain(c.opensAs);
    }
  });

  it('splits the treatment room in two rather than giving it to one role', () => {
    // The demarcation, and it is the matrix's own: HK-001 names the assistant
    // as *Checker* of housekeeping's work, which is the handover written down.
    // Housekeeping cleans; the assistant disinfects and sets up.
    const blocks = readiness([], ROOMS, 10 * 60, NOW).blocks;
    expect(blocks.find((b) => b.id === 'HK_ROOMS')!.owner)
      .toBe(RoleCode.HOUSEKEEPING);
    expect(blocks.find((b) => b.id === 'OPERATORY:op-1')!.owner)
      .toBe(RoleCode.DENTAL_ASSISTANT);
    expect(HYGIENE_BY_ID.get('HK-001')!.checker).toBe(RoleCode.DENTAL_ASSISTANT);
  });

  it('gives the chair no block of its own, because it already has one', () => {
    // HK-002 is one of the owner's twenty-four actions at opening, and a
    // turnover run the opening procedure has no concept of. The same surface
    // may not be two blocks.
    expect(HYGIENE_BY_ID.get('HK-002')!.opensAs).toBeNull();
    expect(HYGIENE_BY_ID.get('HK-002')!.trigger).toBe(HygieneTrigger.TURNOVER);
  });

  it('records every place the two documents touch, resolved or not', () => {
    expect(HK_OVERLAPS.length).toBeGreaterThanOrEqual(5);
    for (const o of HK_OVERLAPS) {
      expect(o.taken.length, `${o.hk} says nothing about what KuBi did`)
        .toBeGreaterThan(40);
    }
  });

  it('leaves reception unsettled rather than picking a role', () => {
    // HK-013 names "HK/Reception" for an area that already has a block owned
    // by reception. Constitution rule 4: naming it beats guessing it, and
    // "either of you" is how a job ends up belonging to nobody.
    expect(OPEN_OVERLAPS.map((o) => o.hk)).toEqual(['HK-013']);
    expect(HYGIENE_BY_ID.get('HK-013')!.opensAs).toBeNull();
    expect(HYGIENE_BY_ID.get('HK-013')!.alsoDoneBy).toBe(RoleCode.RECEPTION);
    expect(HYGIENE_QUESTIONS[0]).toContain('HK-013');
  });

  it('says out loud that "scheduled" has no schedule', () => {
    // Seven of fourteen say "Scheduled" and no schedule exists. KuBi can
    // report that a round happened; it cannot report that one is late.
    expect(HYGIENE_QUESTIONS.join(' ')).toContain('no schedule exists');
  });
});

describe('the matrix’s priority letters do real work', () => {
  it('lets PS and C hold the door, and I and R not', () => {
    expect(gatesOpening(ControlPriority.PS)).toBe(true);
    expect(gatesOpening(ControlPriority.C)).toBe(true);
    expect(gatesOpening(ControlPriority.I)).toBe(false);
    expect(gatesOpening(ControlPriority.R)).toBe(false);
  });

  it('holds the clinic for hand wash and not for toilet paper', () => {
    // The one "available" row carrying a C, and it earns it: hand hygiene is
    // the infection control every other one rests on. Paper is an I.
    expect(HYGIENE_BY_ID.get('HK-010')!.priority).toBe(ControlPriority.C);
    expect(HYGIENE_BY_ID.get('HK-010')!.opensAs).toBe('WASHROOM_STOCK');
    expect(HYGIENE_BY_ID.get('HK-011')!.priority).toBe(ControlPriority.I);
    expect(HYGIENE_BY_ID.get('HK-011')!.opensAs).toBeNull();
  });

  it('does not put the plants in front of anybody at 08:45', () => {
    const v = view();
    expect(v.blocking.map((r) => r.control.id).sort())
      .toEqual(['HK-001', 'HK-010']);
    expect(v.blocking.map((r) => r.control.id)).not.toContain('HK-014');
  });
});

describe('what a round can be', () => {
  it('will not call an unreported round done', () => {
    const v = view();
    expect(v.controls.find((r) => r.control.id === 'HK-005')!.state)
      .toBe(HygieneState.NOT_DONE);
  });

  it('does not chase a turnover round before anybody has left a chair', () => {
    // Reporting it undone every morning is how a list stops being read.
    const v = view();
    const chair = v.controls.find((r) => r.control.id === 'HK-002')!;
    expect(chair.state).toBe(HygieneState.NOT_DUE);
    expect(v.outstanding.map((r) => r.control.id)).not.toContain('HK-002');
  });

  it('chases it the moment a chair empties', () => {
    const v = view([], [], ['HK-002']);
    expect(v.controls.find((r) => r.control.id === 'HK-002')!.state)
      .toBe(HygieneState.NOT_DONE);
  });

  it('holds a reported round open until the named checker looks at it', () => {
    const v = view([report('HK-001')]);
    const one = v.controls.find((r) => r.control.id === 'HK-001')!;
    expect(one.state).toBe(HygieneState.AWAITING_CHECK);
    // The work is done. An unsigned control is a control failure, not a dirty
    // room, so it stops holding the door the moment the room is clean.
    expect(one.blocksOpening).toBe(false);
    expect(one.because).toContain('waiting on the dental assistant');
  });

  it('records a check that failed, which is what a failed audit is', () => {
    // The outcome a tick sheet cannot produce, and the reason the matrix names
    // a Checker at all: somebody looked and was not satisfied.
    const v = view([report('HK-001')],
      [checked('HK-001', { passed: false, note: 'Bin not emptied in Operatory 2' })]);
    const one = v.controls.find((r) => r.control.id === 'HK-001')!;
    expect(one.state).toBe(HygieneState.FAILED_CHECK);
    expect(one.blocksOpening).toBe(true);
    expect(one.because).toContain('Bin not emptied');
    expect(v.failedHygieneAudits).toBe(1);
  });

  it('does not inherit yesterday’s round', () => {
    // Same rule as the emergency kit. A round reported before the clinic
    // unlocked is not this morning's answer.
    const v = view([report('HK-005', { at: OPENED - 900 })]);
    expect(v.controls.find((r) => r.control.id === 'HK-005')!.state)
      .toBe(HygieneState.NOT_DONE);
  });

  it('separates a defective basin from a dirty one', () => {
    // HK-008 asks two questions and only the second raises a ticket. A tap
    // that is clean and broken is a maintenance job, not a cleaning one.
    const v = view([report('HK-008', { defectFound: true, note: 'Cold tap drips' })]);
    const basin = v.controls.find((r) => r.control.id === 'HK-008')!;
    expect(basin.state).toBe(HygieneState.DONE);
    expect(basin.defect).toBe(true);
    expect(v.defects.map((r) => r.control.id)).toEqual(['HK-008']);
  });
});

describe('the owner’s four KPIs', () => {
  it('computes all four, each over a denominator it shows', () => {
    // "82%" over eleven controls and "82%" over two are different statements,
    // and a dashboard showing only the percentage lets the second pass as the
    // first.
    const v = allDone();
    for (const k of [v.housekeepingCompliance, v.treatmentRoomHygiene,
      v.washroomCompliance]) {
      expect(k.percent).toBe(100);
      expect(k.of).toBeGreaterThan(0);
      expect(k.done).toBe(k.of);
    }
    expect(v.failedHygieneAudits).toBe(0);
  });

  it('groups the washroom KPI by area, not by a word in the title', () => {
    // A KPI computed by matching on "toilet" breaks the first time somebody
    // writes "washroom".
    const washroom = HYGIENE_CONTROLS.filter((c) => c.area === HygieneArea.WASHROOM);
    expect(washroom.map((c) => c.id)).toEqual(['HK-008', 'HK-009', 'HK-010', 'HK-011']);
    expect(allDone().washroomCompliance.of).toBe(4);
  });

  it('reports nothing-to-measure as null rather than as nought', () => {
    // A dashboard drawing 0% for an empty denominator has invented a failure.
    const empty = housekeeping([], [], [], OPENED, [], NOW);
    expect(empty.housekeepingCompliance.percent).toBeNull();
    expect(empty.washroomCompliance.of).toBe(0);
  });

  it('leaves a not-yet-due round out of the denominator', () => {
    // Counting the chair turnover as failed at 08:45 would drag the
    // treatment-room figure down for a job nobody was asked to do yet.
    const v = view([report('HK-001'), report('HK-003')], [checked('HK-001')]);
    expect(v.treatmentRoomHygiene.of).toBe(2);
    expect(v.treatmentRoomHygiene.percent).toBe(100);
  });

  it('counts a failed check as not done, in the percentage as well as the count', () => {
    const v = view(
      HYGIENE_CONTROLS.map((c) => report(c.id)),
      [checked('HK-001', { passed: false }), checked('HK-009')],
      HYGIENE_CONTROLS.filter((c) => c.trigger === HygieneTrigger.TURNOVER).map((c) => c.id),
    );
    expect(v.failedHygieneAudits).toBe(1);
    expect(v.treatmentRoomHygiene.percent).toBeLessThan(100);
  });

  it('names the columns the clinic’s sheet must carry', () => {
    for (const c of ['control_id', 'done_by', 'defect_found', 'check_passed']) {
      expect(HYGIENE_SHEET_COLUMNS).toContain(c);
    }
  });
});

describe('the readiness module reads as five short answers, not one long list', () => {
  const morning = (done: string[] = []): ReadinessEvent[] =>
    done.map((t) => ({ type: t as ClinicEvent, subjectId: '', at: 8 * 60 + 50 }));

  it('gives every lane a role, a question and its own fraction', () => {
    // "Nine-elevenths ready" cannot tell you whether the assistants are nearly
    // finished or housekeeping has not started, and those are completely
    // different mornings.
    const lanes = readiness([], ROOMS, 10 * 60, NOW).lanes;
    expect(lanes.map((l) => l.role)).toEqual([
      RoleCode.HOUSEKEEPING, RoleCode.DENTAL_ASSISTANT, RoleCode.SENIOR_ASSISTANT,
      RoleCode.RECEPTION, RoleCode.STERILIZATION_TECHNICIAN,
    ]);
    for (const l of lanes) {
      expect(l.question.endsWith('?'), `${l.role} has no question`).toBe(true);
      expect(l.of).toBeGreaterThan(0);
    }
  });

  it('puts housekeeping first, because everything else sits on top of it', () => {
    // The assistant cannot disinfect a chair in a room that has not been
    // cleaned. Sequence, not alphabet.
    expect(readiness([], ROOMS, 10 * 60, NOW).lanes[0]!.label).toBe('Housekeeping');
  });

  it('moves one lane without moving the others', () => {
    const r = readiness(morning([ClinicEvent.ROOMS_CLEANED]), ROOMS, 10 * 60, NOW);
    const hk = r.lanes.find((l) => l.role === RoleCode.HOUSEKEEPING)!;
    const asst = r.lanes.find((l) => l.role === RoleCode.DENTAL_ASSISTANT)!;
    expect(hk.done).toBe(1);
    expect(hk.of).toBe(3);
    expect(hk.percent).toBe(33);
    expect(asst.done).toBe(0);
  });

  it('keeps the as-required work out of every lane’s fraction', () => {
    // The stock check is real work and is not part of "may the clinic open".
    // Folding it in would make a finished morning read as ninety-something.
    const asst = readiness([], ROOMS, 10 * 60, NOW).lanes
      .find((l) => l.role === RoleCode.DENTAL_ASSISTANT)!;
    expect(asst.blocks.map((b) => b.id)).toContain('STOCK');
    expect(asst.of).toBe(asst.blocks.filter((b) => b.mandatory).length);
  });

  it('never shows a lane with nothing in it', () => {
    // An empty lane reads as a job somebody has forgotten. The honest thing is
    // that the morning does not ask that role for anything.
    for (const l of readiness([], ROOMS, 10 * 60, NOW).lanes) {
      expect(l.blocks.length, `${l.role} is empty`).toBeGreaterThan(0);
    }
  });

  it('gives every lane the same total as the flat list, with nothing counted twice', () => {
    const r = readiness([], ROOMS, 10 * 60, NOW);
    const inLanes = r.lanes.flatMap((l) => l.blocks.map((b) => b.id));
    expect(new Set(inLanes).size).toBe(inLanes.length);
    expect(inLanes.sort()).toEqual(r.blocks.map((b) => b.id).sort());
  });

  it('agrees with the headline percentage', () => {
    const r = readiness(morning([ClinicEvent.ROOMS_CLEANED,
      ClinicEvent.WASHROOM_STOCKED]), ROOMS, 10 * 60, NOW);
    const done = r.lanes.reduce((n, l) => n + l.done, 0);
    const of = r.lanes.reduce((n, l) => n + l.of, 0);
    expect(r.percent).toBe(Math.round((done / of) * 100));
  });
});
